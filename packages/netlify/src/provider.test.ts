import { createHash } from 'node:crypto'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { AuthError, createDeployer } from '@deployinfra/sdk'
import { fromFiles, fromZipBytes, sha1 } from '@deployinfra/sdk/internal'
import { netlify } from './index.js'
import { mapNetlifyState } from './status.js'

const API = 'https://api.netlify.com'

function digest(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('mapNetlifyState', () => {
  it('maps known states', () => {
    expect(mapNetlifyState('ready')).toBe('ready')
    expect(mapNetlifyState('error')).toBe('error')
    expect(mapNetlifyState('processing')).toBe('deploying')
    expect(mapNetlifyState('new')).toBe('queued')
  })
})

describe('netlify provider', () => {
  it('digest deploy: posts files map, uploads required, polls ready', async () => {
    const html = '<h1>hi</h1>'
    const htmlSha = digest(html)
    const uploaded: string[] = []
    let deployBody: unknown

    server.use(
      http.get(`${API}/api/v1/sites/site_1`, () =>
        HttpResponse.json({
          id: 'site_1',
          name: 'demo',
          ssl_url: 'https://demo.netlify.app',
        }),
      ),
      http.post(`${API}/api/v1/sites/site_1/deploys`, async ({ request }) => {
        deployBody = await request.json()
        return HttpResponse.json({
          id: 'dep_1',
          state: 'uploading',
          site_id: 'site_1',
          required: [htmlSha],
          deploy_ssl_url: 'https://dep--demo.netlify.app',
        })
      }),
      http.put(`${API}/api/v1/deploys/dep_1/files/:path`, async ({ request, params }) => {
        uploaded.push(String(params['path']))
        expect(request.headers.get('content-type')).toBe('application/octet-stream')
        const buf = new Uint8Array(await request.arrayBuffer())
        expect(sha1(buf)).toBe(htmlSha)
        return HttpResponse.json({ id: 'dep_1' })
      }),
      http.get(`${API}/api/v1/deploys/dep_1`, () =>
        HttpResponse.json({
          id: 'dep_1',
          state: 'ready',
          site_id: 'site_1',
          deploy_ssl_url: 'https://dep--demo.netlify.app',
        }),
      ),
    )

    const deployer = createDeployer({
      provider: netlify({ token: 'test-token' }),
    })

    const result = await deployer.deploy(
      { kind: 'files', files: { 'index.html': html } },
      { siteId: 'site_1', waitUntil: 'ready', pollIntervalMs: 10 },
    )

    expect(deployBody).toEqual({ files: { '/index.html': htmlSha } })
    expect(uploaded).toEqual(['index.html'])
    expect(result.status).toBe('ready')
    expect(result.url).toBe('https://dep--demo.netlify.app')
    expect(result.aliases).toEqual(['https://demo.netlify.app'])
    expect(result.provider).toBe('netlify')
  })

  it('skips uploads when required is empty (deduped)', async () => {
    let puts = 0
    server.use(
      http.get(`${API}/api/v1/sites/site_1`, () =>
        HttpResponse.json({ id: 'site_1', name: 'demo', ssl_url: 'https://demo.netlify.app' }),
      ),
      http.post(`${API}/api/v1/sites/site_1/deploys`, () =>
        HttpResponse.json({
          id: 'dep_2',
          state: 'ready',
          site_id: 'site_1',
          required: [],
          deploy_ssl_url: 'https://dep2--demo.netlify.app',
        }),
      ),
      http.put(`${API}/api/v1/deploys/dep_2/files/:path`, () => {
        puts++
        return HttpResponse.json({})
      }),
    )

    const deployer = createDeployer({
      provider: netlify({ token: 't' }),
    })

    const result = await deployer.deploy(
      { kind: 'files', files: { 'index.html': '<h1>cached</h1>' } },
      { siteId: 'site_1', waitUntil: 'created' },
    )

    expect(puts).toBe(0)
    expect(result.status).toBe('ready')
  })

  it('zip passthrough posts application/zip body', async () => {
    const zipped = zipSync({
      'index.html': new TextEncoder().encode('<h1>zip</h1>'),
    })
    let contentType: string | null = null
    let bodySize = 0

    server.use(
      http.get(`${API}/api/v1/sites/site_1`, () =>
        HttpResponse.json({ id: 'site_1', name: 'demo', ssl_url: 'https://demo.netlify.app' }),
      ),
      http.post(`${API}/api/v1/sites/site_1/deploys`, async ({ request }) => {
        contentType = request.headers.get('content-type')
        bodySize = (await request.arrayBuffer()).byteLength
        return HttpResponse.json({
          id: 'dep_zip',
          state: 'ready',
          site_id: 'site_1',
          deploy_ssl_url: 'https://zip--demo.netlify.app',
        })
      }),
    )

    const provider = netlify({ token: 't' })
    const source = fromZipBytes(zipped)
    const result = await provider.deploy(source, { siteId: 'site_1' })

    expect(contentType).toBe('application/zip')
    expect(bodySize).toBe(zipped.byteLength)
    expect(result.deploymentId).toBe('dep_zip')
  })

  it('creates a site when name is new', async () => {
    server.use(
      http.get(`${API}/api/v1/sites/my-site`, () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
      http.get(`${API}/api/v1/sites/my-site.netlify.app`, () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
      http.get(`${API}/api/v1/sites`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('name')).toBe('my-site')
        return HttpResponse.json([])
      }),
      http.post(`${API}/api/v1/sites`, async ({ request }) => {
        const body = (await request.json()) as { name?: string }
        expect(body.name).toBe('my-site')
        return HttpResponse.json({
          id: 'site_new',
          name: 'my-site',
          ssl_url: 'https://my-site.netlify.app',
        })
      }),
      http.post(`${API}/api/v1/sites/site_new/deploys`, () =>
        HttpResponse.json({
          id: 'dep_new',
          state: 'ready',
          site_id: 'site_new',
          required: [],
          deploy_ssl_url: 'https://dep--my-site.netlify.app',
        }),
      ),
    )

    const deployer = createDeployer({
      provider: netlify({ token: 't' }),
    })

    const result = await deployer.deploy(
      { kind: 'files', files: { 'a.txt': 'x' } },
      { name: 'my-site', waitUntil: 'created' },
    )

    expect(result.projectId).toBe('site_new')
    expect(result.aliases).toEqual(['https://my-site.netlify.app'])
  })

  it('reuses an existing site when deploying by the same name', async () => {
    let creates = 0
    server.use(
      http.get(`${API}/api/v1/sites/my-simple-example-app`, () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
      http.get(`${API}/api/v1/sites/my-simple-example-app.netlify.app`, () =>
        HttpResponse.json({
          id: 'site_existing',
          name: 'my-simple-example-app',
          ssl_url: 'https://my-simple-example-app.netlify.app',
        }),
      ),
      http.post(`${API}/api/v1/sites`, () => {
        creates++
        return HttpResponse.json({ message: 'should not create' }, { status: 500 })
      }),
      http.post(`${API}/api/v1/sites/site_existing/deploys`, () =>
        HttpResponse.json({
          id: 'dep_reuse',
          state: 'ready',
          site_id: 'site_existing',
          required: [],
          deploy_ssl_url:
            'https://dep--my-simple-example-app.netlify.app',
        }),
      ),
    )

    const result = await netlify({ token: 't' }).deploy(
      fromFiles({ 'a.txt': 'x' }),
      { name: 'my-simple-example-app' },
    )

    expect(creates).toBe(0)
    expect(result.projectId).toBe('site_existing')
    expect(result.aliases).toEqual([
      'https://my-simple-example-app.netlify.app',
    ])
  })

  it('finds a site via list?name= when path lookups miss', async () => {
    let creates = 0
    server.use(
      http.get(`${API}/api/v1/sites/listed-site`, () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
      http.get(`${API}/api/v1/sites/listed-site.netlify.app`, () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
      http.get(`${API}/api/v1/sites`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('name')).toBe('listed-site')
        return HttpResponse.json([
          {
            id: 'site_listed',
            name: 'listed-site',
            ssl_url: 'https://listed-site.netlify.app',
          },
        ])
      }),
      http.post(`${API}/api/v1/sites`, () => {
        creates++
        return HttpResponse.json({ message: 'nope' }, { status: 500 })
      }),
      http.post(`${API}/api/v1/sites/site_listed/deploys`, () =>
        HttpResponse.json({
          id: 'dep_listed',
          state: 'ready',
          site_id: 'site_listed',
          required: [],
          deploy_ssl_url: 'https://dep--listed-site.netlify.app',
        }),
      ),
    )

    const result = await netlify({ token: 't' }).deploy(
      fromFiles({ 'a.txt': 'x' }),
      { name: 'listed-site' },
    )

    expect(creates).toBe(0)
    expect(result.projectId).toBe('site_listed')
  })

  it('sends Authorization bearer token', async () => {
    let auth: string | null = null
    server.use(
      http.get(`${API}/api/v1/sites/site_1`, ({ request }) => {
        auth = request.headers.get('authorization')
        return HttpResponse.json({ id: 'site_1', name: 'd', ssl_url: 'https://d.netlify.app' })
      }),
      http.post(`${API}/api/v1/sites/site_1/deploys`, () =>
        HttpResponse.json({
          id: 'dep',
          state: 'ready',
          required: [],
          deploy_ssl_url: 'https://d.netlify.app',
        }),
      ),
    )

    const provider = netlify({ token: 'secret-token' })
    await provider.deploy(fromFiles({ 'i.html': 'x' }), { siteId: 'site_1' })
    expect(auth).toBe('Bearer secret-token')
  })

  it('maps 401 to AuthError', async () => {
    server.use(
      http.get(`${API}/api/v1/sites/site_1`, () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
      ),
    )

    await expect(
      netlify({ token: 'bad' }).deploy(fromFiles({ 'i.html': 'x' }), {
        siteId: 'site_1',
      }),
    ).rejects.toBeInstanceOf(AuthError)
  })

  it('uses per-call siteId so consecutive deploys can target different sites', async () => {
    const created: string[] = []
    server.use(
      http.get(`${API}/api/v1/sites/:id`, ({ params }) =>
        HttpResponse.json({
          id: String(params['id']),
          name: String(params['id']),
          ssl_url: `https://${params['id']}.netlify.app`,
        }),
      ),
      http.post(`${API}/api/v1/sites/:id/deploys`, ({ params }) => {
        created.push(String(params['id']))
        return HttpResponse.json({
          id: `dep_${params['id']}`,
          state: 'ready',
          site_id: String(params['id']),
          required: [],
          deploy_ssl_url: `https://dep--${params['id']}.netlify.app`,
        })
      }),
    )

    const provider = netlify({ token: 't' })
    await provider.deploy(fromFiles({ 'a.txt': '1' }), { siteId: 'site_a' })
    await provider.deploy(fromFiles({ 'a.txt': '2' }), { siteId: 'site_b' })

    expect(created).toEqual(['site_a', 'site_b'])
  })

  it('deleteSite DELETEs /api/v1/sites/:id', async () => {
    let deleted: string | null = null
    server.use(
      http.delete(`${API}/api/v1/sites/:id`, ({ params }) => {
        deleted = String(params['id'])
        return new HttpResponse(null, { status: 200 })
      }),
    )
    await netlify({ token: 't' }).deleteSite('site_gone')
    expect(deleted).toBe('site_gone')
  })
})
