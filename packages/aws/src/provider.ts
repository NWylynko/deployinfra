import { zipSync } from 'fflate'
import {
  NotFoundError,
  ValidationError,
  type DeployContext,
  type DeploymentResult,
  type FilesSource,
  type Provider,
  type ResolvedSource,
} from '@deployinfra/sdk'
import {
  createAmplifyApi,
  normalizeFileMapPath,
  type AmplifyApi,
  type AmplifyAppInfo,
  type AmplifyBranchInfo,
  type AmplifyCredentials,
} from './api.js'
import { mapAmplifyJobStatus } from './status.js'

const MAX_ZIP_BYTES = 5 * 1024 * 1024 * 1024

/**
 * Options for {@link aws} / {@link createAwsProvider}.
 *
 * Credentials + region. Per-deploy app/branch selection goes on `deploy()`.
 */
export interface AwsOptions {
  /**
   * AWS region for Amplify Hosting (e.g. `us-east-1`).
   * Amplify apps are regional — use the region where the app lives or will be created.
   */
  region: string
  /**
   * Explicit AWS credentials (`accessKeyId` / `secretAccessKey`, optional `sessionToken`).
   *
   * When omitted, the AWS SDK default credential chain resolves
   * `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`, shared
   * config (`~/.aws/credentials` via `aws configure`), SSO, or IMDS.
   *
   * Create IAM access keys in the
   * {@link https://console.aws.amazon.com/iam/ | IAM console}
   * (Users → Security credentials → Create access key), or use a role.
   * The principal needs Amplify Hosting permissions (e.g. `amplify:*` on the
   * target apps, or a tighter policy covering create/get/start deployment and
   * optional delete).
   *
   * @see https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html
   */
  credentials?: AmplifyCredentials
}

/**
 * Per-call options accepted by `deploy()` / `getDeployment()` when using AWS Amplify.
 */
export interface AwsDeployOptions {
  /**
   * Existing Amplify app id. When set, deploys go to that app
   * (`name` is ignored for app selection).
   */
  appId?: string
  /** Branch name. Default `'main'`. Created with stage `PRODUCTION` when missing. */
  branchName?: string
}

export interface AmplifyJobRaw {
  appId: string
  branchName: string
  displayName: string
  defaultDomain: string
  jobId: string
  status?: string
  createdAt?: string
  job?: unknown
}

function deploymentUrl(displayName: string, defaultDomain: string): string {
  return `https://${displayName}.${defaultDomain}`
}

function toResult(raw: AmplifyJobRaw): DeploymentResult<AmplifyJobRaw> {
  return {
    provider: 'aws',
    deploymentId: raw.jobId,
    status: mapAmplifyJobStatus(raw.status),
    url: deploymentUrl(raw.displayName, raw.defaultDomain),
    projectId: raw.appId,
    slug: raw.branchName,
    createdAt: raw.createdAt,
    raw,
  }
}

async function collectZip(source: FilesSource): Promise<Uint8Array> {
  if (source.zipBytes) {
    return source.zipBytes()
  }

  const files: Record<string, Uint8Array> = {}
  for await (const file of source.files()) {
    const path = normalizeFileMapPath(file.path)
    files[path] = await file.read()
  }
  return zipSync(files)
}

export type AwsProvider = Provider<AmplifyJobRaw, AwsDeployOptions> & {
  deleteApp(
    appId: string,
    ctx?: DeployContext<AwsDeployOptions>,
  ): Promise<void>
  deleteBranch(
    appId: string,
    branchName: string,
    ctx?: DeployContext<AwsDeployOptions>,
  ): Promise<void>
}

export function createAwsProvider(options: AwsOptions): AwsProvider {
  const { region, credentials } = options

  let lastApp: AmplifyAppInfo | undefined
  let lastBranch: AmplifyBranchInfo | undefined

  async function ensureApp(
    api: AmplifyApi,
    ctx: DeployContext<AwsDeployOptions>,
  ): Promise<AmplifyAppInfo> {
    if (ctx.appId) {
      const app = await api.getApp(ctx.appId)
      lastApp = app
      return app
    }

    if (!ctx.name) {
      throw new ValidationError(
        'AWS Amplify needs an app — pass `appId` or `name` to deploy() ' +
          '(or use createDeployer, which generates a random slug when name is omitted)',
      )
    }

    const app = await api.createApp(ctx.name)
    lastApp = app
    return app
  }

  async function ensureBranch(
    api: AmplifyApi,
    appId: string,
    branchName: string,
  ): Promise<AmplifyBranchInfo> {
    try {
      const branch = await api.getBranch(appId, branchName)
      lastBranch = branch
      return branch
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
    }

    const branch = await api.createBranch(appId, branchName)
    lastBranch = branch
    return branch
  }

  async function uploadAndStart(
    api: AmplifyApi,
    app: AmplifyAppInfo,
    branch: AmplifyBranchInfo,
    source: FilesSource,
  ): Promise<AmplifyJobRaw> {
    const zip = await collectZip(source)
    if (zip.byteLength > MAX_ZIP_BYTES) {
      throw new ValidationError(
        `Zip exceeds Amplify Hosting 5 GB limit (${zip.byteLength} bytes)`,
      )
    }

    const created = await api.createDeployment(app.appId, branch.branchName)
    if (!created.zipUploadUrl) {
      throw new ValidationError(
        'Amplify CreateDeployment returned no zipUploadUrl',
      )
    }
    await api.putPresigned(created.zipUploadUrl, zip, 'application/zip')

    const summary = await api.startDeployment(
      app.appId,
      branch.branchName,
      created.jobId,
    )

    return {
      appId: app.appId,
      branchName: branch.branchName,
      displayName: branch.displayName,
      defaultDomain: app.defaultDomain,
      jobId: created.jobId,
      status: summary?.status ?? 'PENDING',
      createdAt: summary?.startTime?.toISOString?.(),
      job: summary,
    }
  }

  return {
    specificationVersion: 'v1',
    name: 'aws',
    capabilities: {
      sources: { files: true, git: false },
      zipPassthrough: true,
    },

    async deploy(source: ResolvedSource, ctx) {
      const files: FilesSource =
        source.kind === 'git' ? await source.materialize() : source

      const api = createAmplifyApi({
        region,
        credentials,
        signal: ctx.signal,
      })
      const app = await ensureApp(api, ctx)
      const branchName = ctx.branchName ?? 'main'
      const branch = await ensureBranch(api, app.appId, branchName)
      const raw = await uploadAndStart(api, app, branch, files)
      return toResult(raw)
    },

    async getDeployment(id, ctx) {
      const api = createAmplifyApi({
        region,
        credentials,
        signal: ctx.signal,
      })

      const appId = ctx.appId ?? lastApp?.appId
      const branchName = ctx.branchName ?? lastBranch?.branchName ?? 'main'
      if (!appId) {
        throw new ValidationError(
          'getDeployment requires appId (pass on deploy/getDeployment or reuse the same provider instance after deploy)',
        )
      }

      const app =
        lastApp?.appId === appId ? lastApp : await api.getApp(appId)
      const branch =
        lastBranch?.branchName === branchName && lastApp?.appId === appId
          ? lastBranch
          : await api.getBranch(appId, branchName)

      lastApp = app
      lastBranch = branch

      const job = await api.getJob(appId, branchName, id)
      return toResult({
        appId,
        branchName,
        displayName: branch.displayName,
        defaultDomain: app.defaultDomain,
        jobId: id,
        status: job.summary?.status,
        createdAt: job.summary?.startTime?.toISOString?.(),
        job,
      })
    },

    /** Delete an Amplify app and all of its branches/jobs. */
    async deleteApp(appId: string, ctx: DeployContext<AwsDeployOptions> = {}) {
      const api = createAmplifyApi({
        region,
        credentials,
        signal: ctx.signal,
      })
      await api.deleteApp(appId)
    },

    /** Delete a single Amplify branch (and its jobs). */
    async deleteBranch(
      appId: string,
      branchName: string,
      ctx: DeployContext<AwsDeployOptions> = {},
    ) {
      const api = createAmplifyApi({
        region,
        credentials,
        signal: ctx.signal,
      })
      await api.deleteBranch(appId, branchName)
    },
  }
}
