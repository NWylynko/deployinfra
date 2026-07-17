/** Opt-in e2e helpers. Live provider tests skip unless credentials are set. */

export const MARKER = 'deployinfra-ok'

export type E2eProfile = 'smoke' | 'full'

export function env(name: string): string | undefined {
  const value = process.env[name]
  return value && value.length > 0 ? value : undefined
}

export function profile(): E2eProfile {
  return env('DEPLOYINFRA_E2E_PROFILE') === 'full' ? 'full' : 'smoke'
}

export function keepResources(): boolean {
  return env('DEPLOYINFRA_E2E_KEEP_RESOURCES') === '1'
}

/** Comma-separated allowlist; empty means all providers. */
export function providerFilter(): Set<string> | null {
  const raw = env('DEPLOYINFRA_E2E_PROVIDERS')
  if (!raw) return null
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function providerEnabled(name: string): boolean {
  const filter = providerFilter()
  return filter === null || filter.has(name)
}

export function uniqueSlug(prefix: string): string {
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${stamp}-${rand}`.slice(0, 40).replace(/-+$/g, '')
}

/** Poll until the URL serves the fixture marker (CDN/SSL can lag after deploy). */
export async function assertLive(
  url: string,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  const attempts = options.attempts ?? 12
  const delayMs = options.delayMs ?? 2_500
  let lastError: unknown

  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(
          `Expected ${url} to be reachable, got HTTP ${res.status}`,
        )
      }
      const body = await res.text()
      if (!body.includes(MARKER)) {
        throw new Error(`Expected fixture marker "${MARKER}" in ${url}`)
      }
      return
    } catch (err) {
      lastError = err
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`assertLive failed for ${url}: ${String(lastError)}`)
}
