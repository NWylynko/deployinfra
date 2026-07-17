import {
  createDeployer,
  type DeploymentResult,
  type SourceInput,
} from '@deployinfra/sdk'
import { assertLive } from './env.ts'
import { safeCleanup } from './cleanup.ts'
import type { ProviderAdapter, TrackedProvider } from './providers.ts'

export interface DeployOutcome {
  result: DeploymentResult
}

export async function deployAndVerify(
  adapter: ProviderAdapter,
  source: SourceInput,
  tracked: TrackedProvider,
  options: { cleanup?: boolean } = {},
): Promise<DeployOutcome> {
  const { cleanup = false } = options
  let deploymentId: string | undefined
  let primaryError: unknown

  try {
    const deployer = createDeployer({
      provider: tracked.provider as never,
    })

    const call = tracked.deployOptions()
    const result = await deployer.deploy(source, {
      ...call,
      waitUntil: 'ready',
      timeoutMs: adapter.timeoutMs,
      pollIntervalMs: 2_000,
      onStatus(r) {
        deploymentId ??= r.deploymentId
        tracked.onStatus?.(r)
      },
    })

    if (result.status !== 'ready' || !result.url) {
      throw new Error(
        `Expected ready deployment with url from ${adapter.name}, got ${JSON.stringify(result)}`,
      )
    }

    if (adapter.assertLive !== false) {
      await assertLive(result.url)
    }

    return { result }
  } catch (err) {
    primaryError = err
    throw err
  } finally {
    if (cleanup) {
      await safeCleanup(
        `${adapter.name} teardown`,
        () => tracked.cleanup({ deploymentId }),
        primaryError,
      )
    }
  }
}

export async function teardownTracked(
  adapter: ProviderAdapter,
  tracked: TrackedProvider,
  deploymentId?: string,
): Promise<void> {
  await safeCleanup(
    `${adapter.name} teardown`,
    () => tracked.cleanup({ deploymentId }),
  )
}
