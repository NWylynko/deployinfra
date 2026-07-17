import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimeoutError } from './errors.js'
import { pollDeployment } from './poll.js'
import type { DeploymentResult } from './types.js'

function result(status: DeploymentResult['status']): DeploymentResult {
  return {
    provider: 'fake',
    deploymentId: 'd1',
    status,
    raw: {},
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('pollDeployment', () => {
  it('returns immediately for waitUntil created', async () => {
    const get = vi.fn().mockResolvedValue(result('queued'))
    const out = await pollDeployment(get, { waitUntil: 'created' })
    expect(out.status).toBe('queued')
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('polls until ready', async () => {
    vi.useFakeTimers()
    const get = vi
      .fn()
      .mockResolvedValueOnce(result('queued'))
      .mockResolvedValueOnce(result('building'))
      .mockResolvedValueOnce(result('ready'))

    const promise = pollDeployment(get, { pollIntervalMs: 1000, timeoutMs: 10_000 })
    await vi.advanceTimersByTimeAsync(2500)
    const out = await promise
    expect(out.status).toBe('ready')
    expect(get).toHaveBeenCalledTimes(3)
  })

  it('throws TimeoutError', async () => {
    vi.useFakeTimers()
    const get = vi.fn().mockResolvedValue(result('building'))
    const promise = pollDeployment(get, { pollIntervalMs: 1000, timeoutMs: 2500 })
    const assertion = expect(promise).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(3000)
    await assertion
  })

  it('aborts on signal', async () => {
    vi.useFakeTimers()
    const get = vi.fn().mockResolvedValue(result('building'))
    const controller = new AbortController()
    const promise = pollDeployment(get, {
      pollIntervalMs: 1000,
      timeoutMs: 60_000,
      signal: controller.signal,
    })
    // Let first get complete, then abort during sleep
    await Promise.resolve()
    controller.abort(new Error('cancel'))
    await expect(promise).rejects.toThrow('cancel')
  })

  it('invokes onStatus callback', async () => {
    const statuses: string[] = []
    const get = vi
      .fn()
      .mockResolvedValueOnce(result('deploying'))
      .mockResolvedValueOnce(result('ready'))

    vi.useFakeTimers()
    const promise = pollDeployment(get, {
      pollIntervalMs: 100,
      onStatus: (r) => statuses.push(r.status),
    })
    await vi.advanceTimersByTimeAsync(200)
    await promise
    expect(statuses).toEqual(['deploying', 'ready'])
  })
})
