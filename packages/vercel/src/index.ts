import {
  createVercelProvider,
  type VercelDeployOptions,
  type VercelOptions,
} from './provider.js'

export type { VercelOptions, VercelDeployOptions }
export { createVercelProvider }
export { mapVercelReadyState } from './status.js'

export const name = 'vercel' as const

/**
 * Create a Vercel provider for use with `createDeployer`.
 *
 * Uploads files via digest (`POST /v2/files`) or deploys a GitHub repo via
 * `gitSource` (requires the Vercel GitHub app; falls back to archive upload).
 *
 * Pass `name` / `target` on `deploy()` — not on the factory.
 *
 * @example
 * ```ts
 * import { createDeployer } from '@deployinfra/sdk'
 * import { vercel } from '@deployinfra/vercel'
 *
 * const deployer = createDeployer({
 *   provider: vercel({ token: process.env.VERCEL_TOKEN! }),
 * })
 * await deployer.deploy('./dist', { name: 'my-app', target: 'production' })
 * ```
 */
export function vercel(options: VercelOptions) {
  return createVercelProvider(options)
}
