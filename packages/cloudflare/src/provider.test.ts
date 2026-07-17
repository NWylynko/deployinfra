import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AuthError, ValidationError, createDeployer } from '@deployinfra/sdk'
import { fromFiles } from '@deployinfra/sdk/internal'
import { cloudflare } from './index.js'
import { hashPagesAsset } from './hash.js'

const API = 'https://api.cloudflare.com/client/v4'
const ACCOUNT = 'acc_1'
const PROJECT = 'my-pages'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('cloudflare provider', () => {
  it('hashes, checks missing, uploads, creates deployment, polls ready', async () => {
    const html = '<h1>hi</h1>'
    const htmlBytes = new TextEncoder().encode(html)
    const hash = hashPagesAsset(htmlBytes, 'index.html')
    let uploadBodies: unknown[] = []
    let manifest: string | null = null
    let jwtCalls = 0
    let poll = 0

    server.use(
      http.get(`${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}`, () =>
        HttpResponse.json({
          success: true,
          result: {
            name: PROJECT,
            subdomain: 'my-pages.pages.dev',
            domains: ['www.example.com'],
          },
        }),
      ),
      http.get(`${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}/upload-token`, () => {
        jwtCalls++
        return HttpResponse.json({ success: true, result: { jwt: 'jwt-token' } })
      }),
      http.post(`${API}/pages/assets/check-missing`, async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer jwt-token')
        const body = (await request.json()) as { hashes: string[] }
        expect(body.hashes).toContain(hash)
        return HttpResponse.json({ success: true, result: [hash] })
      }),
      http.post(`${API}/pages/assets/upload`, async ({ request }) => {
        uploadBodies.push(await request.json())
        return HttpResponse.json({ success: true, result: null })
      }),
      http.post(`${API}/pages/assets/upsert-hashes`, async () =>
        HttpResponse.json({ success: true, result: null }),
      ),
      http.post(
        `${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}/deployments`,
        async ({ request }) => {
          const form = await request.formData()
          manifest = String(form.get('manifest'))
          expect(form.get('branch')).toBe('main')
          return HttpResponse.json({
            success: true,
            result: {
              id: 'dep_1',
              url: 'https://dep_1.my-pages.pages.dev',
              latest_stage: { name: 'queued', status: 'idle' },
              created_on: new Date().toISOString(),
            },
          })
        },
      ),
      http.get(
        `${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}/deployments/dep_1`,
        () => {
          poll++
          return HttpResponse.json({
            success: true,
            result: {
              id: 'dep_1',
              url: 'https://dep_1.my-pages.pages.dev',
              latest_stage:
                poll >= 2
                  ? { name: 'deploy', status: 'success' }
                  : { name: 'deploy', status: 'active' },
            },
          })
        },
      ),
    )

    const deployer = createDeployer({
      provider: cloudflare({
        token: 'tok',
        accountId: ACCOUNT,
      }),
    })

    const result = await deployer.deploy(
      { kind: 'files', files: { 'index.html': html } },
      { name: PROJECT, waitUntil: 'ready', pollIntervalMs: 10 },
    )

    expect(jwtCalls).toBeGreaterThanOrEqual(1)
    expect(uploadBodies[0]).toEqual([
      {
        key: hash,
        value: Buffer.from(htmlBytes).toString('base64'),
        metadata: { contentType: 'text/html' },
        base64: true,
      },
    ])
    expect(JSON.parse(manifest!)).toEqual({ '/index.html': hash })
    expect(result.status).toBe('ready')
    expect(result.url).toBe('https://dep_1.my-pages.pages.dev')
    expect(result.aliases).toEqual([
      'https://my-pages.pages.dev',
      'https://www.example.com',
    ])
  })

  it('refreshes JWT on 401 during check-missing', async () => {
    let tokens = 0
    let checks = 0
    const html = 'x'
    const hash = hashPagesAsset(new TextEncoder().encode(html), 'a.txt')

    server.use(
      http.get(`${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}`, () =>
        HttpResponse.json({ success: true, result: { name: PROJECT } }),
      ),
      http.get(`${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}/upload-token`, () => {
        tokens++
        return HttpResponse.json({
          success: true,
          result: { jwt: tokens === 1 ? 'jwt-old' : 'jwt-new' },
        })
      }),
      http.post(`${API}/pages/assets/check-missing`, ({ request }) => {
        checks++
        if (request.headers.get('authorization') === 'Bearer jwt-old') {
          return HttpResponse.json({ success: false }, { status: 401 })
        }
        return HttpResponse.json({ success: true, result: [] })
      }),
      http.post(
        `${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}/deployments`,
        () =>
          HttpResponse.json({
            success: true,
            result: {
              id: 'dep_2',
              url: 'https://x.pages.dev',
              latest_stage: { name: 'deploy', status: 'success' },
            },
          }),
      ),
    )

    const provider = cloudflare({
      token: 'tok',
      accountId: ACCOUNT,
    })
    const result = await provider.deploy(fromFiles({ 'a.txt': html }), { name: PROJECT })
    expect(tokens).toBe(2)
    expect(checks).toBe(2)
    expect(result.deploymentId).toBe('dep_2')
    expect(hash).toHaveLength(32)
  })

  it('sends _headers and _redirects as separate form fields', async () => {
    const fields: Record<string, string> = {}
    server.use(
      http.get(`${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}`, () =>
        HttpResponse.json({ success: true, result: { name: PROJECT } }),
      ),
      http.get(`${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}/upload-token`, () =>
        HttpResponse.json({ success: true, result: { jwt: 'jwt' } }),
      ),
      http.post(`${API}/pages/assets/check-missing`, () =>
        HttpResponse.json({ success: true, result: [] }),
      ),
      http.post(
        `${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}/deployments`,
        async ({ request }) => {
          const form = await request.formData()
          for (const [k, v] of form.entries()) fields[k] = String(v)
          return HttpResponse.json({
            success: true,
            result: {
              id: 'dep_h',
              latest_stage: { name: 'deploy', status: 'success' },
            },
          })
        },
      ),
    )

    await cloudflare({
      token: 't',
      accountId: ACCOUNT,
    }).deploy(
      fromFiles({
        'index.html': '<h1>x</h1>',
        _headers: '/*\n  X-Frame-Options: DENY',
        _redirects: '/old /new 301',
      }),
      { name: PROJECT },
    )

    expect(fields['_headers']).toContain('X-Frame-Options')
    expect(fields['_redirects']).toContain('/old /new')
    const manifest = JSON.parse(fields['manifest']!) as Record<string, string>
    expect(manifest['/_headers']).toBeUndefined()
    expect(manifest['/index.html']).toBeTruthy()
  })

  it('maps API-token 401 to AuthError', async () => {
    server.use(
      http.get(`${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}`, () =>
        HttpResponse.json(
          { success: false, errors: [{ message: 'Authentication error' }] },
          { status: 401 },
        ),
      ),
    )

    await expect(
      cloudflare({
        token: 'bad',
        accountId: ACCOUNT,
      }).deploy(fromFiles({ 'a.txt': 'x' }), { name: PROJECT }),
    ).rejects.toBeInstanceOf(AuthError)
  })

  it('rejects files over 25 MiB with ValidationError', async () => {
    server.use(
      http.get(`${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}`, () =>
        HttpResponse.json({ success: true, result: { name: PROJECT } }),
      ),
    )

    const huge = {
      kind: 'files' as const,
      async count() {
        return 1
      },
      async *files() {
        yield {
          path: 'big.bin',
          size: 26 * 1024 * 1024,
          async read() {
            return new Uint8Array(0)
          },
        }
      },
    }

    await expect(
      cloudflare({
        token: 't',
        accountId: ACCOUNT,
      }).deploy(huge, { name: PROJECT }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects more than 20_000 files with ValidationError', async () => {
    const many = {
      kind: 'files' as const,
      async count() {
        return 20_001
      },
      async *files() {
        for (let i = 0; i < 20_001; i++) {
          yield {
            path: `f${i}.txt`,
            size: 1,
            async read() {
              return new TextEncoder().encode('x')
            },
          }
        }
      },
    }

    server.use(
      http.get(`${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}`, () =>
        HttpResponse.json({ success: true, result: { name: PROJECT } }),
      ),
    )

    await expect(
      cloudflare({
        token: 't',
        accountId: ACCOUNT,
      }).deploy(many, { name: PROJECT }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('deleteProject DELETEs the Pages project', async () => {
    let deleted: string | null = null
    server.use(
      http.delete(
        `${API}/accounts/${ACCOUNT}/pages/projects/:name`,
        ({ params }) => {
          deleted = String(params['name'])
          return HttpResponse.json({ success: true, result: null })
        },
      ),
    )
    await cloudflare({ token: 't', accountId: ACCOUNT }).deleteProject(PROJECT)
    expect(deleted).toBe(PROJECT)
  })
})
