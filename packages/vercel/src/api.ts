import { request } from '@deployinfra/sdk/internal'

const API = 'https://api.vercel.com'

export interface VercelClientOptions {
  token: string
  teamId?: string
  signal?: AbortSignal
}

export interface VercelFileRef {
  file: string
  sha: string
  size: number
}

export interface VercelGitSource {
  type: 'github'
  org: string
  repo: string
  ref?: string
}

export interface VercelDeployment {
  id: string
  url?: string
  name?: string
  projectId?: string
  readyState?: string
  alias?: string[]
  createdAt?: number
  errorMessage?: string
  [key: string]: unknown
}

function withTeam(path: string, teamId?: string): string {
  if (!teamId) return `${API}${path}`
  const sep = path.includes('?') ? '&' : '?'
  return `${API}${path}${sep}teamId=${encodeURIComponent(teamId)}`
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

export function createVercelClient(opts: VercelClientOptions) {
  const { token, teamId, signal } = opts

  return {
    async uploadFile(sha: string, body: Uint8Array): Promise<void> {
      await request(withTeam('/v2/files', teamId), {
        method: 'POST',
        headers: {
          ...authHeaders(token),
          'content-type': 'application/octet-stream',
          'x-vercel-digest': sha,
        },
        body: Buffer.from(body),
        signal,
      })
    },

    async createDeployment(input: {
      name?: string
      target?: string
      files?: VercelFileRef[]
      gitSource?: VercelGitSource
      projectSettings?: { framework?: string | null }
    }): Promise<VercelDeployment> {
      const res = await request<VercelDeployment>(
        withTeam('/v13/deployments?skipAutoDetectionConfirmation=1', teamId),
        {
          method: 'POST',
          headers: authHeaders(token),
          json: input,
          signal,
        },
      )
      return res.data
    },

    async getDeployment(id: string): Promise<VercelDeployment> {
      const res = await request<VercelDeployment>(
        withTeam(`/v13/deployments/${encodeURIComponent(id)}`, teamId),
        {
          headers: authHeaders(token),
          signal,
        },
      )
      return res.data
    },

    async deleteDeployment(id: string): Promise<void> {
      await request(withTeam(`/v13/deployments/${encodeURIComponent(id)}`, teamId), {
        method: 'DELETE',
        headers: authHeaders(token),
        signal,
      })
    },

    /** Delete a project and all of its deployments. */
    async deleteProject(idOrName: string): Promise<void> {
      await request(
        withTeam(`/v9/projects/${encodeURIComponent(idOrName)}`, teamId),
        {
          method: 'DELETE',
          headers: authHeaders(token),
          signal,
        },
      )
    },
  }
}

export type VercelClient = ReturnType<typeof createVercelClient>
