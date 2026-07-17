/**
 * Opt-in e2e helpers. Each provider script should skip unless
 * DEPLOYINFRA_E2E_<PROVIDER>_TOKEN is set.
 */
export const FIXTURE = new URL('./fixture-site', import.meta.url).pathname

export function requireEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.length > 0 ? value : undefined
}

export function skip(reason: string): never {
  console.log(`skip: ${reason}`)
  process.exit(0)
}

export async function assertLive(url: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Expected ${url} to be reachable, got HTTP ${res.status}`)
  }
  const body = await res.text()
  if (!body.includes('deployinfra-ok')) {
    throw new Error(`Expected fixture marker "deployinfra-ok" in ${url}`)
  }
}
