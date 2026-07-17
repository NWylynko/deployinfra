import { gzipSync } from 'node:zlib'
import {
  ValidationError,
  type DeploymentResult,
  type FilesSource,
  type Provider,
  type ResolvedSource,
} from '@deployinfra/sdk'
import { mapPool, sha256 } from '@deployinfra/sdk/internal'
import type { JWTInput } from 'google-auth-library'
import {
  createFirebaseClient,
  ensureSite,
  versionIdFromName,
  type FirebaseRelease,
  type FirebaseVersion,
} from './api.js'
import { createTokenProvider } from './auth.js'
import { mapFirebaseVersionStatus } from './status.js'

const DEFAULT_UPLOAD_CONCURRENCY = 8

/**
 * Options for {@link firebase} / {@link createFirebaseProvider}.
 *
 * Credentials only. Project/site selection goes on `deploy()`.
 */
export interface FirebaseOptions {
  /**
   * Service account JSON object or string. When omitted, Application Default
   * Credentials (ADC) are used.
   */
  serviceAccount?: JWTInput | string
  /**
   * Inject a bearer token (tests). When set, `serviceAccount` is ignored.
   * @internal
   */
  accessToken?: string
  /** Max concurrent file uploads. Default `8`. */
  uploadConcurrency?: number
}

/**
 * Per-call options accepted by `deploy()` / `getDeployment()` when using Firebase.
 */
export interface FirebaseDeployOptions {
  /** GCP / Firebase project id (required). */
  projectId: string
  /**
   * Hosting site id. Defaults to `projectId` (the project's default site).
   * Non-default ids are created when missing.
   */
  siteId?: string
}

export interface FirebaseDeployRaw {
  version: FirebaseVersion
  release?: FirebaseRelease
  siteId: string
  projectId: string
  defaultUrl: string
}

function normalizePath(p: string): string {
  return p.startsWith('/') ? p : `/${p}`
}

function toResult(raw: FirebaseDeployRaw): DeploymentResult<FirebaseDeployRaw> {
  const url = raw.defaultUrl || `https://${raw.siteId}.web.app`
  const firebaseApp = `https://${raw.siteId}.firebaseapp.com`
  const aliases = firebaseApp === url ? undefined : [firebaseApp]

  return {
    provider: 'firebase',
    deploymentId: raw.version.name,
    status: mapFirebaseVersionStatus(raw.version.status),
    url,
    aliases,
    projectId: raw.projectId,
    slug: raw.siteId,
    createdAt: raw.version.createTime ?? raw.release?.releaseTime,
    raw,
  }
}

async function buildGzipMap(source: FilesSource): Promise<{
  files: Record<string, string>
  byHash: Map<string, Uint8Array>
}> {
  const files: Record<string, string> = {}
  const byHash = new Map<string, Uint8Array>()

  for await (const file of source.files()) {
    const path = normalizePath(file.path)
    const bytes = await file.read()
    const gzipped = gzipSync(bytes)
    const hash = sha256(gzipped)
    files[path] = hash
    byHash.set(hash, gzipped)
  }

  return { files, byHash }
}

export function createFirebaseProvider(
  options: FirebaseOptions = {},
): Provider<FirebaseDeployRaw, FirebaseDeployOptions> {
  const {
    serviceAccount,
    accessToken,
    uploadConcurrency = DEFAULT_UPLOAD_CONCURRENCY,
  } = options

  const getToken = createTokenProvider({ serviceAccount, accessToken })

  let lastSiteId: string | undefined
  let lastProjectId: string | undefined
  let lastDefaultUrl: string | undefined

  return {
    specificationVersion: 'v1',
    name: 'firebase',
    capabilities: {
      sources: { files: true, git: false },
    },

    async deploy(source: ResolvedSource, ctx) {
      if (!ctx.projectId) {
        throw new ValidationError(
          'Firebase requires `projectId` on deploy()',
        )
      }

      const siteId = ctx.siteId ?? ctx.projectId
      const filesSource: FilesSource =
        source.kind === 'git' ? await source.materialize() : source

      const client = createFirebaseClient({ getToken, signal: ctx.signal })
      const site = await ensureSite(client, ctx.projectId, siteId)
      const defaultUrl = site.defaultUrl ?? `https://${siteId}.web.app`

      lastSiteId = siteId
      lastProjectId = ctx.projectId
      lastDefaultUrl = defaultUrl

      const version = await client.createVersion(siteId)
      const versionId = versionIdFromName(version.name)
      const { files, byHash } = await buildGzipMap(filesSource)

      const populated = await client.populateFiles(siteId, versionId, files)
      const required = populated.uploadRequiredHashes ?? []
      if (required.length > 0) {
        if (!populated.uploadUrl) {
          throw new ValidationError(
            'Firebase populateFiles returned required hashes but no uploadUrl',
          )
        }
        await mapPool(required, uploadConcurrency, async (hash) => {
          const body = byHash.get(hash)
          if (!body) {
            throw new ValidationError(
              `Firebase requested unknown file hash ${hash}`,
            )
          }
          await client.uploadFile(populated.uploadUrl!, hash, body)
        })
      }

      const finalized = await client.finalizeVersion(siteId, versionId)
      const release = await client.createRelease(siteId, version.name)

      return toResult({
        version: { ...finalized, status: 'FINALIZED' },
        release,
        siteId,
        projectId: ctx.projectId,
        defaultUrl,
      })
    },

    async getDeployment(id, ctx) {
      const siteId = ctx.siteId ?? lastSiteId ?? ctx.projectId
      const projectId = ctx.projectId ?? lastProjectId
      if (!siteId) {
        throw new ValidationError(
          'getDeployment requires siteId or a prior deploy on this provider instance',
        )
      }

      const client = createFirebaseClient({ getToken, signal: ctx.signal })
      const versionId = versionIdFromName(id)
      const version = await client.getVersion(siteId, versionId)
      const defaultUrl = lastDefaultUrl ?? `https://${siteId}.web.app`

      return toResult({
        version,
        siteId,
        projectId: projectId ?? siteId,
        defaultUrl,
      })
    },

    /**
     * Deletes a Hosting version. This does **not** un-release a live site —
     * the currently released version remains until another release replaces it.
     */
    async deleteDeployment(id, ctx) {
      const siteId = ctx.siteId ?? lastSiteId ?? ctx.projectId
      if (!siteId) {
        throw new ValidationError(
          'deleteDeployment requires siteId or a prior deploy on this provider instance',
        )
      }
      const client = createFirebaseClient({ getToken, signal: ctx.signal })
      await client.deleteVersion(siteId, versionIdFromName(id))
    },
  }
}
