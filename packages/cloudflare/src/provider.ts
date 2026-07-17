import {
  AuthError,
  ValidationError,
  type DeployContext,
  type DeploymentResult,
  type FilesSource,
  type Provider,
  type ResolvedSource,
} from '@deployinfra/sdk'
import { mapPool } from '@deployinfra/sdk/internal'
import {
  createCloudflareClient,
  type PagesDeployment,
  type PagesProject,
} from './api.js'
import { guessContentType, hashPagesAsset } from './hash.js'
import { mapCloudflareStage } from './status.js'

const MAX_FILES = 20_000
const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_BATCH_BYTES = 50 * 1024 * 1024
const MAX_BATCH_FILES = 5_000
const DEFAULT_UPLOAD_CONCURRENCY = 3

/**
 * Options for {@link cloudflare} / {@link createCloudflareProvider}.
 *
 * Credentials + upload tuning. Per-deploy fields (`name`, `branch`) go on `deploy()`.
 */
export interface CloudflareOptions {
  /**
   * Cloudflare API token with **Account → Cloudflare Pages → Edit**
   * (and usually **Account Settings → Read** so account APIs work).
   *
   * Create one at {@link https://dash.cloudflare.com/profile/api-tokens | dash.cloudflare.com/profile/api-tokens}
   * (My Profile → API Tokens → Create Token). Use the “Edit Cloudflare Workers”
   * template and add Pages Edit, or build a custom token with
   * `Account.Cloudflare Pages:Edit`.
   */
  token: string
  /**
   * Cloudflare account id (32-char hex).
   *
   * Find it in the dashboard URL after login (`/<account_id>/…`), on any
   * account’s overview sidebar, or via `wrangler whoami` /
   * {@link https://dash.cloudflare.com/?to=/:account/workers | Workers & Pages}.
   */
  accountId: string
  /** Max concurrent asset-batch uploads. Default `3`. */
  uploadConcurrency?: number
}

/**
 * Per-call options accepted by `deploy()` / `getDeployment()` when using Cloudflare.
 */
export interface CloudflareDeployOptions {
  /** Git branch label attached to the deployment. Default `'main'`. */
  branch?: string
}

interface HashedFile {
  path: string
  hash: string
  contentType: string
  base64: string
  size: number
}

function toResult(
  dep: PagesDeployment,
  projectName: string,
  project?: PagesProject,
): DeploymentResult<PagesDeployment> {
  const aliases = [...new Set(
    [project?.subdomain, ...(project?.domains ?? [])]
      .filter((domain): domain is string => Boolean(domain))
      .map((domain) => domain.startsWith('http') ? domain : `https://${domain}`),
  )]

  return {
    provider: 'cloudflare',
    deploymentId: dep.id,
    status: mapCloudflareStage(dep.latest_stage),
    url: dep.url,
    aliases: aliases.length > 0 ? aliases : undefined,
    projectId: projectName,
    slug: dep.project_name ?? projectName,
    createdAt: dep.created_on,
    raw: dep,
  }
}

function normalizePath(p: string): string {
  return p.startsWith('/') ? p : `/${p}`
}

function isAuthError(err: unknown): boolean {
  return (
    err instanceof AuthError ||
    (typeof err === 'object' &&
      err !== null &&
      'name' in err &&
      (err as { name: string }).name === 'AuthError')
  )
}

async function hashAll(source: FilesSource): Promise<HashedFile[]> {
  const files: HashedFile[] = []
  for await (const file of source.files()) {
    if (file.size > MAX_FILE_BYTES) {
      throw new ValidationError(
        `File ${file.path} exceeds Cloudflare Pages 25 MiB limit (${file.size} bytes)`,
      )
    }
    const bytes = await file.read()
    const hash = hashPagesAsset(bytes, file.path)
    files.push({
      path: normalizePath(file.path),
      hash,
      contentType: guessContentType(file.path),
      base64: Buffer.from(bytes).toString('base64'),
      size: bytes.byteLength,
    })
  }
  if (files.length > MAX_FILES) {
    throw new ValidationError(
      `Too many files (${files.length}); Cloudflare Pages limit is ${MAX_FILES}`,
    )
  }
  return files
}

function batchMissing(files: HashedFile[], missing: Set<string>): HashedFile[][] {
  const toUpload = files.filter((f) => missing.has(f.hash))
  const byHash = new Map<string, HashedFile>()
  for (const f of toUpload) byHash.set(f.hash, f)
  const unique = [...byHash.values()]

  const batches: HashedFile[][] = []
  let current: HashedFile[] = []
  let bytes = 0

  for (const f of unique) {
    const encodedSize = f.base64.length
    if (
      current.length >= MAX_BATCH_FILES ||
      (current.length > 0 && bytes + encodedSize > MAX_BATCH_BYTES)
    ) {
      batches.push(current)
      current = []
      bytes = 0
    }
    current.push(f)
    bytes += encodedSize
  }
  if (current.length) batches.push(current)
  return batches
}

export type CloudflareProvider = Provider<
  PagesDeployment,
  CloudflareDeployOptions
> & {
  deleteProject(
    projectName: string,
    ctx?: DeployContext<CloudflareDeployOptions>,
  ): Promise<void>
}

export function createCloudflareProvider(
  options: CloudflareOptions,
): CloudflareProvider {
  const {
    token,
    accountId,
    uploadConcurrency = DEFAULT_UPLOAD_CONCURRENCY,
  } = options
  let lastProjectName: string | undefined
  const projects = new Map<string, PagesProject>()

  function resolveProjectName(ctx: DeployContext<CloudflareDeployOptions>): string {
    const name = ctx.name ?? lastProjectName
    if (!name) {
      throw new ValidationError(
        'Cloudflare Pages needs a project name — pass `name` to deploy()',
      )
    }
    lastProjectName = name
    return name
  }

  return {
    specificationVersion: 'v1',
    name: 'cloudflare',
    capabilities: {
      sources: { files: true, git: false },
    },

    async deploy(source: ResolvedSource, ctx) {
      const projectName = resolveProjectName(ctx)
      const branch = ctx.branch ?? 'main'
      const filesSource: FilesSource =
        source.kind === 'git' ? await source.materialize() : source

      const client = createCloudflareClient({
        token,
        accountId,
        signal: ctx.signal,
      })

      let project = await client.getProject(projectName)
      if (!project) {
        project = await client.createProject(projectName)
      }
      projects.set(projectName, project)

      const hashed = await hashAll(filesSource)
      let jwt = await client.getUploadToken(projectName)

      const hashes = [...new Set(hashed.map((f) => f.hash))]
      let missingList: string[]
      try {
        missingList = await client.checkMissing(jwt, hashes)
      } catch (err) {
        if (isAuthError(err)) {
          jwt = await client.getUploadToken(projectName)
          missingList = await client.checkMissing(jwt, hashes)
        } else {
          throw err
        }
      }

      const missing = new Set(missingList)
      const batches = batchMissing(hashed, missing)

      await mapPool(batches, uploadConcurrency, async (batch) => {
        const payload = batch.map((f) => ({
          key: f.hash,
          value: f.base64,
          metadata: { contentType: f.contentType },
          base64: true as const,
        }))
        try {
          await client.uploadAssets(jwt, payload)
        } catch (err) {
          if (isAuthError(err)) {
            jwt = await client.getUploadToken(projectName)
            await client.uploadAssets(jwt, payload)
          } else {
            throw err
          }
        }
      })

      if (missing.size > 0) {
        await client.upsertHashes(jwt, [...missing])
      }

      const manifest: Record<string, string> = {}
      let headersFile: string | undefined
      let redirectsFile: string | undefined

      for (const f of hashed) {
        if (f.path === '/_headers') {
          headersFile = Buffer.from(f.base64, 'base64').toString('utf8')
          continue
        }
        if (f.path === '/_redirects') {
          redirectsFile = Buffer.from(f.base64, 'base64').toString('utf8')
          continue
        }
        manifest[f.path] = f.hash
      }

      const form = new FormData()
      form.append('manifest', JSON.stringify(manifest))
      form.append('branch', branch)
      if (headersFile !== undefined) form.append('_headers', headersFile)
      if (redirectsFile !== undefined) form.append('_redirects', redirectsFile)

      const dep = await client.createDeployment(projectName, form)
      return toResult(dep, projectName, project)
    },

    async getDeployment(id, ctx) {
      const projectName = resolveProjectName(ctx)
      const client = createCloudflareClient({
        token,
        accountId,
        signal: ctx.signal,
      })
      const dep = await client.getDeployment(projectName, id)
      let project = projects.get(projectName)
      if (!project) {
        project = (await client.getProject(projectName)) ?? undefined
        if (project) projects.set(projectName, project)
      }
      return toResult(dep, projectName, project)
    },

    /**
     * Delete a Pages project (cascades deployments). Prefer this over deleting
     * the latest branch deployment, which Cloudflare rejects.
     */
    async deleteProject(
      projectName: string,
      ctx: DeployContext<CloudflareDeployOptions> = {},
    ) {
      const client = createCloudflareClient({
        token,
        accountId,
        signal: ctx.signal,
      })
      await client.deleteProject(projectName)
      projects.delete(projectName)
      if (lastProjectName === projectName) lastProjectName = undefined
    },
  }
}
