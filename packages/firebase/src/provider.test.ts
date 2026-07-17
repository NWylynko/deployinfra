import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createDeployer, ValidationError } from '@deployinfra/sdk'
import { fromFiles } from '@deployinfra/sdk/internal'
import { firebase } from './index.js'
import { mapFirebaseVersionStatus } from './status.js'

const API = 'https://firebasehosting.googleapis.com'
const UPLOAD =
  'https://upload-firebasehosting.googleapis.com/upload/sites/demo/versions/ver_1/files'

function sha256Gzip(content: string): string {
  return createHash('sha256').update(gzipSync(Buffer.from(content))).digest('hex')
}

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('mapFirebaseVersionStatus', () => {
  it('maps known statuses', () => {
    expect(mapFirebaseVersionStatus('CREATED')).toBe('deploying')
    expect(mapFirebaseVersionStatus('CLONING')).toBe('deploying')
    expect(mapFirebaseVersionStatus('FINALIZED')).toBe('ready')
    expect(mapFirebaseVersionStatus('DELETED')).toBe('canceled')
    expect(mapFirebaseVersionStatus('ABANDONED')).toBe('canceled')
    expect(mapFirebaseVersionStatus('EXPIRED')).toBe('error')
  })
})

describe('firebase provider', () => {
  it('deploys files: populate, upload gzip, finalize, release → ready', async () => {
    const html = '<h1>hi</h1>'
    const hash = sha256Gzip(html)
    let populateBody: unknown
    let uploadedAuth: string | null = null
    let uploadMagic: number[] = []
    let finalized = false
    let releasedVersion: string | null = null

    server.use(
      http.get(`${API}/v1beta1/projects/proj/sites/demo`, () =>
        HttpResponse.json({
          name: 'projects/proj/sites/demo',
          defaultUrl: 'https://demo.web.app',
          type: 'USER_SITE',
        }),
      ),
      http.post(`${API}/v1beta1/sites/demo/versions`, () =>
        HttpResponse.json({
          name: 'sites/demo/versions/ver_1',
          status: 'CREATED',
        }),
      ),
      http.post(
        `${API}/v1beta1/sites/demo/versions/ver_1:populateFiles`,
        async ({ request }) => {
          populateBody = await request.json()
          expect(request.headers.get('authorization')).toBe('Bearer test-token')
          return HttpResponse.json({
            uploadRequiredHashes: [hash],
            uploadUrl: UPLOAD,
          })
        },
      ),
      http.post(`${UPLOAD}/${hash}`, async ({ request }) => {
        uploadedAuth = request.headers.get('authorization')
        expect(request.headers.get('content-type')).toBe(
          'application/octet-stream',
        )
        const buf = new Uint8Array(await request.arrayBuffer())
        uploadMagic = [buf[0]!, buf[1]!]
        expect(createHash('sha256').update(buf).digest('hex')).toBe(hash)
        return new HttpResponse(null, { status: 200 })
      }),
      http.patch(
        `${API}/v1beta1/sites/demo/versions/ver_1`,
        async ({ request }) => {
          expect(new URL(request.url).searchParams.get('update_mask')).toBe(
            'status',
          )
          const body = (await request.json()) as { status?: string }
          expect(body.status).toBe('FINALIZED')
          finalized = true
          return HttpResponse.json({
            name: 'sites/demo/versions/ver_1',
            status: 'FINALIZED',
          })
        },
      ),
      http.post(`${API}/v1beta1/sites/demo/releases`, ({ request }) => {
        releasedVersion = new URL(request.url).searchParams.get('versionName')
        return HttpResponse.json({
          name: 'sites/demo/releases/rel_1',
          type: 'DEPLOY',
          version: {
            name: 'sites/demo/versions/ver_1',
            status: 'FINALIZED',
          },
        })
      }),
    )

    const deployer = createDeployer({
      provider: firebase({ accessToken: 'test-token' }),
    })

    const result = await deployer.deploy(
      { kind: 'files', files: { 'index.html': html } },
      {
        projectId: 'proj',
        siteId: 'demo',
        waitUntil: 'ready',
        pollIntervalMs: 10,
      },
    )

    expect(populateBody).toEqual({ files: { '/index.html': hash } })
    expect(uploadedAuth).toBe('Bearer test-token')
    expect(uploadMagic).toEqual([0x1f, 0x8b])
    expect(finalized).toBe(true)
    expect(releasedVersion).toBe('sites/demo/versions/ver_1')
    expect(result.status).toBe('ready')
    expect(result.deploymentId).toBe('sites/demo/versions/ver_1')
    expect(result.url).toBe('https://demo.web.app')
    expect(result.aliases).toEqual(['https://demo.firebaseapp.com'])
  })

  it('skips upload when uploadRequiredHashes is empty', async () => {
    let uploads = 0
    server.use(
      http.get(`${API}/v1beta1/projects/proj/sites/proj`, () =>
        HttpResponse.json({
          name: 'projects/proj/sites/proj',
          defaultUrl: 'https://proj.web.app',
          type: 'DEFAULT_SITE',
        }),
      ),
      http.post(`${API}/v1beta1/sites/proj/versions`, () =>
        HttpResponse.json({
          name: 'sites/proj/versions/v2',
          status: 'CREATED',
        }),
      ),
      http.post(`${API}/v1beta1/sites/proj/versions/v2:populateFiles`, () =>
        HttpResponse.json({ uploadRequiredHashes: [] }),
      ),
      http.post(/upload-firebasehosting/, () => {
        uploads++
        return new HttpResponse(null, { status: 200 })
      }),
      http.patch(`${API}/v1beta1/sites/proj/versions/v2`, () =>
        HttpResponse.json({
          name: 'sites/proj/versions/v2',
          status: 'FINALIZED',
        }),
      ),
      http.post(`${API}/v1beta1/sites/proj/releases`, () =>
        HttpResponse.json({ name: 'sites/proj/releases/r2' }),
      ),
    )

    const provider = firebase({ accessToken: 't' })
    const result = await provider.deploy(fromFiles({ 'a.txt': 'x' }), {
      projectId: 'proj',
    })

    expect(uploads).toBe(0)
    expect(result.status).toBe('ready')
  })

  it('errors helpfully when default site is missing', async () => {
    server.use(
      http.get(`${API}/v1beta1/projects/proj/sites/proj`, () =>
        HttpResponse.json({ error: { message: 'not found' } }, { status: 404 }),
      ),
    )

    const provider = firebase({ accessToken: 't' })
    await expect(
      provider.deploy(fromFiles({ 'a.txt': 'x' }), { projectId: 'proj' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('creates a non-default site when missing', async () => {
    let created = false
    server.use(
      http.get(`${API}/v1beta1/projects/proj/sites/extra`, () =>
        HttpResponse.json({ error: { message: 'not found' } }, { status: 404 }),
      ),
      http.post(`${API}/v1beta1/projects/proj/sites`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('siteId')).toBe('extra')
        created = true
        return HttpResponse.json({
          name: 'projects/proj/sites/extra',
          defaultUrl: 'https://extra.web.app',
          type: 'USER_SITE',
        })
      }),
      http.post(`${API}/v1beta1/sites/extra/versions`, () =>
        HttpResponse.json({
          name: 'sites/extra/versions/v1',
          status: 'CREATED',
        }),
      ),
      http.post(`${API}/v1beta1/sites/extra/versions/v1:populateFiles`, () =>
        HttpResponse.json({ uploadRequiredHashes: [] }),
      ),
      http.patch(`${API}/v1beta1/sites/extra/versions/v1`, () =>
        HttpResponse.json({
          name: 'sites/extra/versions/v1',
          status: 'FINALIZED',
        }),
      ),
      http.post(`${API}/v1beta1/sites/extra/releases`, () =>
        HttpResponse.json({ name: 'sites/extra/releases/r1' }),
      ),
    )

    const provider = firebase({ accessToken: 't' })
    const result = await provider.deploy(fromFiles({ 'a.txt': 'x' }), {
      projectId: 'proj',
      siteId: 'extra',
    })

    expect(created).toBe(true)
    expect(result.slug).toBe('extra')
  })

  it('deleteSite DELETEs the Hosting site', async () => {
    let deleted = false
    server.use(
      http.delete(`${API}/v1beta1/projects/proj/sites/extra`, () => {
        deleted = true
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await firebase({ accessToken: 't' }).deleteSite('proj', 'extra')
    expect(deleted).toBe(true)
  })
})
