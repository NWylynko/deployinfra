import { request } from '@deployinfra/sdk/internal'

const GQL = 'https://backboard.railway.com/graphql/v2'
const UP_BASE = 'https://backboard.railway.com'

export interface RailwayClientOptions {
  token: string
  signal?: AbortSignal
}

export interface RailwayDeployment {
  id: string
  status?: string
  staticUrl?: string
  url?: string
  createdAt?: string
  [key: string]: unknown
}

function authHeaders(token: string): Record<string, string> {
  // Project tokens use Project-Access-Token; account tokens use Bearer.
  // Heuristic: project tokens are typically longer JWTs without "railway" prefix —
  // callers can pass either; we send both-compatible headers by detecting.
  if (token.startsWith('railway_') || token.length < 40) {
    return { authorization: `Bearer ${token}` }
  }
  // Prefer Project-Access-Token for project tokens (recommended)
  return {
    'project-access-token': token,
    authorization: `Bearer ${token}`,
  }
}

export function createRailwayClient(opts: RailwayClientOptions) {
  const { token, signal } = opts

  async function graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const res = await request<{ data?: T; errors?: Array<{ message: string }> }>(
      GQL,
      {
        method: 'POST',
        headers: {
          ...authHeaders(token),
          'content-type': 'application/json',
        },
        json: { query, variables },
        signal,
      },
    )
    if (res.data.errors?.length) {
      throw new Error(res.data.errors.map((e) => e.message).join('; '))
    }
    if (!res.data.data) {
      throw new Error('Railway GraphQL returned no data')
    }
    return res.data.data
  }

  return {
    graphql,

    async projectCreate(name?: string): Promise<{ id: string }> {
      const data = await graphql<{ projectCreate: { id: string } }>(
        `mutation($input: ProjectCreateInput!) {
          projectCreate(input: $input) { id }
        }`,
        { input: { name: name ?? 'deployinfra' } },
      )
      return data.projectCreate
    },

    async serviceCreate(input: {
      projectId: string
      name?: string
      source?: { repo?: string }
    }): Promise<{ id: string }> {
      const data = await graphql<{ serviceCreate: { id: string } }>(
        `mutation($input: ServiceCreateInput!) {
          serviceCreate(input: $input) { id }
        }`,
        {
          input: {
            projectId: input.projectId,
            name: input.name ?? 'web',
            source: input.source,
          },
        },
      )
      return data.serviceCreate
    },

    async environments(projectId: string): Promise<Array<{ id: string; name: string }>> {
      const data = await graphql<{
        project: { environments: { edges: Array<{ node: { id: string; name: string } }> } }
      }>(
        `query($id: String!) {
          project(id: $id) {
            environments { edges { node { id name } } }
          }
        }`,
        { id: projectId },
      )
      return data.project.environments.edges.map((e) => e.node)
    },

    async serviceDomainCreate(input: {
      serviceId: string
      environmentId: string
    }): Promise<{ domain: string }> {
      const data = await graphql<{
        serviceDomainCreate: { domain: string }
      }>(
        `mutation($input: ServiceDomainCreateInput!) {
          serviceDomainCreate(input: $input) { domain }
        }`,
        { input },
      )
      return data.serviceDomainCreate
    },

    async listDomains(serviceId: string, environmentId: string): Promise<string[]> {
      const data = await graphql<{
        domains: { serviceDomains: Array<{ domain: string }> }
      }>(
        `query($serviceId: String!, $environmentId: String!) {
          domains(serviceId: $serviceId, environmentId: $environmentId) {
            serviceDomains { domain }
          }
        }`,
        { serviceId, environmentId },
      )
      return data.domains.serviceDomains.map((d) => d.domain)
    },

    async getDeployment(id: string): Promise<RailwayDeployment> {
      const data = await graphql<{ deployment: RailwayDeployment }>(
        `query($id: String!) {
          deployment(id: $id) {
            id status staticUrl createdAt
          }
        }`,
        { id },
      )
      return data.deployment
    },

    async upload(
      projectId: string,
      environmentId: string,
      serviceId: string,
      tarball: Uint8Array,
    ): Promise<{ deploymentId: string; url?: string; deploymentDomain?: string }> {
      const url = `${UP_BASE}/project/${projectId}/environment/${environmentId}/up?serviceId=${encodeURIComponent(serviceId)}`
      const res = await request<{
        deploymentId: string
        url?: string
        deploymentDomain?: string
      }>(url, {
        method: 'POST',
        headers: {
          ...authHeaders(token),
          'content-type': 'application/gzip',
        },
        body: Buffer.from(tarball),
        signal,
      })
      return res.data
    },
  }
}

export type RailwayClient = ReturnType<typeof createRailwayClient>
