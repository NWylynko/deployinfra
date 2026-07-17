import {
  ValidationError,
  type DeployContext,
  type DeploymentResult,
  type FilesSource,
  type Provider,
  type ResolvedSource,
} from '@deployinfra/sdk'
import { sha1 } from '@deployinfra/sdk/internal'
import { createNetlifyClient, type NetlifyClient, type NetlifyDeploy } from './api.js'
import { mapNetlifyState } from './status.js'

/**
 * Options for {@link netlify} / {@link createNetlifyProvider}.
 *
 * Credentials only. Per-deploy site selection (`name`, `siteId`) goes on `deploy()`.
 */
export interface NetlifyOptions {
  /**
   * Netlify personal access token (or OAuth access token).
   *
   * Create one at
   * {@link https://app.netlify.com/user/applications#personal-access-tokens | app.netlify.com/user/applications}
   * (User settings → Applications → Personal access tokens → New access token).
   * No special scopes are required for site create/deploy/delete used by this provider.
   */
  token: string
}

/**
 * Per-call options accepted by `deploy()` / `getDeployment()` when using Netlify.
 */
export interface NetlifyDeployOptions {
  /**
   * Existing Netlify site id. When set, deploys go to that site
   * (`name` is ignored for site selection).
   */
  siteId?: string
}

function toResult(
  deploy: NetlifyDeploy,
  siteSslUrl?: string,
): DeploymentResult<NetlifyDeploy> {
  const aliases = siteSslUrl ? [siteSslUrl] : undefined
  return {
    provider: 'netlify',
    deploymentId: deploy.id,
    status: mapNetlifyState(deploy.state),
    url: deploy.deploy_ssl_url ?? deploy.ssl_url,
    aliases,
    projectId: deploy.site_id,
    slug: deploy.name,
    createdAt: deploy.created_at,
    raw: deploy,
  }
}

function normalizePath(p: string): string {
  return p.startsWith('/') ? p : `/${p}`
}

async function buildDigestMap(
  source: FilesSource,
): Promise<{ digests: Record<string, string>; bySha: Map<string, Uint8Array> }> {
  const digests: Record<string, string> = {}
  const bySha = new Map<string, Uint8Array>()

  for await (const file of source.files()) {
    const bytes = await file.read()
    const digest = sha1(bytes)
    digests[normalizePath(file.path)] = digest
    bySha.set(digest, bytes)
  }

  return { digests, bySha }
}

export type NetlifyProvider = Provider<NetlifyDeploy, NetlifyDeployOptions> & {
  deleteSite(
    siteId: string,
    ctx?: DeployContext<NetlifyDeployOptions>,
  ): Promise<void>
}

export function createNetlifyProvider(options: NetlifyOptions): NetlifyProvider {
  const { token } = options

  async function resolveSite(
    client: NetlifyClient,
    ctx: DeployContext<NetlifyDeployOptions>,
  ): Promise<{ siteId: string; siteSslUrl?: string }> {
    const debug = (...args: unknown[]) => {
      console.error('[deployinfra:netlify]', ...args)
    }

    if (ctx.siteId) {
      debug('resolveSite via siteId', ctx.siteId)
      const site = await client.getSite(ctx.siteId)
      debug('resolved site', { id: site.id, name: site.name, ssl_url: site.ssl_url })
      return {
        siteId: site.id,
        siteSslUrl: site.ssl_url ?? site.url,
      }
    }

    if (!ctx.name) {
      throw new ValidationError(
        'Netlify needs a site — pass `siteId` or `name` to deploy() ' +
          '(or use createDeployer, which generates a random slug when name is omitted)',
      )
    }

    debug('resolveSite via name', ctx.name)
    let site = await client.findSite(ctx.name)
    if (site) {
      debug('found existing site', { id: site.id, name: site.name, ssl_url: site.ssl_url })
    } else {
      debug('no existing site; creating', ctx.name)
      try {
        site = await client.createSite(ctx.name)
        debug('created site', { id: site.id, name: site.name, ssl_url: site.ssl_url })
      } catch (err) {
        debug('createSite failed', {
          name: ctx.name,
          error: err instanceof Error ? err.message : err,
          body:
            err && typeof err === 'object' && 'body' in err
              ? (err as { body: unknown }).body
              : undefined,
        })
        throw err
      }
    }

    return {
      siteId: site.id,
      siteSslUrl: site.ssl_url ?? site.url,
    }
  }

  async function deployFiles(
    client: NetlifyClient,
    siteId: string,
    source: FilesSource,
  ): Promise<NetlifyDeploy> {
    if (source.zipBytes) {
      const zip = await source.zipBytes()
      return client.createZipDeploy(siteId, zip)
    }

    const { digests, bySha } = await buildDigestMap(source)
    const deploy = await client.createFileDeploy(siteId, digests)
    const required = deploy.required ?? []

    for (const digest of required) {
      const bytes = bySha.get(digest)
      if (!bytes) {
        throw new ValidationError(`Netlify requested unknown file digest ${digest}`)
      }
      const entry = Object.entries(digests).find(([, d]) => d === digest)
      if (!entry) {
        throw new ValidationError(`No path found for digest ${digest}`)
      }
      const filePath = entry[0]!.replace(/^\//, '')
      await client.uploadFile(deploy.id, filePath, bytes)
    }

    return deploy
  }

  return {
    specificationVersion: 'v1',
    name: 'netlify',
    capabilities: {
      sources: { files: true, git: false },
      zipPassthrough: true,
    },

    async deploy(source: ResolvedSource, ctx) {
      const files: FilesSource =
        source.kind === 'git' ? await source.materialize() : source

      const client = createNetlifyClient({ token, signal: ctx.signal })
      const { siteId, siteSslUrl } = await resolveSite(client, ctx)
      const raw = await deployFiles(client, siteId, files)
      return toResult(raw, siteSslUrl)
    },

    async getDeployment(id, ctx) {
      const client = createNetlifyClient({ token, signal: ctx.signal })
      const raw = await client.getDeploy(id)

      let siteSslUrl: string | undefined
      const siteId = ctx.siteId ?? raw.site_id
      if (siteId) {
        try {
          const site = await client.getSite(siteId)
          siteSslUrl = site.ssl_url ?? site.url
        } catch {
          // aliases are best-effort
        }
      }

      return toResult(raw, siteSslUrl)
    },

    async deleteDeployment(id, ctx) {
      const client = createNetlifyClient({ token, signal: ctx.signal })
      await client.deleteDeploy(id)
    },

    /**
     * Delete a Netlify site (cascades deploys). Prefer this over
     * {@link deleteDeployment} for the currently published deploy, which
     * cannot be deleted while live.
     */
    async deleteSite(
      siteId: string,
      ctx: DeployContext<NetlifyDeployOptions> = {},
    ) {
      const client = createNetlifyClient({ token, signal: ctx.signal })
      await client.deleteSite(siteId)
    },
  }
}
