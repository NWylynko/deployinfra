import type {
  DeployContext,
  DeploymentResult,
  ProviderCapabilities,
  ResolvedSource,
} from './types.js'

/**
 * Provider specification version currently supported by `@deployinfra/sdk`.
 * Providers must set `specificationVersion` to this value.
 */
export const PROVIDER_SPECIFICATION_VERSION = 'v1' as const

export type ProviderSpecificationVersion = typeof PROVIDER_SPECIFICATION_VERSION

/**
 * Contract every hosting provider must implement.
 *
 * `CallOptions` are provider-specific fields accepted on `deploy()` /
 * `getDeployment()` (inferred by `createDeployer`). Default is no extras.
 *
 * `deploy` should return as soon as the deployment is created; core polls
 * via `getDeployment` until the desired status.
 *
 * @example
 * ```ts
 * import type { Provider } from '@deployinfra/sdk'
 *
 * const provider: Provider = {
 *   specificationVersion: 'v1',
 *   name: 'acme',
 *   capabilities: { sources: { files: true, git: false } },
 *   async deploy(source, ctx) {
 *     return { provider: 'acme', deploymentId: 'dep_1', status: 'queued', raw: {} }
 *   },
 *   async getDeployment(id, ctx) {
 *     return { provider: 'acme', deploymentId: id, status: 'ready', url: 'https://…', raw: {} }
 *   },
 * }
 * ```
 */
export interface Provider<Raw = unknown, CallOptions = {}> {
  /**
   * Spec version this provider implements. Must be `'v1'` for the current
   * `@deployinfra/sdk`. Mismatches throw a `ValidationError` from `createDeployer`.
   */
  readonly specificationVersion: ProviderSpecificationVersion

  /** Stable provider id used in `DeploymentResult.provider` (e.g. `'vercel'`). */
  readonly name: string

  /** Declares which resolved source kinds this provider accepts natively. */
  readonly capabilities: ProviderCapabilities

  /**
   * Create a deployment from a resolved source.
   * Return when the deployment exists; do not wait for `ready` here.
   */
  deploy(
    source: ResolvedSource,
    ctx: DeployContext<CallOptions>,
  ): Promise<DeploymentResult<Raw>>

  /** Fetch the current status of an existing deployment (used by core polling). */
  getDeployment(
    id: string,
    ctx: DeployContext<CallOptions>,
  ): Promise<DeploymentResult<Raw>>

  /** Optional: tear down a deployment. */
  deleteDeployment?(id: string, ctx: DeployContext<CallOptions>): Promise<void>

  /** Optional: list recent deployments. */
  listDeployments?(ctx: DeployContext<CallOptions>): Promise<DeploymentResult<Raw>[]>
}
