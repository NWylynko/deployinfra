import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { createFixture, type E2eFixture } from './fixture.ts'
import { deployAndVerify } from './deploy.ts'
import { profile } from './env.ts'
import type { ProviderAdapter } from './providers.ts'
import { semanticSources, smokeSources } from './sources.ts'

export function describeProviderE2e(adapter: ProviderAdapter): void {
  const title = adapter.enabled
    ? `e2e: ${adapter.name}`
    : `e2e: ${adapter.name} (skipped: ${adapter.skipReason})`

  describe.skipIf(!adapter.enabled)(title, () => {
    let fixture: E2eFixture

    beforeAll(async () => {
      fixture = await createFixture()
    }, 30_000)

    afterAll(async () => {
      await fixture?.close()
    })

    const cases = profile() === 'full' ? semanticSources() : smokeSources()

    for (const sourceCase of cases) {
      it(
        `deploys via ${sourceCase.label}`,
        async () => {
          const outcome = await deployAndVerify(
            adapter,
            sourceCase.make(fixture),
          )
          expect(outcome.result.status).toBe('ready')
          expect(outcome.result.url).toBeTruthy()
        },
        adapter.timeoutMs + 60_000,
      )
    }
  })
}
