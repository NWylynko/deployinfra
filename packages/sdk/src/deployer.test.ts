import { describe, expect, it, vi } from 'vitest'
import { adaptSource, createDeployer } from './deployer.js'
import type { Provider } from './provider.js'
import type {
  DeployContext,
  DeploymentResult,
  FilesSource,
  ResolvedSource,
} from './types.js'

function createFakeProvider(): Provider & { getCalls: number } {
  let getCalls = 0
  const provider: Provider & { getCalls: number } = {
    specificationVersion: 'v1',
    name: 'fake',
    capabilities: { sources: { files: true, git: false } },
    getCalls: 0,
    async deploy(source: ResolvedSource, _ctx: DeployContext) {
      if (source.kind !== 'files') throw new Error('expected files')
      getCalls = 0
      return {
        provider: 'fake',
        deploymentId: 'dep_1',
        status: 'queued',
        raw: {},
      }
    },
    async getDeployment(id: string): Promise<DeploymentResult> {
      getCalls++
      provider.getCalls = getCalls
      const status = getCalls >= 2 ? 'ready' : 'building'
      return {
        provider: 'fake',
        deploymentId: id,
        status,
        url: status === 'ready' ? 'https://fake.example' : undefined,
        raw: {},
      }
    },
  }
  return provider
}

describe('createDeployer', () => {
  it('rejects unsupported specificationVersion', () => {
    expect(() =>
      createDeployer({
        provider: {
          ...createFakeProvider(),
          specificationVersion: 'v0' as 'v1',
        },
      }),
    ).toThrow(/specificationVersion/)
  })

  it('detects, resolves, deploys, and polls to ready', async () => {
    vi.useFakeTimers()
    const provider = createFakeProvider()
    const deployer = createDeployer({ provider })

    const promise = deployer.deploy({
      kind: 'files',
      files: { 'index.html': '<h1>hi</h1>' },
    })

    await vi.advanceTimersByTimeAsync(3000)
    const result = await promise

    expect(result.status).toBe('ready')
    expect(result.url).toBe('https://fake.example')
    expect(result.deploymentId).toBe('dep_1')
    vi.useRealTimers()
  })

  it('returns at created when waitUntil is created', async () => {
    const provider = createFakeProvider()
    const deployer = createDeployer({ provider })
    const result = await deployer.deploy(
      { kind: 'files', files: { 'a.txt': 'x' } },
      { waitUntil: 'created' },
    )
    expect(result.status).toBe('queued')
    expect(provider.getCalls).toBe(0)
  })

  it('generates a dashed slug when name is omitted', async () => {
    const provider = createFakeProvider()
    const deploySpy = vi.spyOn(provider, 'deploy')
    const deployer = createDeployer({ provider })

    await deployer.deploy(
      { kind: 'files', files: { 'a.txt': 'x' } },
      { waitUntil: 'created' },
    )

    const context = deploySpy.mock.calls[0]?.[1]
    expect(context?.name).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/)
  })

  it('forwards onStatus during poll', async () => {
    vi.useFakeTimers()
    const statuses: string[] = []
    const provider = createFakeProvider()
    const deployer = createDeployer({ provider })

    const promise = deployer.deploy(
      { kind: 'files', files: { 'index.html': 'x' } },
      { onStatus: (r) => statuses.push(r.status) },
    )
    await vi.advanceTimersByTimeAsync(3000)
    await promise
    expect(statuses[0]).toBe('queued')
    expect(statuses.at(-1)).toBe('ready')
    vi.useRealTimers()
  })

  it('runs deployer lifecycle hooks in order', async () => {
    vi.useFakeTimers()
    const events: string[] = []
    const provider = createFakeProvider()
    const deployer = createDeployer({
      provider,
      onDeployStart: ({ name, provider: p }) => {
        events.push(`start:${p}:${name}`)
      },
      onStatus: (r) => events.push(`status:${r.status}`),
      onDeployComplete: (r) => events.push(`complete:${r.status}`),
    })

    const promise = deployer.deploy(
      { kind: 'files', files: { 'index.html': 'x' } },
      { name: 'hook-demo' },
    )
    await vi.advanceTimersByTimeAsync(3000)
    await promise

    expect(events[0]).toBe('start:fake:hook-demo')
    expect(events).toContain('status:queued')
    expect(events).toContain('status:ready')
    expect(events.at(-1)).toBe('complete:ready')
    vi.useRealTimers()
  })

  it('composes deployer and per-call lifecycle hooks', async () => {
    const events: string[] = []
    const provider = createFakeProvider()
    const deployer = createDeployer({
      provider,
      onDeployStart: () => events.push('d:start'),
      onStatus: (r) => events.push(`d:status:${r.status}`),
      onDeployComplete: () => events.push('d:complete'),
    })

    await deployer.deploy(
      { kind: 'files', files: { 'a.txt': 'x' } },
      {
        waitUntil: 'created',
        name: 'compose',
        onDeployStart: () => events.push('c:start'),
        onStatus: (r) => events.push(`c:status:${r.status}`),
        onDeployComplete: () => events.push('c:complete'),
      },
    )

    expect(events).toEqual([
      'd:start',
      'c:start',
      'd:status:queued',
      'c:status:queued',
      'd:complete',
      'c:complete',
    ])
  })

  it('invokes onDeployError then rethrows', async () => {
    const provider = createFakeProvider()
    provider.deploy = async () => {
      throw new Error('upload failed')
    }
    const deployerError = vi.fn()
    const callError = vi.fn()
    const deployer = createDeployer({
      provider,
      onDeployError: deployerError,
    })

    await expect(
      deployer.deploy(
        { kind: 'files', files: { 'a.txt': 'x' } },
        { name: 'boom', onDeployError: callError },
      ),
    ).rejects.toThrow('upload failed')

    expect(deployerError).toHaveBeenCalledOnce()
    expect(callError).toHaveBeenCalledOnce()
    expect(deployerError.mock.calls[0]?.[1]).toMatchObject({
      name: 'boom',
      provider: 'fake',
    })
    expect(callError.mock.calls[0]?.[1]).toMatchObject({
      name: 'boom',
      provider: 'fake',
    })
  })

  it('propagates abort through deploy polling', async () => {
    vi.useFakeTimers()
    const provider = createFakeProvider()
    // Never become ready so polling continues
    provider.getDeployment = async (id) => ({
      provider: 'fake',
      deploymentId: id,
      status: 'building',
      raw: {},
    })

    const deployer = createDeployer({ provider })
    const controller = new AbortController()

    const promise = deployer.deploy(
      { kind: 'files', files: { 'index.html': 'x' } },
      { signal: controller.signal, pollIntervalMs: 1000 },
    )

    // Let create finish and first poll sleep start
    await vi.advanceTimersByTimeAsync(10)
    controller.abort(new Error('user-cancel'))

    await expect(promise).rejects.toThrow(/user-cancel/)
    vi.useRealTimers()
  })
})

describe('adaptSource', () => {
  it('materializes git when provider lacks native git support', async () => {
    const materialized: FilesSource = {
      kind: 'files',
      async count() {
        return 1
      },
      async *files() {
        yield {
          path: 'index.html',
          size: 2,
          async read() {
            return new TextEncoder().encode('ok')
          },
        }
      },
    }

    const materialize = vi.fn().mockResolvedValue(materialized)
    const provider: Provider = {
      specificationVersion: 'v1',
      name: 'fake',
      capabilities: { sources: { files: true, git: false } },
      async deploy() {
        return { provider: 'fake', deploymentId: 'x', status: 'ready', raw: {} }
      },
      async getDeployment(id) {
        return { provider: 'fake', deploymentId: id, status: 'ready', raw: {} }
      },
    }

    const adapted = await adaptSource(
      {
        kind: 'git',
        host: 'github',
        owner: 'acme',
        repo: 'site',
        materialize,
      },
      provider,
    )

    expect(materialize).toHaveBeenCalledOnce()
    expect(adapted.kind).toBe('files')
  })

  it('keeps git source when provider supports git', async () => {
    const materialize = vi.fn()
    const provider: Provider = {
      specificationVersion: 'v1',
      name: 'fake',
      capabilities: { sources: { files: true, git: true } },
      async deploy() {
        return { provider: 'fake', deploymentId: 'x', status: 'ready', raw: {} }
      },
      async getDeployment(id) {
        return { provider: 'fake', deploymentId: id, status: 'ready', raw: {} }
      },
    }

    const source = {
      kind: 'git' as const,
      host: 'github' as const,
      owner: 'acme',
      repo: 'site',
      materialize,
    }

    const adapted = await adaptSource(source, provider)
    expect(materialize).not.toHaveBeenCalled()
    expect(adapted).toBe(source)
  })
})
