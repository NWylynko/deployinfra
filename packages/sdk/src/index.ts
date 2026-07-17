/**
 * `@deployinfra/sdk` — public API for application authors.
 *
 * Stable surface: create a deployer, pass a provider, deploy a source.
 * Provider-author utilities live under `@deployinfra/sdk/internal`
 * (also semver-stable, but intended for provider packages only).
 *
 * @packageDocumentation
 */

export type {
  DeploymentStatus,
  DeploymentResult,
  WaitUntil,
  CoreDeployOptions,
  NoCallOptions,
  DeployOptions,
  DeployContext,
  DeployHooks,
  DeployStartEvent,
  DeployErrorEvent,
  FilesMap,
  DirSourceDescriptor,
  ZipSourceDescriptor,
  ZipUrlSourceDescriptor,
  TarSourceDescriptor,
  GitHubSourceDescriptor,
  FilesSourceDescriptor,
  SourceDescriptor,
  SourceInput,
  SourceFile,
  FilesSource,
  GitRemoteSource,
  ResolvedSource,
  ProviderCapabilities,
} from './types.js'

export {
  DeployError,
  AuthError,
  NotFoundError,
  RateLimitError,
  QuotaError,
  ValidationError,
  TimeoutError,
  SourceError,
  ProviderError,
} from './errors.js'

export type { Provider, ProviderSpecificationVersion } from './provider.js'
export { PROVIDER_SPECIFICATION_VERSION } from './provider.js'

export { createDeployer } from './deployer.js'
export type { CreateDeployerOptions, Deployer } from './deployer.js'

export { generateDeploySlug } from './slug.js'
