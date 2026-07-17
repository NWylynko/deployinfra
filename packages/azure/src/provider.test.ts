import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { AuthError, createDeployer } from '@deployinfra/sdk'
import { fromFiles, fromZipBytes } from '@deployinfra/sdk/internal'
import { azure } from './index.js'
import { mapKuduDeployStatus } from './status.js'
import type { TokenCredential } from '@azure/identity'

const SCM = 'https://myapp.scm.azurewebsites.net'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('mapKuduDeployStatus', () => {
  it('maps known ints', () => {
    expect(mapKuduDeployStatus(0)).toBe('queued')
    expect(mapKuduDeployStatus(1)).toBe('building')
    expect(mapKuduDeployStatus(2)).toBe('deploying')
    expect(mapKuduDeployStatus(3)).toBe('error')
    expect(mapKuduDeployStatus(4)).toBe('ready')
    expect(mapKuduDeployStatus(undefined, false)).toBe('deploying')
  })
})

describe('azure provider', () => {
  it('publish-profile: zip deploy, polls 2→4', async () => {
    let polls = 0
    let query = ''
    let auth: string | null = null
    let magic: number[] = []
    let contentType: string | null = null

    server.use(
      http.post(`${SCM}/api/publish`, async ({ request }) => {
        query = new URL(request.url).search
        auth = request.headers.get('authorization')
        contentType = request.headers.get('content-type')
        const buf = new Uint8Array(await request.arrayBuffer())
        magic = [buf[0]!, buf[1]!]
        return new HttpResponse(null, {
          status: 202,
          headers: {
            'SCM-DEPLOYMENT-ID': 'dep-123',
            Location: `${SCM}/api/deployments/latest?deployer=OneDeploy`,
          },
        })
      }),
      http.get(`${SCM}/api/deployments/dep-123`, () => {
        polls++
        return HttpResponse.json({
          id: 'dep-123',
          status: polls === 1 ? 2 : 4,
          complete: polls > 1,
        })
      }),
    )

    const expectedBasic = `Basic ${Buffer.from('user:pass', 'utf8').toString('base64')}`

    const deployer = createDeployer({
      provider: azure({
        credentials: {
          kind: 'publishProfile',
          username: 'user',
          password: 'pass',
        },
      }),
    })

    const result = await deployer.deploy(
      { kind: 'files', files: { 'index.html': '<h1>hi</h1>' } },
      { appName: 'myapp', waitUntil: 'ready', pollIntervalMs: 10 },
    )

    expect(query).toBe('?type=zip&async=true')
    expect(auth).toBe(expectedBasic)
    expect(contentType).toBe('application/zip')
    expect(magic).toEqual([0x50, 0x4b])
    expect(result.deploymentId).toBe('dep-123')
    expect(result.status).toBe('ready')
    expect(result.url).toBe('https://myapp.azurewebsites.net')
  })

  it('entra credential: bearer auth + failure status 3', async () => {
    const credential: TokenCredential = {
      getToken: async () => ({
        token: 'entra-token',
        expiresOnTimestamp: Date.now() + 60_000,
      }),
    }

    server.use(
      http.post(`${SCM}/api/publish`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer entra-token')
        return new HttpResponse(null, {
          status: 202,
          headers: { 'SCM-DEPLOYMENT-ID': 'dep-fail' },
        })
      }),
      http.get(`${SCM}/api/deployments/dep-fail`, () =>
        HttpResponse.json({ id: 'dep-fail', status: 3, complete: true }),
      ),
    )

    const deployer = createDeployer({
      provider: azure({
        credentials: { kind: 'entra', credential },
        entraScope: 'https://appservice.azure.com/.default',
      }),
    })

    const result = await deployer.deploy(
      { kind: 'files', files: { 'a.txt': 'x' } },
      { appName: 'myapp', waitUntil: 'ready', pollIntervalMs: 10 },
    )
    expect(result.status).toBe('error')
    expect(result.deploymentId).toBe('dep-fail')
  })

  it('zip passthrough preserves bytes', async () => {
    const zipped = zipSync({
      'index.html': new TextEncoder().encode('<h1>zip</h1>'),
    })
    let bodySize = 0

    server.use(
      http.post(`${SCM}/api/publish`, async ({ request }) => {
        bodySize = (await request.arrayBuffer()).byteLength
        return new HttpResponse(null, {
          status: 202,
          headers: { 'SCM-DEPLOYMENT-ID': 'dep-zip' },
        })
      }),
    )

    const provider = azure({
      credentials: {
        kind: 'publishProfile',
        username: 'u',
        password: 'p',
      },
    })
    const result = await provider.deploy(fromZipBytes(zipped), {
      appName: 'myapp',
    })

    expect(bodySize).toBe(zipped.byteLength)
    expect(result.status).toBe('deploying')
    expect(result.deploymentId).toBe('dep-zip')
  })

  it('maps 401 to AuthError with SCM hint', async () => {
    server.use(
      http.post(`${SCM}/api/publish`, () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
      ),
    )

    const provider = azure({
      credentials: {
        kind: 'publishProfile',
        username: 'u',
        password: 'bad',
      },
    })

    await expect(
      provider.deploy(fromFiles({ 'a.txt': 'x' }), { appName: 'myapp' }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof AuthError &&
        err.message.includes('SCM basic auth may be disabled'),
    )
  })
})
