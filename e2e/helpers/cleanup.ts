import { NotFoundError } from '@deployinfra/sdk'
import { keepResources } from './env.ts'

/** Run cleanup; ignore not-found; log other errors when a primary error already failed the test. */
export async function safeCleanup(
  label: string,
  fn: () => Promise<void>,
  primaryError?: unknown,
): Promise<void> {
  if (keepResources()) {
    console.log(`[e2e] keep resources — skip cleanup: ${label}`)
    return
  }
  try {
    await fn()
  } catch (err) {
    if (err instanceof NotFoundError) return
    if (
      err &&
      typeof err === 'object' &&
      'name' in err &&
      (err as { name: string }).name === 'NotFoundError'
    ) {
      return
    }
    if (
      err &&
      typeof err === 'object' &&
      'statusCode' in err &&
      ((err as { statusCode?: number }).statusCode === 404 ||
        (err as { statusCode?: number }).statusCode === 409)
    ) {
      return
    }
    if (primaryError) {
      console.error(`[e2e] cleanup failed (${label}):`, err)
      return
    }
    throw err
  }
}
