import {
  createAzureProvider,
  type AzureDeployOptions,
  type AzureOptions,
} from './provider.js'

export type { AzureOptions, AzureDeployOptions }
export type {
  AzureCredentials,
  PublishProfileCredentials,
  EntraClientSecretCredentials,
  EntraTokenCredentialCredentials,
} from './auth.js'
export { createAzureProvider }
export { mapKuduDeployStatus } from './status.js'
export { DEFAULT_ENTRA_SCOPE } from './auth.js'

export const name = 'azure' as const

/**
 * Create an Azure App Service provider for use with `createDeployer`.
 *
 * Publishes a zip via Kudu OneDeploy (`/api/publish?type=zip&async=true`).
 * Requires a pre-existing web app — pass `appName` on `deploy()`.
 *
 * @example
 * ```ts
 * import { createDeployer } from '@deployinfra/sdk'
 * import { azure } from '@deployinfra/azure'
 *
 * const deployer = createDeployer({
 *   provider: azure({
 *     credentials: {
 *       kind: 'publishProfile',
 *       username: process.env.AZURE_PUBLISH_USER!,
 *       password: process.env.AZURE_PUBLISH_PASSWORD!,
 *     },
 *   }),
 * })
 * await deployer.deploy('./dist', { appName: 'my-webapp' })
 * ```
 */
export function azure(options: AzureOptions) {
  return createAzureProvider(options)
}
