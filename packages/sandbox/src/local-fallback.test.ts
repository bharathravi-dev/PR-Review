import { err, ok, type SandboxPlan, type SandboxPort } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { FallbackSandbox, HostFallbackSandbox, rewriteStepCmd } from './local-fallback.js'

const plan: SandboxPlan = {
  nodeMajor: 22,
  registries: ['registry.npmjs.org'],
  steps: [{ id: 'ts.tsc:.', phase: 'ANALYZE', cmd: ['sh', '-c', 'echo ok'], cwd: '', timeoutMs: 5000 }],
}

describe('FallbackSandbox', () => {
  it('uses primary container sandbox when available without prompting', async () => {
    let asked = false
    const primary: SandboxPort = {
      probe: async () => ok({ runtime: 'docker 27.0', nodeMajors: [22], egressControl: true }),
      run: async (_p, hash, src) => ok({ planHash: hash, headSha: src.headSha, imageDigest: 'sha256:docker', results: [] }),
    }
    const sb = new FallbackSandbox({ primary, allowFallback: async () => ((asked = true), true) })
    const p = await sb.probe()
    expect(p.ok).toBe(true)
    expect(asked).toBe(false)
    const r = await sb.run(plan, 'h1', { headSha: 'sha1', archive: new Uint8Array() })
    expect(r.ok && r.value.imageDigest).toBe('sha256:docker')
  })

  it('refuses host fallback when user declines permission', async () => {
    const primary: SandboxPort = {
      probe: async () => err('sandbox_unavailable', 'Docker not running'),
      run: async () => err('sandbox_unavailable', 'nope'),
    }
    const sb = new FallbackSandbox({ primary, allowFallback: async () => false })
    const p = await sb.probe()
    expect(p.ok).toBe(false)
  })

  it('uses HostFallbackSandbox when Docker is unavailable and user permits', async () => {
    const primary: SandboxPort = {
      probe: async () => err('sandbox_unavailable', 'Docker not running'),
      run: async () => err('sandbox_unavailable', 'nope'),
    }
    const calls: string[][] = []
    const host = new HostFallbackSandbox({
      nodeMajor: 22,
      run: async (cmd, args) => {
        calls.push([cmd, ...args])
        if (cmd === 'node') return { code: 0, stdout: 'v22.0.0\n', stderr: '', timedOut: false }
        return { code: 0, stdout: '', stderr: '', timedOut: false }
      },
    })
    const sb = new FallbackSandbox({ primary, fallback: host, allowFallback: async () => true })
    const p = await sb.probe()
    expect(p.ok && p.value.runtime).toContain('local-host')
    expect(p.ok && p.value.hostFallback).toBe(true)
    expect(p.ok && p.value.egressControl).toBe(false)
    const res = await sb.run(plan, 'p1', { headSha: 's1', archive: new Uint8Array([1]) })
    expect(res.ok && res.value.imageDigest).toBe('local-host-user-approved')
    expect(calls.some((c) => c[0] === 'tar')).toBe(true)
    expect(calls.some((c) => c[0] === 'sh')).toBe(true)
  })

  it('does not downgrade a container runtime that merely lacks egressControl', async () => {
    let asked = false
    const primary: SandboxPort = {
      probe: async () => ok({ runtime: 'docker 27.0', nodeMajors: [22], egressControl: false }),
      run: async (_p, hash, src) => ok({ planHash: hash, headSha: src.headSha, imageDigest: 'sha256:docker', results: [] }),
    }
    const sb = new FallbackSandbox({ primary, allowFallback: async () => ((asked = true), true) })
    const p = await sb.probe()
    expect(p.ok && !p.value.hostFallback).toBe(true)
    expect(asked).toBe(false)
  })
})

describe('rewriteStepCmd', () => {
  it('rewrites /scratch and "/work" container paths to host temp paths', () => {
    expect(rewriteStepCmd(['sh', '-c', 'd="$PWD"; [ "$d" = "/work" ] && ls /scratch/tools'], '/tmp/w', '/tmp/s')).toEqual([
      'sh',
      '-c',
      'd="$PWD"; [ "$d" = "/tmp/w" ] && ls /tmp/s/tools',
    ])
  })
})
