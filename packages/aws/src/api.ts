import { createHash } from 'node:crypto'
import {
  AmplifyClient,
  CreateAppCommand,
  CreateBranchCommand,
  CreateDeploymentCommand,
  DeleteAppCommand,
  DeleteBranchCommand,
  DeleteJobCommand,
  GetAppCommand,
  GetBranchCommand,
  GetJobCommand,
  LimitExceededException,
  NotFoundException,
  StartDeploymentCommand,
  UnauthorizedException,
  type App,
  type Branch,
  type Job,
  type JobSummary,
} from '@aws-sdk/client-amplify'
import type { AmplifyClientConfig } from '@aws-sdk/client-amplify'
import {
  AuthError,
  NotFoundError,
  ProviderError,
  RateLimitError,
} from '@deployinfra/sdk'
import { request } from '@deployinfra/sdk/internal'

export type AmplifyCredentials = NonNullable<AmplifyClientConfig['credentials']>

const MAX_FILE_PATH = 255

export interface AmplifyAppInfo {
  appId: string
  defaultDomain: string
  name?: string
}

export interface AmplifyBranchInfo {
  branchName: string
  displayName: string
}

export interface AmplifyDeploymentCreated {
  jobId: string
  zipUploadUrl?: string
  fileUploadUrls?: Record<string, string>
}

export interface AmplifyClientOptions {
  region: string
  credentials?: AmplifyCredentials
  signal?: AbortSignal
}

function mapSdkError(err: unknown): never {
  if (
    err instanceof AuthError ||
    err instanceof NotFoundError ||
    err instanceof RateLimitError ||
    err instanceof ProviderError
  ) {
    throw err
  }

  if (err instanceof UnauthorizedException) {
    throw new AuthError(err.message || 'AWS Amplify authentication failed', {
      cause: err,
    })
  }
  if (err instanceof LimitExceededException) {
    throw new RateLimitError(
      err.message || 'AWS Amplify quota exceeded',
      { cause: err },
    )
  }
  if (err instanceof NotFoundException) {
    throw new NotFoundError(err.message || 'AWS Amplify resource not found', {
      cause: err,
    })
  }

  const message =
    err instanceof Error ? err.message : 'AWS Amplify request failed'
  throw new ProviderError(message, { cause: err })
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    mapSdkError(err)
  }
}

/** MD5 hex digest of raw file bytes (Amplify fileMap). */
export function md5Hex(data: Uint8Array): string {
  return createHash('md5').update(data).digest('hex')
}

export function normalizeFileMapPath(path: string): string {
  const normalized = path.replace(/^\/+/, '').replace(/\\/g, '/')
  if (!normalized || normalized.includes('..')) {
    throw new ProviderError(`Unsafe Amplify file path: ${path}`)
  }
  if (normalized.length > MAX_FILE_PATH) {
    throw new ProviderError(
      `Amplify file path exceeds ${MAX_FILE_PATH} characters: ${normalized}`,
    )
  }
  return normalized
}

export function createAmplifyApi(opts: AmplifyClientOptions) {
  const client = new AmplifyClient({
    region: opts.region,
    credentials: opts.credentials,
  })
  const { signal } = opts

  return {
    async getApp(appId: string): Promise<AmplifyAppInfo> {
      const out = await run(() =>
        client.send(new GetAppCommand({ appId }), { abortSignal: signal }),
      )
      return fromApp(out.app)
    },

    async createApp(name: string): Promise<AmplifyAppInfo> {
      const out = await run(() =>
        client.send(
          new CreateAppCommand({ name, platform: 'WEB' }),
          { abortSignal: signal },
        ),
      )
      return fromApp(out.app)
    },

    async getBranch(
      appId: string,
      branchName: string,
    ): Promise<AmplifyBranchInfo> {
      const out = await run(() =>
        client.send(new GetBranchCommand({ appId, branchName }), {
          abortSignal: signal,
        }),
      )
      return fromBranch(out.branch, branchName)
    },

    async createBranch(
      appId: string,
      branchName: string,
    ): Promise<AmplifyBranchInfo> {
      const out = await run(() =>
        client.send(
          new CreateBranchCommand({
            appId,
            branchName,
            stage: 'PRODUCTION',
          }),
          { abortSignal: signal },
        ),
      )
      return fromBranch(out.branch, branchName)
    },

    async createDeployment(
      appId: string,
      branchName: string,
      fileMap?: Record<string, string>,
    ): Promise<AmplifyDeploymentCreated> {
      const out = await run(() =>
        client.send(
          new CreateDeploymentCommand({
            appId,
            branchName,
            ...(fileMap ? { fileMap } : {}),
          }),
          { abortSignal: signal },
        ),
      )
      if (!out.jobId) {
        throw new ProviderError('Amplify CreateDeployment returned no jobId')
      }
      return {
        jobId: out.jobId,
        zipUploadUrl: out.zipUploadUrl,
        fileUploadUrls: out.fileUploadUrls,
      }
    },

    async startDeployment(
      appId: string,
      branchName: string,
      jobId: string,
    ): Promise<JobSummary | undefined> {
      const out = await run(() =>
        client.send(
          new StartDeploymentCommand({ appId, branchName, jobId }),
          { abortSignal: signal },
        ),
      )
      return out.jobSummary
    },

    async getJob(
      appId: string,
      branchName: string,
      jobId: string,
    ): Promise<Job> {
      const out = await run(() =>
        client.send(new GetJobCommand({ appId, branchName, jobId }), {
          abortSignal: signal,
        }),
      )
      if (!out.job) {
        throw new NotFoundError(`Amplify job ${jobId} not found`)
      }
      return out.job
    },

    async putPresigned(
      url: string,
      body: Uint8Array,
      contentType?: string,
    ): Promise<void> {
      await request(url, {
        method: 'PUT',
        headers: contentType ? { 'content-type': contentType } : undefined,
        body: Buffer.from(body),
        signal,
      })
    },

    async deleteApp(appId: string): Promise<void> {
      await run(() =>
        client.send(new DeleteAppCommand({ appId }), { abortSignal: signal }),
      )
    },

    async deleteBranch(appId: string, branchName: string): Promise<void> {
      await run(() =>
        client.send(new DeleteBranchCommand({ appId, branchName }), {
          abortSignal: signal,
        }),
      )
    },

    async deleteJob(
      appId: string,
      branchName: string,
      jobId: string,
    ): Promise<void> {
      await run(() =>
        client.send(new DeleteJobCommand({ appId, branchName, jobId }), {
          abortSignal: signal,
        }),
      )
    },
  }
}

export type AmplifyApi = ReturnType<typeof createAmplifyApi>

function fromApp(app: App | undefined): AmplifyAppInfo {
  if (!app?.appId || !app.defaultDomain) {
    throw new ProviderError('Amplify app response missing appId/defaultDomain')
  }
  return {
    appId: app.appId,
    defaultDomain: app.defaultDomain,
    name: app.name,
  }
}

function fromBranch(
  branch: Branch | undefined,
  fallbackName: string,
): AmplifyBranchInfo {
  const branchName = branch?.branchName ?? fallbackName
  return {
    branchName,
    displayName: branch?.displayName ?? branchName,
  }
}
