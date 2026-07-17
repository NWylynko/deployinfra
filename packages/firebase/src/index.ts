import {
  createFirebaseProvider,
  type FirebaseDeployOptions,
  type FirebaseOptions,
} from './provider.js'

export type { FirebaseOptions, FirebaseDeployOptions }
export { createFirebaseProvider }
export { mapFirebaseVersionStatus } from './status.js'

export const name = 'firebase' as const

/**
 * Create a Firebase Hosting provider for use with `createDeployer`.
 *
 * Uploads gzipped files via the Hosting REST API (v1beta1). Pass `projectId`
 * (and optional `siteId`) on `deploy()` — not on the factory.
 *
 * **Credentials:** pass `serviceAccount` JSON from
 * {@link https://console.firebase.google.com/ | Firebase console} → Project settings →
 * Service accounts → Generate new private key, or omit it to use ADC
 * (`gcloud auth application-default login` /
 * `GOOGLE_APPLICATION_CREDENTIALS`).
 *
 * @example
 * ```ts
 * import { createDeployer } from '@deployinfra/sdk'
 * import { firebase } from '@deployinfra/firebase'
 *
 * const deployer = createDeployer({
 *   provider: firebase(), // ADC, or firebase({ serviceAccount })
 * })
 * await deployer.deploy('./dist', { projectId: 'my-project' })
 * ```
 */
export function firebase(options: FirebaseOptions = {}) {
  return createFirebaseProvider(options)
}
