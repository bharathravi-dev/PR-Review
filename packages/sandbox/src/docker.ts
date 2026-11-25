// Container Sandbox (AD-7, FR-39): PR code runs only here. Docker or Podman, ephemeral, no Credentials, no host env,
// no container socket; INSTALL reaches only the registry through an allow-list proxy; ANALYZE has no network.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { err, ok, type Result, type SandboxPlan, type SandboxPort, type SandboxRunResult, type SandboxStep, type SandboxStepResult } from '@pr-reviewer/core'
import { PROXY_SCRIPT } from './proxy-script.js'

/** Toolchain images pinned by digest (AD-21): the official Node images, multi-arch index digests. */
export const NODE_IMAGES: Readonly<Record<number, string>> = {
  14: 'node:14-bullseye-slim@sha256:0f5b374fae506741ff14db84daff2937ae788e88fb48a6c66d15de5ee808ccd3',
  16: 'node:16-bullseye-slim@sha256:503446c15c6236291222f8192513c2eb56a02a8949cbadf4fe78cce19815c734',
  18: 'node:18-bookworm-slim@sha256:f9ab18e354e6855ae56ef2b290dd225c1e51a564f87584b9bd21dd651838830e',
  20: 'node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0',
  22: 'node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb',
  24: 'node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530',
}

const MAX_OUTPUT = 10 * 1024 * 1024
const UID = '1000:1000'

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  spawnError?: string | undefined
}

/** Runs the container CLI (no shell). Injected in tests. */
export type CommandRunner = (command: string, args: readonly string[], opts: { timeoutMs: number; stdin?: Uint8Array | undefined }) => Promise<CommandResult>

export const runCommand: CommandRunner = (command, args, opts) =>
  new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { stdio: [opts.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'], shell: false, windowsHide: true })
    } catch (e) {
      resolve({ code: null, stdout, stderr, timedOut, spawnError: (e as Error).message })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, opts.timeoutMs)
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += d
    })
    child.stderr!.setEncoding('utf8').on('data', (d: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += d
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr, timedOut, spawnError: e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
    if (opts.stdin) {
      child.stdin!.on('error', () => undefined)
      child.stdin!.end(opts.stdin)
    }
  })

export interface ContainerSandboxOptions {
  /** "docker" or "podman" (default: whichever responds, Docker first). */
  command?: string | undefined
  run?: CommandRunner | undefined
  images?: Readonly<Record<number, string>> | undefined
  memory?: string | undefined
  cpus?: string | undefined
}

export class ContainerSandbox implements SandboxPort {
  readonly #o: ContainerSandboxOptions
  readonly #run: CommandRunner
  readonly #images: Readonly<Record<number, string>>
  #cli: string | undefined

  constructor(opts: ContainerSandboxOptions = {}) {
    this.#o = opts
    this.#run = opts.run ?? runCommand
    this.#images = opts.images ?? NODE_IMAGES
  }

  async probe(): Promise<Result<{ runtime: string; nodeMajors: number[]; egressControl: boolean }>> {
    let found: { cli: string; version: string } | undefined
    for (const cli of this.#o.command ? [this.#o.command] : ['docker', 'podman']) {
      const r = await this.#run(cli, ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 20_000 })
      if (r.code === 0 && r.stdout.trim()) {
        found = { cli, version: r.stdout.trim() }
        break
      }
    }
    if (!found) return err('sandbox_unavailable', 'Docker or Podman is not installed or not running')
    this.#cli = found.cli
    // Install egress is limited with an internal network plus the allow-list proxy; check that internal networks work.
    const probeNet = `prr-probe-${randomBytes(4).toString('hex')}`
    const made = await this.#run(found.cli, ['network', 'create', '--internal', probeNet], { timeoutMs: 20_000 })
    if (made.code === 0) await this.#run(found.cli, ['network', 'rm', probeNet], { timeoutMs: 20_000 })
    return ok({ runtime: `${found.cli} ${found.version}`, nodeMajors: Object.keys(this.#images).map(Number).sort((a, b) => a - b), egressControl: made.code === 0 })
  }

  async run(plan: SandboxPlan, planHash: string, source: { headSha: string; archive: Uint8Array }): Promise<Result<SandboxRunResult>> {
    const cli = this.#cli ?? this.#o.command ?? 'docker'
    const image = this.#images[plan.nodeMajor]
    if (!image) return err('sandbox_no_image', `No pinned image for Node ${plan.nodeMajor}.`)
    const imageDigest = image.includes('@') ? image.slice(image.indexOf('@') + 1) : image
    const id = `prr-${randomBytes(5).toString('hex')}`
    const work = `${id}-work`
    const scratch = `${id}-scratch`
    const net = `${id}-net`
    const proxy = `${id}-proxy`
    // No host directory is mounted anywhere: the source arrives on stdin, so this works with Colima, Podman
    // machine, and remote engines alike, and nothing from the PR is ever written to the host.
    const docker = (args: string[], timeoutMs = 120_000, stdin?: Uint8Array) => this.#run(cli, args, { timeoutMs, stdin })
    const cleanup: Array<() => Promise<unknown>> = []
    try {
      const present = await docker(['image', 'inspect', image], 30_000)
      if (present.code !== 0) {
        const pulled = await docker(['pull', image], 15 * 60_000)
        if (pulled.code !== 0) return err('sandbox_pull_failed', `Could not pull ${image}: ${tail(pulled.stderr)}`)
      }
      for (const v of [work, scratch]) {
        const made = await docker(['volume', 'create', v])
        if (made.code !== 0) return err('sandbox_volume_failed', `Could not create a volume: ${tail(made.stderr)}`)
        cleanup.push(() => docker(['volume', 'rm', '-f', v]))
      }

      // Extract inside a container (never on the host), then hand the tree to the unprivileged user.
      const extract = await docker(
        [
          'run', '--rm', '-i', '--network', 'none', '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'FOWNER',
          '--security-opt', 'no-new-privileges', '-v', `${work}:/work`, '-v', `${scratch}:/scratch`, image,
          'sh', '-c', 'tar -xzf - -C /work --strip-components=1 --no-same-owner --no-same-permissions && mkdir -p /scratch/home && chown -R 1000:1000 /work /scratch',
        ],
        10 * 60_000,
        source.archive,
      )
      if (extract.code !== 0) return err('sandbox_extract_failed', `Could not unpack the source: ${tail(extract.stderr)}`)

      const results: SandboxStepResult[] = []
      const installs = plan.steps.filter((s) => s.phase === 'INSTALL')
      if (installs.length > 0) {
        const made = await docker(['network', 'create', '--internal', net])
        if (made.code !== 0) return err('sandbox_no_egress_control', `Could not create an internal network: ${tail(made.stderr)}`)
        cleanup.push(() => docker(['network', 'rm', net]))
        const started = await docker([
          'run', '-d', '--name', proxy, '--network', 'bridge', '--user', UID, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
          '--read-only', '--memory', '256m', '-e', 'PRR_PORT=3128', '-e', `PRR_ALLOW=${plan.registries.join(',')}`, image, 'node', '--input-type=module', '-e', PROXY_SCRIPT,
        ])
        cleanup.unshift(() => docker(['rm', '-f', proxy]))
        if (started.code !== 0) return err('sandbox_proxy_failed', `Could not start the registry proxy: ${tail(started.stderr)}`)
        const joined = await docker(['network', 'connect', '--alias', 'proxy', net, proxy])
        if (joined.code !== 0) return err('sandbox_proxy_failed', `Could not attach the registry proxy: ${tail(joined.stderr)}`)
        let ready = false
        for (let i = 0; i < 40 && !ready; i++) {
          ready = (await docker(['logs', proxy], 10_000)).stdout.includes('ready')
          if (!ready) await new Promise((r) => setTimeout(r, 250))
        }
        if (!ready) return err('sandbox_proxy_failed', 'The registry proxy did not start.')
        for (const step of installs) results.push(await this.#step(cli, image, step, net, work, scratch, `${id}-${results.length}`))
        await docker(['rm', '-f', proxy])
      }
      for (const step of plan.steps.filter((s) => s.phase === 'ANALYZE')) results.push(await this.#step(cli, image, step, 'none', work, scratch, `${id}-${results.length}`))
      return ok({ planHash, headSha: source.headSha, imageDigest, results })
    } finally {
      for (const c of cleanup) await c().catch(() => undefined)
    }
  }

  async #step(cli: string, image: string, step: SandboxStep, network: string, work: string, scratch: string, name: string): Promise<SandboxStepResult> {
    const viaProxy = network !== 'none'
    const proxyEnv = viaProxy
      ? [
          ...['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'npm_config_proxy', 'npm_config_https_proxy'].flatMap((k) => ['-e', `${k}=http://proxy:3128`]),
          // Node 24+: make the built-in fetch honour the proxy too.
          '-e', 'NODE_USE_ENV_PROXY=1',
        ]
      : []
    const cwd = step.cwd.replace(/^\/+|\/+$/g, '')
    const args = [
      'run', '--rm', '--name', name, '--network', network, '--user', UID, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--pids-limit', '2048', '--memory', this.#o.memory ?? '3g', '--cpus', this.#o.cpus ?? '2', '--read-only', '--tmpfs', '/tmp:rw,exec,size=1g',
      '-v', `${work}:/work`, '-v', `${scratch}:/scratch`, '-w', cwd ? `/work/${cwd}` : '/work',
      '-e', 'HOME=/scratch/home', '-e', 'CI=true', '-e', 'npm_config_cache=/scratch/npm-cache', '-e', 'npm_config_update_notifier=false',
      '-e', 'COREPACK_HOME=/scratch/corepack', '-e', 'COREPACK_ENABLE_DOWNLOAD_PROMPT=0', '-e', 'NODE_OPTIONS=--max-old-space-size=2560',
      ...proxyEnv, image, ...step.cmd,
    ]
    const started = Date.now()
    const r = await this.#run(cli, args, { timeoutMs: step.timeoutMs })
    if (r.timedOut) await this.#run(cli, ['rm', '-f', name], { timeoutMs: 30_000 })
    return {
      id: step.id,
      exitCode: r.code,
      stdout: r.stdout,
      stderr: r.stderr,
      timedOut: r.timedOut,
      durationMs: Date.now() - started,
      ...(r.spawnError ? { skipped: `the container could not start: ${r.spawnError}` } : {}),
    }
  }
}

function tail(text: string, max = 300): string {
  const t = text.trim()
  return t.length > max ? `…${t.slice(-max)}` : t
}
