import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { createFixture, type E2eFixture } from './fixture.ts'
import { deployAndVerify } from './deploy.ts'
import { profile } from './env.ts'
import type { ProviderAdapter } from './providers.ts'
import { semanticSources, smokeSources } from './sources.ts'

export function describeProviderE2e(adapter: ProviderAdapter): void {
  const filteredOut = !adapter.enabled && adapter.skipReason === 'filtered out'

  if (filteredOut) {
    describe.skip(`e2e: ${adapter.name} (filtered out)`, () => {
      it('skipped by DEPLOYINFRA_E2E_PROVIDERS', () => {})
    })
    return
  }

  if (!adapter.enabled) {
    describe(`e2e: ${adapter.name}`, () => {
      it('requires credentials', () => {
        throw new Error(
          `e2e: ${adapter.name} is not configured — ${adapter.skipReason ?? 'missing credentials'}`,
        )
      })
    })
    return
  }

  describe(`e2e: ${adapter.name}`, () => {
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
