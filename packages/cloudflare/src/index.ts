import {
  createCloudflareProvider,
  type CloudflareDeployOptions,
  type CloudflareOptions,
} from './provider.js'

export type { CloudflareOptions, CloudflareDeployOptions }
export { createCloudflareProvider }
export { hashPagesAsset, guessContentType } from './hash.js'
export { mapCloudflareStage } from './status.js'

export const name = 'cloudflare' as const

/**
 * Create a Cloudflare Pages provider for use with `createDeployer`.
 *
 * Uses wrangler-compatible direct upload (BLAKE3 asset hashes, JWT upload
 * token). Enforces Pages limits client-side: 20 000 files, 25 MiB/file.
 *
 * Pass `name` / `branch` on `deploy()` — not on the factory.
 *
 * @example
 * ```ts
 * import { createDeployer } from '@deployinfra/sdk'
 * import { cloudflare } from '@deployinfra/cloudflare'
 *
 * const deployer = createDeployer({
 *   provider: cloudflare({
 *     token: process.env.CLOUDFLARE_API_TOKEN!,
 *     accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
 *   }),
 * })
 * await deployer.deploy('./dist', { name: 'my-site', branch: 'main' })
 * ```
 */
export function cloudflare(options: CloudflareOptions) {
  return createCloudflareProvider(options)
}
