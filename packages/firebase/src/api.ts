import { NotFoundError, ValidationError } from '@deployinfra/sdk'
import { request } from '@deployinfra/sdk/internal'
import type { TokenProvider } from './auth.js'

const API = 'https://firebasehosting.googleapis.com'
const POPULATE_BATCH = 1000

export interface FirebaseSite {
  name: string
  defaultUrl?: string
  type?: string
}

export interface FirebaseVersion {
  name: string
  status?: string
  createTime?: string
  finalizeTime?: string
  fileCount?: string | number
  versionBytes?: string | number
}

export interface PopulateFilesResponse {
  uploadRequiredHashes?: string[]
  uploadUrl?: string
}

export interface FirebaseRelease {
  name: string
  version?: FirebaseVersion
  type?: string
  releaseTime?: string
}

export interface FirebaseClientOptions {
  getToken: TokenProvider
  signal?: AbortSignal
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

function sitePath(projectId: string, siteId: string): string {
  return `${API}/v1beta1/projects/${encodeURIComponent(projectId)}/sites/${encodeURIComponent(siteId)}`
}

function versionCollection(siteId: string): string {
  return `${API}/v1beta1/sites/${encodeURIComponent(siteId)}/versions`
}

function versionPath(siteId: string, versionId: string): string {
  return `${versionCollection(siteId)}/${encodeURIComponent(versionId)}`
}

/** Extract version id from `sites/{site}/versions/{id}` or full resource name. */
export function versionIdFromName(versionName: string): string {
  const parts = versionName.split('/')
  const idx = parts.lastIndexOf('versions')
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1]!
  return versionName
}

export function createFirebaseClient(opts: FirebaseClientOptions) {
  const { getToken, signal } = opts

  async function authed<T>(
    url: string,
    init: Parameters<typeof request<T>>[1] = {},
  ) {
    const token = await getToken()
    return request<T>(url, {
      ...init,
      headers: {
        ...authHeaders(token),
        ...(init.headers as Record<string, string> | undefined),
      },
      signal,
    })
  }

  return {
    async getSite(projectId: string, siteId: string): Promise<FirebaseSite> {
      const res = await authed<FirebaseSite>(sitePath(projectId, siteId))
      return res.data
    },

    async createSite(projectId: string, siteId: string): Promise<FirebaseSite> {
      const res = await authed<FirebaseSite>(
        `${API}/v1beta1/projects/${encodeURIComponent(projectId)}/sites?siteId=${encodeURIComponent(siteId)}`,
        {
          method: 'POST',
          json: {},
        },
      )
      return res.data
    },

    async createVersion(siteId: string): Promise<FirebaseVersion> {
      const res = await authed<FirebaseVersion>(versionCollection(siteId), {
        method: 'POST',
        json: {},
      })
      return res.data
    },

    async populateFiles(
      siteId: string,
      versionId: string,
      files: Record<string, string>,
    ): Promise<PopulateFilesResponse> {
      const entries = Object.entries(files)
      const required = new Set<string>()
      let uploadUrl: string | undefined

      for (let i = 0; i < entries.length; i += POPULATE_BATCH) {
        const chunk = Object.fromEntries(entries.slice(i, i + POPULATE_BATCH))
        const res = await authed<PopulateFilesResponse>(
          `${versionPath(siteId, versionId)}:populateFiles`,
          {
            method: 'POST',
            json: { files: chunk },
          },
        )
        for (const hash of res.data.uploadRequiredHashes ?? []) {
          required.add(hash)
        }
        uploadUrl = res.data.uploadUrl ?? uploadUrl
      }

      return {
        uploadRequiredHashes: [...required],
        uploadUrl,
      }
    },

    async uploadFile(
      uploadUrl: string,
      hash: string,
      gzipped: Uint8Array,
    ): Promise<void> {
      const token = await getToken()
      const base = uploadUrl.replace(/\/$/, '')
      await request(`${base}/${hash}`, {
        method: 'POST',
        headers: {
          ...authHeaders(token),
          'content-type': 'application/octet-stream',
        },
        body: Buffer.from(gzipped),
        signal,
      })
    },

    async finalizeVersion(
      siteId: string,
      versionId: string,
    ): Promise<FirebaseVersion> {
      const res = await authed<FirebaseVersion>(
        `${versionPath(siteId, versionId)}?update_mask=status`,
        {
          method: 'PATCH',
          json: { status: 'FINALIZED' },
        },
      )
      return res.data
    },

    async createRelease(
      siteId: string,
      versionName: string,
    ): Promise<FirebaseRelease> {
      const res = await authed<FirebaseRelease>(
        `${API}/v1beta1/sites/${encodeURIComponent(siteId)}/releases?versionName=${encodeURIComponent(versionName)}`,
        {
          method: 'POST',
        },
      )
      return res.data
    },

    async getVersion(
      siteId: string,
      versionId: string,
    ): Promise<FirebaseVersion> {
      const res = await authed<FirebaseVersion>(versionPath(siteId, versionId))
      return res.data
    },

    async deleteVersion(siteId: string, versionId: string): Promise<void> {
      await authed(versionPath(siteId, versionId), { method: 'DELETE' })
    },
  }
}

export type FirebaseClient = ReturnType<typeof createFirebaseClient>

export async function ensureSite(
  client: FirebaseClient,
  projectId: string,
  siteId: string,
): Promise<FirebaseSite> {
  try {
    return await client.getSite(projectId, siteId)
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err
  }

  const isDefault = siteId === projectId
  if (isDefault) {
    throw new ValidationError(
      `Firebase Hosting default site not found for project "${projectId}". ` +
        'Enable Firebase Hosting on the project in the Firebase console, then retry.',
    )
  }

  return client.createSite(projectId, siteId)
}
