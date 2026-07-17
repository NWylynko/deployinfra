import {
  AmplifyClient,
  CreateAppCommand,
  CreateBranchCommand,
  CreateDeploymentCommand,
  GetAppCommand,
  GetBranchCommand,
  GetJobCommand,
  NotFoundException,
  StartDeploymentCommand,
} from '@aws-sdk/client-amplify'
import { mockClient } from 'aws-sdk-client-mock'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { createDeployer } from '@deployinfra/sdk'
import { fromFiles, fromZipBytes } from '@deployinfra/sdk/internal'
import { aws } from './index.js'
import { mapAmplifyJobStatus } from './status.js'

const amplifyMock = mockClient(AmplifyClient)
const UPLOAD = 'https://amplify-upload.example/zip'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  amplifyMock.reset()
})
afterAll(() => server.close())

describe('mapAmplifyJobStatus', () => {
  it('maps known statuses', () => {
    expect(mapAmplifyJobStatus('CREATED')).toBe('queued')
    expect(mapAmplifyJobStatus('PENDING')).toBe('queued')
    expect(mapAmplifyJobStatus('PROVISIONING')).toBe('queued')
    expect(mapAmplifyJobStatus('RUNNING')).toBe('deploying')
    expect(mapAmplifyJobStatus('SUCCEED')).toBe('ready')
    expect(mapAmplifyJobStatus('FAILED')).toBe('error')
    expect(mapAmplifyJobStatus('CANCELLED')).toBe('canceled')
  })
})

describe('aws provider', () => {
  it('creates app/branch, uploads zip, starts job, polls ready', async () => {
    let putAuth: string | null = 'unset'
    let putMagic: number[] = []
    let createAppInput: unknown
    let createDeployInput: unknown
    let startInput: unknown
    let jobPolls = 0

    amplifyMock
      .on(CreateAppCommand)
      .callsFake((input) => {
        createAppInput = input
        return {
          app: {
            appId: 'app_1',
            name: input.name,
            defaultDomain: 'd123.amplifyapp.com',
          },
        } as never
      })
      .on(GetBranchCommand)
      .rejects(
        new NotFoundException({ message: 'not found', $metadata: {} }),
      )
      .on(CreateBranchCommand)
      .resolves({
        branch: {
          branchName: 'main',
          displayName: 'main',
        },
      } as never)
      .on(CreateDeploymentCommand)
      .callsFake((input) => {
        createDeployInput = input
        return {
          jobId: 'job_1',
          zipUploadUrl: UPLOAD,
        }
      })
      .on(StartDeploymentCommand)
      .callsFake((input) => {
        startInput = input
        return {
          jobSummary: { status: 'PENDING', jobId: 'job_1' },
        }
      })
      .on(GetJobCommand)
      .callsFake(() => {
        jobPolls++
        return {
          job: {
            summary: {
              status: jobPolls === 1 ? 'RUNNING' : 'SUCCEED',
              jobId: 'job_1',
            },
          },
        } as never
      })

    server.use(
      http.put(UPLOAD, async ({ request }) => {
        putAuth = request.headers.get('authorization')
        const buf = new Uint8Array(await request.arrayBuffer())
        putMagic = [buf[0]!, buf[1]!]
        expect(request.headers.get('content-type')).toBe('application/zip')
        return new HttpResponse(null, { status: 200 })
      }),
    )

    const deployer = createDeployer({
      provider: aws({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'AKIATEST',
          secretAccessKey: 'secret',
        },
      }),
    })

    const result = await deployer.deploy(
      { kind: 'files', files: { 'index.html': '<h1>hi</h1>' } },
      { name: 'demo-app', waitUntil: 'ready', pollIntervalMs: 10 },
    )

    expect(createAppInput).toMatchObject({ name: 'demo-app', platform: 'WEB' })
    expect(createDeployInput).toMatchObject({
      appId: 'app_1',
      branchName: 'main',
    })
    expect(startInput).toMatchObject({
      appId: 'app_1',
      branchName: 'main',
      jobId: 'job_1',
    })
    expect(putAuth).toBeNull()
    expect(putMagic).toEqual([0x50, 0x4b]) // PK
    expect(result.status).toBe('ready')
    expect(result.deploymentId).toBe('job_1')
    expect(result.projectId).toBe('app_1')
    expect(result.url).toBe('https://main.d123.amplifyapp.com')
  })

  it('uses existing appId and zip passthrough', async () => {
    const zipped = zipSync({
      'index.html': new TextEncoder().encode('<h1>zip</h1>'),
    })
    let bodySize = 0

    amplifyMock
      .on(GetAppCommand)
      .resolves({
        app: {
          appId: 'app_existing',
          defaultDomain: 'd999.amplifyapp.com',
          name: 'existing',
        },
      } as never)
      .on(GetBranchCommand)
      .resolves({
        branch: { branchName: 'main', displayName: 'main' },
      } as never)
      .on(CreateDeploymentCommand)
      .resolves({ jobId: 'job_zip', zipUploadUrl: UPLOAD })
      .on(StartDeploymentCommand)
      .resolves({
        jobSummary: { status: 'SUCCEED', jobId: 'job_zip' },
      } as never)

    server.use(
      http.put(UPLOAD, async ({ request }) => {
        bodySize = (await request.arrayBuffer()).byteLength
        return new HttpResponse(null, { status: 200 })
      }),
    )

    const provider = aws({
      region: 'us-west-2',
      credentials: { accessKeyId: 'A', secretAccessKey: 'B' },
    })
    const result = await provider.deploy(fromZipBytes(zipped), {
      appId: 'app_existing',
    })

    expect(bodySize).toBe(zipped.byteLength)
    expect(result.deploymentId).toBe('job_zip')
    expect(result.url).toBe('https://main.d999.amplifyapp.com')
  })

  it('creates branch when missing', async () => {
    amplifyMock
      .on(GetAppCommand)
      .resolves({
        app: { appId: 'app_1', defaultDomain: 'd1.amplifyapp.com' },
      } as never)
      .on(GetBranchCommand)
      .rejects(new NotFoundException({ message: 'missing', $metadata: {} }))
      .on(CreateBranchCommand)
      .resolves({
        branch: { branchName: 'prod', displayName: 'prod' },
      } as never)
      .on(CreateDeploymentCommand)
      .resolves({ jobId: 'j2', zipUploadUrl: UPLOAD })
      .on(StartDeploymentCommand)
      .resolves({
        jobSummary: { status: 'PENDING', jobId: 'j2' },
      } as never)

    server.use(
      http.put(UPLOAD, () => new HttpResponse(null, { status: 200 })),
    )

    const provider = aws({
      region: 'us-east-1',
      credentials: { accessKeyId: 'A', secretAccessKey: 'B' },
    })
    const result = await provider.deploy(
      fromFiles({ 'a.txt': 'x' }),
      { appId: 'app_1', branchName: 'prod' },
    )

    expect(result.url).toBe('https://prod.d1.amplifyapp.com')
    expect(
      amplifyMock.commandCalls(CreateBranchCommand)[0]?.args[0].input,
    ).toMatchObject({
      appId: 'app_1',
      branchName: 'prod',
      stage: 'PRODUCTION',
    })
  })
})
