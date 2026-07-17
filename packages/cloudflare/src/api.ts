import { AuthError, ProviderError } from '@deployinfra/sdk'
import { request } from '@deployinfra/sdk/internal'

const API = 'https://api.cloudflare.com/client/v4'

export interface CloudflareClientOptions {
  token: string
  accountId: string
  signal?: AbortSignal
}

export interface PagesProject {
  name: string
  subdomain?: string
  domains?: string[]
  [key: string]: unknown
}

export interface PagesDeployment {
  id: string
  url?: string
  latest_stage?: { name?: string; status?: string }
  created_on?: string
  project_name?: string
  [key: string]: unknown
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

function unwrapResult<T>(data: { success?: boolean; result?: T; errors?: unknown }): T {
  if (data.success === false) {
    throw new ProviderError('Cloudflare API error', { body: data.errors ?? data })
  }
  if (data.result === undefined) {
    throw new ProviderError('Cloudflare API returned no result', { body: data })
  }
  return data.result
}

export function createCloudflareClient(opts: CloudflareClientOptions) {
  const { token, accountId, signal } = opts
  const account = `${API}/accounts/${accountId}`

  return {
    async getProject(name: string): Promise<PagesProject | null> {
      try {
        const res = await request<{ success: boolean; result: PagesProject }>(
          `${account}/pages/projects/${encodeURIComponent(name)}`,
          { headers: auth(token), signal },
        )
        return unwrapResult(res.data)
      } catch (err) {
        if (err instanceof AuthError) throw err
        if (err instanceof ProviderError && err.statusCode === 404) return null
        // NotFoundError from mapHttpError
        if (err && typeof err === 'object' && 'name' in err && err.name === 'NotFoundError') {
          return null
        }
        throw err
      }
    },

    async createProject(name: string): Promise<PagesProject> {
      const res = await request<{ success: boolean; result: PagesProject }>(
        `${account}/pages/projects`,
        {
          method: 'POST',
          headers: auth(token),
          json: { name, production_branch: 'main' },
          signal,
        },
      )
      return unwrapResult(res.data)
    },

    async getUploadToken(projectName: string): Promise<string> {
      const res = await request<{ success: boolean; result: { jwt: string } }>(
        `${account}/pages/projects/${encodeURIComponent(projectName)}/upload-token`,
        { headers: auth(token), signal },
      )
      return unwrapResult(res.data).jwt
    },

    async checkMissing(jwt: string, hashes: string[]): Promise<string[]> {
      const res = await request<{ success: boolean; result: string[] }>(
        `${API}/pages/assets/check-missing`,
        {
          method: 'POST',
          headers: auth(jwt),
          json: { hashes },
          signal,
        },
      )
      return unwrapResult(res.data)
    },

    async uploadAssets(
      jwt: string,
      files: Array<{
        key: string
        value: string
        metadata: { contentType: string }
        base64: true
      }>,
    ): Promise<void> {
      await request(`${API}/pages/assets/upload`, {
        method: 'POST',
        headers: auth(jwt),
        json: files,
        signal,
      })
    },

    async upsertHashes(jwt: string, hashes: string[]): Promise<void> {
      try {
        await request(`${API}/pages/assets/upsert-hashes`, {
          method: 'POST',
          headers: auth(jwt),
          json: { hashes },
          signal,
        })
      } catch {
        // non-fatal per plan
      }
    },

    async createDeployment(
      projectName: string,
      form: FormData,
    ): Promise<PagesDeployment> {
      const res = await request<{ success: boolean; result: PagesDeployment }>(
        `${account}/pages/projects/${encodeURIComponent(projectName)}/deployments`,
        {
          method: 'POST',
          headers: auth(token),
          body: form,
          signal,
        },
      )
      return unwrapResult(res.data)
    },

    async getDeployment(
      projectName: string,
      deploymentId: string,
    ): Promise<PagesDeployment> {
      const res = await request<{ success: boolean; result: PagesDeployment }>(
        `${account}/pages/projects/${encodeURIComponent(projectName)}/deployments/${encodeURIComponent(deploymentId)}`,
        { headers: auth(token), signal },
      )
      return unwrapResult(res.data)
    },
  }
}

export type CloudflareClient = ReturnType<typeof createCloudflareClient>
