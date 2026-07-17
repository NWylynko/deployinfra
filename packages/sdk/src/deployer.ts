import { ValidationError } from './errors.js'
import { pollDeployment } from './poll.js'
import {
  PROVIDER_SPECIFICATION_VERSION,
  type Provider,
} from './provider.js'
import { generateDeploySlug } from './slug.js'
import { detect } from './source/detect.js'
import { resolve } from './source/resolve.js'
import type {
  CoreDeployOptions,
  DeployContext,
  DeployHooks,
  DeployOptions,
  DeploymentResult,
  ResolvedSource,
  SourceInput,
} from './types.js'

/**
 * Factory options for {@link createDeployer}.
 * Lifecycle hooks here apply to every `deploy()`; the same hooks can also be
 * passed per call on `deploy()` and are composed (deployer first, then call).
 */
export type CreateDeployerOptions<Raw = unknown, CallOptions = {}> = {
  /** Provider implementing the v1 DeployInfra contract. */
  provider: Provider<Raw, CallOptions>
} & DeployHooks<Raw>

/**
 * High-level deployer returned by {@link createDeployer}.
 * `CallOptions` are inferred from the bound provider.
 */
export interface Deployer<Raw = unknown, CallOptions = {}> {
  readonly provider: Provider<Raw, CallOptions>
  /**
   * Detect, resolve, adapt, deploy, and optionally wait until ready.
   *
   * @param source - Local path, URL, or explicit {@link SourceDescriptor}
   * @param options - Core wait/timeout/name/hooks plus provider-specific fields
   */
  deploy(
    source: SourceInput,
    options?: DeployOptions<CallOptions>,
  ): Promise<DeploymentResult<Raw>>
  /** Fetch a previously created deployment by id. */
  getDeployment(
    id: string,
    options?: Pick<CoreDeployOptions, 'signal'> & CallOptions,
  ): Promise<DeploymentResult<Raw>>
}

/**
 * Adapt a resolved source to what the provider can accept:
 * - git + no native git → materialize to files
 * - zip passthrough: leave zipBytes on FilesSource (provider may use it)
 */
export async function adaptSource(
  source: ResolvedSource,
  provider: Pick<Provider, 'capabilities'>,
): Promise<ResolvedSource> {
  if (source.kind === 'git' && !provider.capabilities.sources.git) {
    return source.materialize()
  }
  return source
}

/**
 * Create a deployer bound to a single provider.
 *
 * Validates `provider.specificationVersion` against the core contract so
 * future breaking spec changes fail with a clear `ValidationError` instead
 * of opaque type mismatches.
 *
 * Provider-specific `deploy()` fields (e.g. Vercel `target`) are typed from
 * the provider's `CallOptions`. Lifecycle hooks may be set on this factory
 * and/or each `deploy()` call; when both are set, deployer-level runs first.
 *
 * @example
 * ```ts
 * import { createDeployer } from '@deployinfra/sdk'
 * import { vercel } from '@deployinfra/vercel'
 *
 * const deployer = createDeployer({
 *   provider: vercel({ token: process.env.VERCEL_TOKEN! }),
 *   onDeployStart: ({ name }) => console.log('deploying', name),
 *   onStatus: (r) => console.log(r.status),
 *   onDeployComplete: (r) => console.log('live', r.url),
 * })
 *
 * const result = await deployer.deploy('./dist', {
 *   name: 'my-app',
 *   target: 'production',
 *   onDeployComplete: (r) => console.log('this call done', r.url),
 * })
 * ```
 */
export function createDeployer<Raw = unknown, CallOptions = {}>(
  options: CreateDeployerOptions<Raw, CallOptions>,
): Deployer<Raw, CallOptions> {
  const {
    provider,
    onDeployStart: deployerOnDeployStart,
    onStatus: deployerOnStatus,
    onDeployComplete: deployerOnDeployComplete,
    onDeployError: deployerOnDeployError,
  } = options

  if (provider.specificationVersion !== PROVIDER_SPECIFICATION_VERSION) {
    throw new ValidationError(
      `Unsupported provider specificationVersion "${String(
        (provider as Provider).specificationVersion,
      )}"; @deployinfra/sdk expects "${PROVIDER_SPECIFICATION_VERSION}" ` +
        `(provider: ${provider.name}). Upgrade @deployinfra/sdk or the provider package.`,
    )
  }

  return {
    provider,

    async deploy(sourceInput, deployOptions = {} as DeployOptions<CallOptions>) {
      const {
        waitUntil = 'ready',
        timeoutMs = 600_000,
        pollIntervalMs = 1_000,
        signal,
        onDeployStart: callOnDeployStart,
        onStatus: callOnStatus,
        onDeployComplete: callOnDeployComplete,
        onDeployError: callOnDeployError,
        name = generateDeploySlug(),
        ...callOptions
      } = deployOptions as CoreDeployOptions & Record<string, unknown>

      const onStatus = (result: DeploymentResult) => {
        deployerOnStatus?.(result as DeploymentResult<Raw>)
        callOnStatus?.(result)
      }

      const onDeployComplete = (result: DeploymentResult<Raw>) => {
        deployerOnDeployComplete?.(result)
        callOnDeployComplete?.(result)
      }

      try {
        const startEvent = {
          source: sourceInput,
          name,
          provider: provider.name,
        }
        deployerOnDeployStart?.(startEvent)
        callOnDeployStart?.(startEvent)

        const descriptor = await detect(sourceInput)
        const resolved = await resolve(descriptor, { signal })
        const adapted = await adaptSource(resolved, provider)

        const ctx = {
          signal,
          name,
          onStatus,
          ...(callOptions as CallOptions),
        } as DeployContext<CallOptions>

        const created = await provider.deploy(adapted, ctx)
        onStatus(created)

        if (waitUntil === 'created') {
          onDeployComplete(created)
          return created
        }

        if (
          created.status === 'ready' ||
          created.status === 'error' ||
          created.status === 'canceled'
        ) {
          onDeployComplete(created)
          return created
        }

        const result = (await pollDeployment(
          () => provider.getDeployment(created.deploymentId, ctx),
          {
            waitUntil: 'ready',
            timeoutMs,
            pollIntervalMs,
            signal,
            onStatus,
          },
        )) as DeploymentResult<Raw>

        onDeployComplete(result)
        return result
      } catch (error) {
        const errorEvent = {
          source: sourceInput,
          name,
          provider: provider.name,
        }
        deployerOnDeployError?.(error, errorEvent)
        callOnDeployError?.(error, errorEvent)
        throw error
      }
    },

    async getDeployment(id, options = {} as Pick<CoreDeployOptions, 'signal'> & CallOptions) {
      const { signal, ...callOptions } = options as {
        signal?: AbortSignal
      } & CallOptions
      const ctx = {
        signal,
        ...(callOptions as CallOptions),
      } as DeployContext<CallOptions>
      return provider.getDeployment(id, ctx)
    },
  }
}
