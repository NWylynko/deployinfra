import {
  createDeployer,
  type DeploymentResult,
  type SourceInput,
} from '@deployinfra/sdk'
import { assertLive } from './env.ts'
import { safeCleanup } from './cleanup.ts'
import type { ProviderAdapter } from './providers.ts'

export interface DeployOutcome {
  result: DeploymentResult
}

export async function deployAndVerify(
  adapter: ProviderAdapter,
  source: SourceInput,
): Promise<DeployOutcome> {
  const tracked = adapter.createTracked()
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
    await safeCleanup(
      `${adapter.name} teardown`,
      () => tracked.cleanup({ deploymentId }),
      primaryError,
    )
  }
}
