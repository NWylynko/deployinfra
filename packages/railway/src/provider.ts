import type {
  DeployContext,
  DeploymentResult,
  FilesSource,
  GitRemoteSource,
  Provider,
  ResolvedSource,
} from '@deployinfra/sdk'
import { createRailwayClient, type RailwayDeployment } from './api.js'
import { mapRailwayStatus } from './status.js'
import { createTarball } from './tarball.js'

/**
 * Options for {@link railway} / {@link createRailwayProvider}.
 *
 * Credentials only. Project, environment, and service selection goes on
 * each `deploy()` call.
 */
export interface RailwayOptions {
  /**
   * Railway API token. Prefer a **project token** (`Project-Access-Token`)
   * scoped to one project over an account-wide token.
   */
  token: string
}

/** Per-call Railway resource selection. Missing resources are provisioned. */
export interface RailwayDeployOptions {
  /** Existing project id; created on first deploy when omitted. */
  projectId?: string
  /** Environment id (defaults to the project's production env). */
  environmentId?: string
  /** Service id; created on first deploy when omitted. */
  serviceId?: string
}

interface Ids {
  projectId: string
  environmentId: string
  serviceId: string
}

function toResult(
  dep: RailwayDeployment,
  extras?: { url?: string },
): DeploymentResult<RailwayDeployment> {
  const url =
    extras?.url ??
    (dep.staticUrl
      ? dep.staticUrl.startsWith('http')
        ? dep.staticUrl
        : `https://${dep.staticUrl}`
      : undefined)

  return {
    provider: 'railway',
    deploymentId: dep.id,
    status: mapRailwayStatus(dep.status),
    url,
    createdAt: dep.createdAt,
    raw: dep,
  }
}

export type RailwayProvider = Provider<
  RailwayDeployment,
  RailwayDeployOptions
> & {
  deleteProject(
    projectId: string,
    ctx?: DeployContext<RailwayDeployOptions>,
  ): Promise<void>
}

export function createRailwayProvider(
  options: RailwayOptions,
): RailwayProvider {
  const { token } = options

  async function resolveIds(
    client: ReturnType<typeof createRailwayClient>,
    ctx: DeployContext<RailwayDeployOptions>,
    git?: GitRemoteSource,
  ): Promise<Ids> {
    let projectId = ctx.projectId
    if (!projectId) {
      const project = await client.projectCreate(ctx.name)
      projectId = project.id
    }

    let environmentId = ctx.environmentId
    if (!environmentId) {
      const envs = await client.environments(projectId)
      const production =
        envs.find((e) => e.name.toLowerCase() === 'production') ?? envs[0]
      if (!production) {
        throw new Error('Railway project has no environments')
      }
      environmentId = production.id
    }

    let serviceId = ctx.serviceId
    if (!serviceId) {
      const input = {
        projectId,
        name: ctx.name ?? 'web',
      }
      let service
      try {
        service = await client.serviceCreate({
          ...input,
          source: git ? { repo: `${git.owner}/${git.repo}` } : undefined,
        })
      } catch (error) {
        if (!git) throw error
        // GitHub app is not linked; create an unlinked service and upload archive.
        service = await client.serviceCreate(input)
      }
      serviceId = service.id
    }

    return { projectId, environmentId, serviceId }
  }

  async function ensureDomain(
    client: ReturnType<typeof createRailwayClient>,
    current: Ids,
  ): Promise<string | undefined> {
    try {
      const existing = await client.listDomains(current.serviceId, current.environmentId)
      if (existing[0]) {
        return existing[0].startsWith('http') ? existing[0] : `https://${existing[0]}`
      }
      const created = await client.serviceDomainCreate({
        serviceId: current.serviceId,
        environmentId: current.environmentId,
      })
      return created.domain.startsWith('http')
        ? created.domain
        : `https://${created.domain}`
    } catch {
      return undefined
    }
  }

  async function deployFiles(
    client: ReturnType<typeof createRailwayClient>,
    source: FilesSource,
    current: Ids,
  ): Promise<DeploymentResult<RailwayDeployment>> {
    const tarball = await createTarball(source)
    const up = await client.upload(
      current.projectId,
      current.environmentId,
      current.serviceId,
      tarball,
    )

    let url = up.url ?? up.deploymentDomain
    if (url && !url.startsWith('http')) url = `https://${url}`
    if (!url) url = await ensureDomain(client, current)

    return {
      provider: 'railway',
      deploymentId: up.deploymentId,
      status: 'queued',
      url,
      projectId: current.projectId,
      raw: up as unknown as RailwayDeployment,
    }
  }

  return {
    specificationVersion: 'v1',
    name: 'railway',
    capabilities: {
      sources: { files: true, git: true },
    },

    async deploy(
      source: ResolvedSource,
      ctx: DeployContext<RailwayDeployOptions>,
    ) {
      const client = createRailwayClient({ token, signal: ctx.signal })

      if (source.kind === 'git') {
        const current = await resolveIds(client, ctx, source)
        // Git metadata is linked when possible, but /up still needs an archive.
        const files = await source.materialize()
        return deployFiles(client, files, current)
      }

      const current = await resolveIds(client, ctx)
      return deployFiles(client, source, current)
    },

    async getDeployment(id, ctx) {
      const client = createRailwayClient({ token, signal: ctx.signal })
      const dep = await client.getDeployment(id)
      return toResult(dep)
    },

    /**
     * Delete a Railway project (cascades services/deployments). Requires an
     * account/team token — project-scoped tokens cannot delete projects.
     */
    async deleteProject(
      projectId: string,
      ctx: DeployContext<RailwayDeployOptions> = {},
    ) {
      const client = createRailwayClient({ token, signal: ctx.signal })
      await client.projectDelete(projectId)
    },
  }
}
