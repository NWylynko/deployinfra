import { TimeoutError } from './errors.js'
import type { DeploymentResult, DeploymentStatus } from './types.js'

const TERMINAL: ReadonlySet<DeploymentStatus> = new Set([
  'ready',
  'error',
  'canceled',
])

export interface PollOptions {
  timeoutMs?: number
  /** Starting interval; grows toward `maxIntervalMs`. Default 1000. */
  pollIntervalMs?: number
  maxIntervalMs?: number
  signal?: AbortSignal
  onStatus?: (result: DeploymentResult) => void
  /** Resolve when status is ready, or immediately after first poll if waitUntil is created. */
  waitUntil?: 'created' | 'ready'
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'))
      return
    }
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('Aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Poll `get` until a terminal status (or `waitUntil: 'created'` returns immediately).
 * Interval starts at `pollIntervalMs` and grows toward `maxIntervalMs` (default 5s).
 */
export async function pollDeployment(
  get: () => Promise<DeploymentResult>,
  options: PollOptions = {},
): Promise<DeploymentResult> {
  const {
    timeoutMs = 600_000,
    pollIntervalMs = 1_000,
    maxIntervalMs = 5_000,
    signal,
    onStatus,
    waitUntil = 'ready',
  } = options

  if (waitUntil === 'created') {
    const result = await get()
    onStatus?.(result)
    return result
  }

  const deadline = Date.now() + timeoutMs
  let interval = pollIntervalMs
  let last: DeploymentResult | undefined

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('Aborted')
    }

    last = await get()
    onStatus?.(last)

    if (TERMINAL.has(last.status)) {
      return last
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) break

    await sleep(Math.min(interval, remaining), signal)
    interval = Math.min(interval * 1.5, maxIntervalMs)
  }

  throw new TimeoutError('Timed out waiting for deployment', {
    lastStatus: last?.status,
  })
}
