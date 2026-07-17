import {
  createNetlifyProvider,
  type NetlifyDeployOptions,
  type NetlifyOptions,
} from './provider.js'

export type { NetlifyOptions, NetlifyDeployOptions }
export { createNetlifyProvider }
export { mapNetlifyState } from './status.js'

export const name = 'netlify' as const

/**
 * Create a Netlify provider for use with `createDeployer`.
 *
 * Supports digest file deploys and zip passthrough. GitHub sources are
 * materialized to files by core (Netlify has no native git capability here).
 *
 * Pass `name` and/or `siteId` on `deploy()` — not on the factory.
 *
 * **API token:** create a personal access token at
 * {@link https://app.netlify.com/user/applications#personal-access-tokens | User settings → Applications → Personal access tokens}.
 *
 * @example
 * ```ts
 * import { createDeployer } from '@deployinfra/sdk'
 * import { netlify } from '@deployinfra/netlify'
 *
 * const deployer = createDeployer({
 *   provider: netlify({ token: process.env.NETLIFY_TOKEN! }),
 * })
 * await deployer.deploy('./dist') // new site, random name
 * await deployer.deploy('./dist', { name: 'my-site' })
 * await deployer.deploy('./dist', { siteId: process.env.NETLIFY_SITE_ID! })
 * ```
 */
export function netlify(options: NetlifyOptions) {
  return createNetlifyProvider(options)
}
