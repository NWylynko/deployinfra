import {
  createRailwayProvider,
  type RailwayDeployOptions,
  type RailwayOptions,
} from './provider.js'

export type { RailwayOptions, RailwayDeployOptions }
export { createRailwayProvider }
export { mapRailwayStatus } from './status.js'
export { createTarball } from './tarball.js'

export const name = 'railway' as const

/**
 * Create a Railway provider for use with `createDeployer`.
 *
 * Deploys via `railway up`-compatible tar.gz upload. Railway builds what you
 * send — a static directory needs a static file server in the image/config;
 * this SDK does not invent one.
 *
 * @example
 * ```ts
 * import { createDeployer } from '@deployinfra/sdk'
 * import { railway } from '@deployinfra/railway'
 *
 * const deployer = createDeployer({
 *   provider: railway({ token: process.env.RAILWAY_TOKEN! }),
 * })
 * const result = await deployer.deploy('./dist', {
 *   projectId: process.env.RAILWAY_PROJECT_ID,
 *   environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
 *   serviceId: process.env.RAILWAY_SERVICE_ID,
 * })
 * ```
 */
export function railway(options: RailwayOptions) {
  return createRailwayProvider(options)
}
