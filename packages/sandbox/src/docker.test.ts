import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SandboxPlan } from '@pr-reviewer/core'
import { afterEach, describe, expect, it } from 'vitest'
import { ContainerSandbox, NODE_IMAGES, type CommandRunner } from './docker.js'
import { PROXY_SCRIPT } from './proxy-script.js'

function fakeRuntime(over: (args: readonly string[]) => { code?: number; stdout?: string } | undefined = () => undefined) {
  const calls: string[][] = []
  const run: CommandRunner = async (_cmd, args) => {
    calls.push([...args])
    const o = over(args)
    if (o) return { code: o.code ?? 0, stdout: o.stdout ?? '', stderr: '', timedOut: false }
    if (args[0] === 'version') return { code: 0, stdout: '27.0.1\n', stderr: '', timedOut: false }
    if (args[0] === 'logs') return { code: 0, stdout: 'ready\n', stderr: '', timedOut: false }
    if (args[0] === 'run' && args.includes('--network') && args[args.indexOf('--network') + 1] === 'none' && args.includes('tsc')) {
      return { code: 2, stdout: 'src/a.ts(1,1): error TS2304: x', stderr: '', timedOut: false }
    }
    return { code: 0, stdout: '', stderr: '', timedOut: false }
  }
  return { run, calls }
}

const PLAN: SandboxPlan = {
  nodeMajor: 22,
  registries: ['registry.npmjs.org'],
  steps: [
    { id: 'install:.', phase: 'INSTALL', cmd: ['npm', 'ci'], cwd: '', timeoutMs: 1000 },
    { id: 'ts.tsc:.', phase: 'ANALYZE', cmd: ['tsc', '--noEmit'], cwd: 'apps/web', timeoutMs: 1000 },
  ],
}

describe('ContainerSandbox (Story 4.5)', () => {
  it('probes the runtime, pinned Node majors, and whether install egress can be limited', async () => {
    const { run } = fakeRuntime()
    expect(await new ContainerSandbox({ run }).probe()).toEqual({ ok: true, value: { runtime: 'docker 27.0.1', nodeMajors: [14, 16, 18, 20, 22, 24], egressControl: true } })
    const down: CommandRunner = async () => ({ code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon', timedOut: false })
    expect(await new ContainerSandbox({ run: down }).probe()).toMatchObject({ ok: false, error: { code: 'sandbox_unavailable' } })
    expect(Object.values(NODE_IMAGES).every((i) => /@sha256:[0-9a-f]{64}$/.test(i))).toBe(true)
  })

  it('installs through the registry-only proxy on an internal network and analyses with no network, unprivileged, without host env', async () => {
    const { run, calls } = fakeRuntime()
    const sb = new ContainerSandbox({ run })
    await sb.probe()
    const res = await sb.run(PLAN, 'plan-1', { headSha: 'head1', archive: new Uint8Array([31, 139]) })
    expect(res).toMatchObject({ ok: true, value: { planHash: 'plan-1', headSha: 'head1', imageDigest: NODE_IMAGES[22]!.split('@')[1] } })
    if (!res.ok) return
    expect(res.value.results.map((r) => [r.id, r.exitCode])).toEqual([['install:.', 0], ['ts.tsc:.', 2]])

    const runs = calls.filter((c) => c[0] === 'run')
    const extract = runs[0]!
    expect(extract[extract.indexOf('--network') + 1]).toBe('none')
    expect(extract.join(' ')).toContain('tar -xzf - -C /work')
    expect(calls.flat().some((a) => a.includes(':/in'))).toBe(false)

    expect(calls.some((c) => c.join(' ').startsWith('network create --internal prr-'))).toBe(true)
    const proxy = runs.find((c) => c.includes('-d'))!
    expect(proxy).toContain('PRR_ALLOW=registry.npmjs.org')
    expect(proxy.slice(-4, -1)).toEqual(['node', '--input-type=module', '-e'])

    const install = runs.find((c) => c.includes('npm'))!
    const analyze = runs.find((c) => c.includes('tsc'))!
    expect(install[install.indexOf('--network') + 1]).toMatch(/^prr-[0-9a-f]+-net$/)
    expect(install).toContain('HTTPS_PROXY=http://proxy:3128')
    expect(analyze[analyze.indexOf('--network') + 1]).toBe('none')
    expect(analyze).not.toContain('HTTPS_PROXY=http://proxy:3128')
    expect(analyze[analyze.indexOf('-w') + 1]).toBe('/work/apps/web')
    for (const step of [install, analyze]) {
      expect(step).toEqual(expect.arrayContaining(['--user', '1000:1000', '--cap-drop', 'ALL', '--read-only', '--security-opt', 'no-new-privileges']))
      const env = step.flatMap((a, i) => (step[i - 1] === '-e' ? [a.split('=')[0]] : []))
      expect(env.filter((k) => /TOKEN|KEY|SECRET|GITHUB|ANTHROPIC|OPENAI/i.test(k!))).toEqual([])
      expect(step.join(' ')).not.toMatch(/docker\.sock/)
    }
    // Everything is removed afterwards.
    expect(calls.some((c) => c[0] === 'volume' && c[1] === 'rm')).toBe(true)
    expect(calls.some((c) => c[0] === 'network' && c[1] === 'rm')).toBe(true)
    expect(calls.some((c) => c[0] === 'rm' && c[1] === '-f')).toBe(true)
  })

  it('refuses when the internal network cannot be created', async () => {
    const { run } = fakeRuntime((args) => (args[0] === 'network' && args[1] === 'create' ? { code: 1 } : undefined))
    const sb = new ContainerSandbox({ run })
    expect((await sb.probe()).ok && (await sb.probe())).toMatchObject({ value: { egressControl: false } })
    expect(await sb.run(PLAN, 'p', { headSha: 'h', archive: new Uint8Array() })).toMatchObject({ ok: false, error: { code: 'sandbox_no_egress_control' } })
  })
})

describe('registry proxy', () => {
  let child: ReturnType<typeof spawn> | undefined
  afterEach(() => child?.kill())

  it('allows only HTTPS CONNECT to allow-listed hosts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prr-proxy-'))
    writeFileSync(join(dir, 'proxy.mjs'), PROXY_SCRIPT)
    const port = 20000 + Math.floor(Math.random() * 20000)
    child = spawn(process.execPath, [join(dir, 'proxy.mjs')], { stdio: ['ignore', 'pipe', 'pipe'], env: { PRR_PORT: String(port), PRR_ALLOW: 'registry.npmjs.org' } })
    await new Promise<void>((resolve) => child!.stdout!.on('data', (d: Buffer) => d.toString().includes('ready') && resolve()))
    const connect = (target: string) =>
      new Promise<number>((resolve) => {
        const req = request({ host: '127.0.0.1', port, method: 'CONNECT', path: target })
        req.on('connect', (res, socket) => {
          socket.destroy()
          resolve(res.statusCode ?? 0)
        })
        req.on('error', () => resolve(-1))
        req.end()
      })
    expect(await connect('github.com:443')).toBe(403)
    expect(await connect('evil.example:443')).toBe(403)
    expect(await connect('registry.npmjs.org:80')).toBe(403)
    const plain = await new Promise<number>((resolve) => request({ host: '127.0.0.1', port, path: 'http://example.com/' }, (res) => resolve(res.statusCode ?? 0)).end())
    expect(plain).toBe(403)
  })
})
