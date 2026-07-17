/** Deployment lifecycle status normalized across providers. */
export type DeploymentStatus =
  | 'queued'
  | 'building'
  | 'deploying'
  | 'ready'
  | 'error'
  | 'canceled'

export interface DeploymentResult<Raw = unknown> {
  provider: string
  deploymentId: string
  status: DeploymentStatus
  url?: string
  aliases?: string[]
  projectId?: string
  slug?: string
  createdAt?: string
  /** Untouched provider payload. */
  raw: Raw
}

export type WaitUntil = 'created' | 'ready'

/** Fired from `onDeployStart` after the project/site name is resolved. */
export interface DeployStartEvent {
  source: SourceInput
  name: string
  provider: string
}

/** Fired from `onDeployError` before the error is rethrown. */
export interface DeployErrorEvent {
  source: SourceInput
  name: string
  provider: string
}

/**
 * Lifecycle hooks available on both {@link createDeployer} and each `deploy()` call.
 * When both are set, the deployer-level hook runs first, then the per-call hook.
 */
export interface DeployHooks<Raw = unknown> {
  /**
   * Called once after the project/site name is resolved
   * (user-supplied or generated slug), before source detection.
   */
  onDeployStart?: (event: DeployStartEvent) => void

  /**
   * Called on deployment create and each poll tick.
   */
  onStatus?: (result: DeploymentResult<Raw>) => void

  /**
   * Called when `deploy()` is about to return successfully
   * (whether `waitUntil` is `'created'` or `'ready'`).
   */
  onDeployComplete?: (result: DeploymentResult<Raw>) => void

  /**
   * Called when `deploy()` is about to throw. The error is rethrown afterward.
   */
  onDeployError?: (error: unknown, event: DeployErrorEvent) => void
}

/**
 * Core options shared by every provider. Provider-specific per-call fields
 * are intersected via {@link DeployOptions}'s `CallOptions` type parameter
 * (inferred from the provider passed to `createDeployer`).
 */
export interface CoreDeployOptions extends DeployHooks {
  /**
   * When to resolve the returned promise.
   * - `'ready'` (default) — wait until the deployment is live (or failed/canceled)
   * - `'created'` — return as soon as the provider accepts the deployment
   */
  waitUntil?: WaitUntil

  /**
   * Overall timeout in milliseconds for waiting until `ready`.
   * Default `600_000` (10 minutes). Ignored when `waitUntil` is `'created'`.
   */
  timeoutMs?: number

  /**
   * Base poll interval in milliseconds. Core adapts from this value up to ~5s.
   * Default `1_000`.
   */
  pollIntervalMs?: number

  /** AbortSignal to cancel in-flight HTTP and polling. */
  signal?: AbortSignal

  /**
   * Project / site name on the provider.
   *
   * - **Provided** — deploy into that existing project (or create it under this name).
   * - **Omitted** — core assigns a random dashed slug (e.g. `swift-river-falcon`)
   *   and treats the deploy as a new project.
   */
  name?: string
}

/**
 * Options for {@link createDeployer}'s `deploy()` / `getDeployment()`.
 *
 * `CallOptions` is inferred from the provider — e.g. Vercel adds `target`,
 * Cloudflare adds `branch`.
 *
 * @example
 * ```ts
 * await deployer.deploy('./dist', {
 *   waitUntil: 'ready',
 *   name: 'my-site',
 *   target: 'production', // typed when using @deployinfra/vercel
 * })
 * ```
 */
/**
 * Default for providers with no per-call extras.
 * Prefer `{}` over `Record<string, never>` so intersecting with
 * {@link CoreDeployOptions} does not collapse core fields to `never`.
 */
export type NoCallOptions = {}

export type DeployOptions<CallOptions = NoCallOptions> = CoreDeployOptions &
  CallOptions

/**
 * Context passed into every provider method.
 * Includes core fields plus the provider's typed call options.
 */
export type DeployContext<CallOptions = NoCallOptions> = {
  signal?: AbortSignal
  name?: string
  onStatus?: (result: DeploymentResult) => void
} & CallOptions

/** In-memory file map: path → contents. */
export type FilesMap = Record<string, string | Uint8Array>

export interface DirSourceDescriptor {
  kind: 'dir'
  path: string
}

export interface ZipSourceDescriptor {
  kind: 'zip'
  path: string
}

export interface ZipUrlSourceDescriptor {
  kind: 'zip-url'
  url: string
}

export interface TarSourceDescriptor {
  kind: 'tar'
  path: string
}

export interface GitHubSourceDescriptor {
  kind: 'github'
  host?: 'github'
  owner: string
  repo: string
  ref?: string
}

export interface FilesSourceDescriptor {
  kind: 'files'
  files: FilesMap
}

export type SourceDescriptor =
  | DirSourceDescriptor
  | ZipSourceDescriptor
  | ZipUrlSourceDescriptor
  | TarSourceDescriptor
  | GitHubSourceDescriptor
  | FilesSourceDescriptor

/** String path/URL or explicit descriptor. */
export type SourceInput = string | SourceDescriptor

export interface SourceFile {
  path: string
  size: number
  read(): Promise<Uint8Array>
}

export interface FilesSource {
  kind: 'files'
  files(): AsyncIterable<SourceFile>
  count(): Promise<number>
  /** Present when the original input was a zip and zip passthrough is useful. */
  zipBytes?: () => Promise<Uint8Array>
}

export interface GitRemoteSource {
  kind: 'git'
  host: 'github'
  owner: string
  repo: string
  ref?: string
  materialize(): Promise<FilesSource>
}

export type ResolvedSource = FilesSource | GitRemoteSource

export interface ProviderCapabilities {
  sources: {
    files: boolean
    git: boolean
  }
  /** When true, core may pass original zip bytes instead of expanding. */
  zipPassthrough?: boolean
}
