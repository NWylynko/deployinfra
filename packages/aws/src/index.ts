import {
  createAwsProvider,
  type AwsDeployOptions,
  type AwsOptions,
} from './provider.js'

export type { AwsOptions, AwsDeployOptions }
export { createAwsProvider }
export { mapAmplifyJobStatus } from './status.js'
export { md5Hex, normalizeFileMapPath } from './api.js'

export const name = 'aws' as const

/**
 * Create an AWS Amplify Hosting provider for use with `createDeployer`.
 *
 * Manual deploys via zip upload (passthrough or fflate-built). Pass `appId`
 * or `name` on `deploy()` — not on the factory.
 *
 * **Credentials:** omit `credentials` to use the AWS default chain
 * (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, `~/.aws/credentials`, SSO, IMDS).
 * Create IAM access keys in the
 * {@link https://console.aws.amazon.com/iam/ | IAM console}
 * with Amplify Hosting permissions. Set `region` to the Amplify app’s region.
 *
 * @example
 * ```ts
 * import { createDeployer } from '@deployinfra/sdk'
 * import { aws } from '@deployinfra/aws'
 *
 * const deployer = createDeployer({
 *   provider: aws({ region: 'us-east-1' }),
 * })
 * await deployer.deploy('./dist', { name: 'my-app' })
 * // or: { appId: process.env.AMPLIFY_APP_ID! }
 * ```
 */
export function aws(options: AwsOptions) {
  return createAwsProvider(options)
}
