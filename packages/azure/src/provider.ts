import { zipSync } from 'fflate'
import {
  ValidationError,
  type DeploymentResult,
  type FilesSource,
  type Provider,
  type ResolvedSource,
} from '@deployinfra/sdk'
import {
  createAzureClient,
  defaultAppUrl,
  defaultScmHost,
  type KuduDeployment,
} from './api.js'
import {
  createAuthHeaderProvider,
  DEFAULT_ENTRA_SCOPE,
  type AzureCredentials,
} from './auth.js'
import { mapKuduDeployStatus } from './status.js'

const MAX_ZIP_BYTES = 2 * 1024 * 1024 * 1024

/**
 * Options for {@link azure} / {@link createAzureProvider}.
 *
 * Credentials + optional host overrides. App selection goes on `deploy()`.
 *
 * Requires a **pre-existing** App Service web app (`az webapp up` or portal).
 * This provider does not provision resource groups, plans, or SKUs.
 */
export interface AzureOptions {
  credentials: AzureCredentials
  /**
   * Override SCM host (without scheme), e.g. `myapp.scm.azurewebsites.net`.
   * When omitted, derived from `appName` (+ `slot`) on each deploy.
   */
  scmHost?: string
  /**
   * Public site URL override. Useful when the app has a unique default hostname
   * or custom domain. Publish profiles often include `destinationAppUrl`.
   */
  appUrl?: string
  /**
   * Entra token scope. Default `https://appservice.azure.com/.default`.
   * Set for sovereign clouds if needed.
   */
  entraScope?: string
}

/**
 * Per-call options accepted by `deploy()` / `getDeployment()` when using Azure.
 */
export interface AzureDeployOptions {
  /** Existing App Service app name (required). */
  appName: string
  /** Deployment slot name (optional). */
  slot?: string
}

export interface AzureDeployRaw {
  deployment: KuduDeployment
  appName: string
  slot?: string
  appUrl: string
}

function toResult(
  deploymentId: string,
  raw: AzureDeployRaw,
): DeploymentResult<AzureDeployRaw> {
  return {
    provider: 'azure',
    deploymentId,
    status: mapKuduDeployStatus(raw.deployment.status, raw.deployment.complete),
    url: raw.appUrl,
    projectId: raw.appName,
    slug: raw.slot ? `${raw.appName}/${raw.slot}` : raw.appName,
    createdAt: raw.deployment.received_time ?? raw.deployment.start_time,
    raw,
  }
}

async function collectZip(source: FilesSource): Promise<Uint8Array> {
  if (source.zipBytes) {
    return source.zipBytes()
  }

  const files: Record<string, Uint8Array> = {}
  for await (const file of source.files()) {
    const path = file.path.replace(/^\/+/, '')
    files[path] = await file.read()
  }
  return zipSync(files)
}

export function createAzureProvider(
  options: AzureOptions,
): Provider<AzureDeployRaw, AzureDeployOptions> {
  const {
    credentials,
    scmHost: scmHostOpt,
    appUrl: appUrlOpt,
    entraScope = DEFAULT_ENTRA_SCOPE,
  } = options

  const getAuthHeaders = createAuthHeaderProvider(credentials, entraScope)

  let lastAppName: string | undefined
  let lastSlot: string | undefined
  let lastAppUrl: string | undefined

  function resolveScmBase(appName: string, slot?: string): string {
    const host = scmHostOpt ?? defaultScmHost(appName, slot)
    return host.startsWith('http') ? host : `https://${host}`
  }

  function resolveAppUrl(appName: string, slot?: string): string {
    return appUrlOpt ?? lastAppUrl ?? defaultAppUrl(appName, slot)
  }

  return {
    specificationVersion: 'v1',
    name: 'azure',
    capabilities: {
      sources: { files: true, git: false },
      zipPassthrough: true,
    },

    async deploy(source: ResolvedSource, ctx) {
      if (!ctx.appName) {
        throw new ValidationError(
          'Azure requires `appName` on deploy() (create the web app first, e.g. `az webapp up`)',
        )
      }

      const files: FilesSource =
        source.kind === 'git' ? await source.materialize() : source
      const zip = await collectZip(files)
      if (zip.byteLength > MAX_ZIP_BYTES) {
        throw new ValidationError(
          `Zip exceeds Azure App Service ~2 GB limit (${zip.byteLength} bytes)`,
        )
      }

      const client = createAzureClient({
        scmBaseUrl: resolveScmBase(ctx.appName, ctx.slot),
        getAuthHeaders,
        signal: ctx.signal,
      })

      const published = await client.publishZip(zip)
      const appUrl = resolveAppUrl(ctx.appName, ctx.slot)

      lastAppName = ctx.appName
      lastSlot = ctx.slot
      lastAppUrl = appUrl

      return toResult(published.deploymentId, {
        deployment: {
          id: published.deploymentId,
          status: 2,
          complete: false,
        },
        appName: ctx.appName,
        slot: ctx.slot,
        appUrl,
      })
    },

    async getDeployment(id, ctx) {
      const appName = ctx.appName ?? lastAppName
      if (!appName) {
        throw new ValidationError(
          'getDeployment requires appName (pass on deploy/getDeployment or reuse the same provider instance after deploy)',
        )
      }
      const slot = ctx.slot ?? lastSlot
      const client = createAzureClient({
        scmBaseUrl: resolveScmBase(appName, slot),
        getAuthHeaders,
        signal: ctx.signal,
      })

      const deployment = await client.getDeployment(id)
      return toResult(id, {
        deployment,
        appName,
        slot,
        appUrl: resolveAppUrl(appName, slot),
      })
    },
  }
}
