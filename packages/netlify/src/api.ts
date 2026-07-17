import { AuthError, NotFoundError, ProviderError } from '@deployinfra/sdk'
import { request } from '@deployinfra/sdk/internal'

const API = 'https://api.netlify.com'

function isNotFound(err: unknown): boolean {
  return (
    err instanceof NotFoundError ||
    (err instanceof ProviderError && err.statusCode === 404) ||
    (typeof err === 'object' &&
      err !== null &&
      'name' in err &&
      (err as { name: string }).name === 'NotFoundError')
  )
}

export interface NetlifySite {
  id: string
  name: string
  ssl_url?: string
  url?: string
}

export interface NetlifyDeploy {
  id: string
  state: string
  deploy_ssl_url?: string
  ssl_url?: string
  required?: string[]
  required_functions?: string[]
  error_message?: string
  created_at?: string
  site_id?: string
  name?: string
}

export interface NetlifyClientOptions {
  token: string
  signal?: AbortSignal
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  }
}

export function createNetlifyClient(opts: NetlifyClientOptions) {
  const { token, signal } = opts

  async function getSite(siteIdOrDomain: string): Promise<NetlifySite> {
    const res = await request<NetlifySite>(
      `${API}/api/v1/sites/${encodeURIComponent(siteIdOrDomain)}`,
      {
        headers: authHeaders(token),
        signal,
      },
    )
    return res.data
  }

  return {
    getSite,

    /**
     * Look up a site by id, name, or `*.netlify.app` domain.
     * Name lookup uses `GET /sites?name=…` — bare names are not valid `{site_id}`s.
     */
    async findSite(siteIdOrName: string): Promise<NetlifySite | null> {
      // 1) Exact id / domain path (Netlify accepts id or domain like `foo.netlify.app`)
      try {
        return await getSite(siteIdOrName)
      } catch (err) {
        if (err instanceof AuthError) throw err
        if (!isNotFound(err)) throw err
      }

      // 2) Common pages domain for this name
      if (!siteIdOrName.includes('.')) {
        try {
          return await getSite(`${siteIdOrName}.netlify.app`)
        } catch (err) {
          if (err instanceof AuthError) throw err
          if (!isNotFound(err)) throw err
        }
      }

      // 3) List filter by name (canonical for slug lookup)
      const listed = await request<NetlifySite[]>(
        `${API}/api/v1/sites?name=${encodeURIComponent(siteIdOrName)}`,
        {
          headers: authHeaders(token),
          signal,
        },
      )
      const match =
        listed.data.find((s) => s.name === siteIdOrName) ?? listed.data[0]
      return match ?? null
    },

    async createSite(name?: string): Promise<NetlifySite> {
      const res = await request<NetlifySite>(`${API}/api/v1/sites`, {
        method: 'POST',
        headers: authHeaders(token),
        json: name ? { name } : {},
        signal,
      })
      return res.data
    },

    async createFileDeploy(
      siteId: string,
      files: Record<string, string>,
    ): Promise<NetlifyDeploy> {
      const res = await request<NetlifyDeploy>(
        `${API}/api/v1/sites/${siteId}/deploys`,
        {
          method: 'POST',
          headers: authHeaders(token),
          json: { files },
          signal,
        },
      )
      return res.data
    },

    async createZipDeploy(siteId: string, zip: Uint8Array): Promise<NetlifyDeploy> {
      const res = await request<NetlifyDeploy>(
        `${API}/api/v1/sites/${siteId}/deploys`,
        {
          method: 'POST',
          headers: {
            ...authHeaders(token),
            'content-type': 'application/zip',
          },
          body: Buffer.from(zip),
          signal,
        },
      )
      return res.data
    },

    async uploadFile(
      deployId: string,
      filePath: string,
      body: Uint8Array,
    ): Promise<void> {
      const encoded = filePath
        .split('/')
        .map((s) => encodeURIComponent(s))
        .join('/')
      await request(`${API}/api/v1/deploys/${deployId}/files/${encoded}`, {
        method: 'PUT',
        headers: {
          ...authHeaders(token),
          'content-type': 'application/octet-stream',
        },
        body: Buffer.from(body),
        signal,
      })
    },

    async getDeploy(deployId: string): Promise<NetlifyDeploy> {
      const res = await request<NetlifyDeploy>(
        `${API}/api/v1/deploys/${deployId}`,
        {
          headers: authHeaders(token),
          signal,
        },
      )
      return res.data
    },

    async deleteDeploy(deployId: string): Promise<void> {
      await request(`${API}/api/v1/deploys/${deployId}`, {
        method: 'DELETE',
        headers: authHeaders(token),
        signal,
      })
    },
  }
}

export type NetlifyClient = ReturnType<typeof createNetlifyClient>
