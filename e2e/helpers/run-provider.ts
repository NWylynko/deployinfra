import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { createFixture, type E2eFixture } from './fixture.ts'
import { deployAndVerify, teardownTracked } from './deploy.ts'
import { profile } from './env.ts'
import type { ProviderAdapter, TrackedProvider } from './providers.ts'
import {
  githubFixtureAvailable,
  semanticSources,
  smokeSources,
} from './sources.ts'

export function describeProviderE2e(adapter: ProviderAdapter): void {
  const title = adapter.enabled
    ? `e2e: ${adapter.name}`
    : `e2e: ${adapter.name} (skipped: ${adapter.skipReason})`

  describe.skipIf(!adapter.enabled)(title, () => {
    let fixture: E2eFixture
    let tracked: TrackedProvider
    let lastDeploymentId: string | undefined
    let githubOk = false

    beforeAll(async () => {
      fixture = await createFixture()
      tracked = adapter.createTracked()
      githubOk = await githubFixtureAvailable()
    }, 30_000)

    afterAll(async () => {
      if (tracked) {
        await teardownTracked(adapter, tracked, lastDeploymentId)
      }
      await fixture?.close()
    })

    const cases = profile() === 'full' ? semanticSources() : smokeSources()

    for (const sourceCase of cases) {
      it(
        `deploys via ${sourceCase.label}`,
        async ({ skip }) => {
          if (sourceCase.label === 'github' && !githubOk) {
            skip(
              'GitHub fixture repo missing — create a public deployinfra-e2e-fixture or set DEPLOYINFRA_E2E_GITHUB_*',
            )
          }

          const outcome = await deployAndVerify(
            adapter,
            sourceCase.make(fixture),
            tracked,
          )
          lastDeploymentId = outcome.result.deploymentId
          expect(outcome.result.status).toBe('ready')
          expect(outcome.result.url).toBeTruthy()
        },
        adapter.timeoutMs + 60_000,
      )
    }
  })
}
