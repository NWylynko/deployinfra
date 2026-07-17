import {
  ProviderError,
  ValidationError,
  type DeployContext,
  type DeploymentResult,
  type FilesSource,
  type GitRemoteSource,
  type Provider,
  type ResolvedSource,
} from '@deployinfra/sdk'
import { mapPool, sha1 } from '@deployinfra/sdk/internal'
import {
  createVercelClient,
  type VercelClient,
  type VercelDeployment,
  type VercelFileRef,
} from './api.js'
import { mapVercelReadyState } from './status.js'

/**
 * Options for {@link vercel} / {@link createVercelProvider}.
 *
 * Credentials + upload tuning. Per-deploy fields (`name`, `target`) go on `deploy()`.
 */
export interface VercelOptions {
  /**
   * Vercel access token (`vercel tokens` / account settings).
   * Needs deploy scope for the target team/account.
   */
  token: string
  /** Team id; appended as `?teamId=` on every API call when set. */
  teamId?: string
  /** Max concurrent `POST /v2/files` uploads. Default `8`. */
  uploadConcurrency?: number
}

/**
 * Per-call options accepted by `deploy()` / `getDeployment()` when using Vercel.
 */
export interface VercelDeployOptions {
  /**
   * Deployment target: `production` | `preview` | `staging` | `development`.
   * Maps to Vercel's `target` field on create.
   */
  target?: 'production' | 'preview' | 'staging' | 'development' | (string & {})
}

function toResult(dep: VercelDeployment): DeploymentResult<VercelDeployment> {
  const url = dep.url
    ? dep.url.startsWith('http')
      ? dep.url
      : `https://${dep.url}`
    : undefined

  return {
    provider: 'vercel',
    deploymentId: dep.id,
    status: mapVercelReadyState(dep.readyState),
    url,
    aliases: dep.alias?.map((a) => (a.startsWith('http') ? a : `https://${a}`)),
    projectId: dep.projectId,
    slug: dep.name,
    createdAt:
      typeof dep.createdAt === 'number'
        ? new Date(dep.createdAt).toISOString()
        : undefined,
    raw: dep,
  }
}

async function collectFileRefs(
  source: FilesSource,
): Promise<{ refs: VercelFileRef[]; uploads: { sha: string; bytes: Uint8Array }[] }> {
  const refs: VercelFileRef[] = []
  const uploads: { sha: string; bytes: Uint8Array }[] = []
  const seen = new Set<string>()

  for await (const file of source.files()) {
    const bytes = await file.read()
    const digest = sha1(bytes)
    refs.push({ file: file.path, sha: digest, size: bytes.byteLength })
    if (!seen.has(digest)) {
      seen.add(digest)
      uploads.push({ sha: digest, bytes })
    }
  }

  return { refs, uploads }
}

function resolveName(ctx: DeployContext<VercelDeployOptions>): string {
  if (!ctx.name) {
    throw new ValidationError(
      'Vercel needs a project name — pass `name` to deploy() ' +
        '(or use createDeployer, which generates a random slug when omitted)',
    )
  }
  return ctx.name
}

export function createVercelProvider(
  options: VercelOptions,
): Provider<VercelDeployment, VercelDeployOptions> {
  const { token, teamId, uploadConcurrency = 8 } = options

  async function deployFiles(
    client: VercelClient,
    source: FilesSource,
    ctx: DeployContext<VercelDeployOptions>,
  ): Promise<VercelDeployment> {
    const { refs, uploads } = await collectFileRefs(source)

    await mapPool(uploads, uploadConcurrency, async ({ sha, bytes }) => {
      try {
        await client.uploadFile(sha, bytes)
      } catch (err) {
        // 409 = already uploaded (dedupe hit) — treat as success
        if (err instanceof ProviderError && err.statusCode === 409) return
        throw err
      }
    })

    return client.createDeployment({
      name: resolveName(ctx),
      target: ctx.target,
      files: refs,
      projectSettings: { framework: null },
    })
  }

  async function deployGit(
    client: VercelClient,
    source: GitRemoteSource,
    ctx: DeployContext<VercelDeployOptions>,
  ): Promise<VercelDeployment> {
    const name = resolveName(ctx)

    try {
      return await client.createDeployment({
        name,
        target: ctx.target,
        gitSource: {
          type: 'github',
          org: source.owner,
          repo: source.repo,
          ref: source.ref,
        },
      })
    } catch (err) {
      // Fall back to archive materialization when GitHub app isn't linked
      const hint =
        err instanceof Error ? err.message : 'gitSource deploy failed'
      const files = await source.materialize()
      try {
        return await deployFiles(client, files, ctx)
      } catch (fallbackErr) {
        throw new ProviderError(
          `Vercel gitSource failed (${hint}); archive fallback also failed`,
          { cause: fallbackErr },
        )
      }
    }
  }

  return {
    specificationVersion: 'v1',
    name: 'vercel',
    capabilities: {
      sources: { files: true, git: true },
    },

    async deploy(source: ResolvedSource, ctx) {
      const client = createVercelClient({ token, teamId, signal: ctx.signal })
      const dep =
        source.kind === 'git'
          ? await deployGit(client, source, ctx)
          : await deployFiles(client, source, ctx)
      return toResult(dep)
    },

    async getDeployment(id, ctx) {
      const client = createVercelClient({ token, teamId, signal: ctx.signal })
      return toResult(await client.getDeployment(id))
    },

    async deleteDeployment(id, ctx) {
      const client = createVercelClient({ token, teamId, signal: ctx.signal })
      await client.deleteDeployment(id)
    },
  }
}
