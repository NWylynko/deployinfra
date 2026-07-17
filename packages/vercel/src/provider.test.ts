import { createHash } from 'node:crypto'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AuthError, createDeployer } from '@deployinfra/sdk'
import { fromFiles, sha1 } from '@deployinfra/sdk/internal'
import { vercel } from './index.js'
import { mapVercelReadyState } from './status.js'

const API = 'https://api.vercel.com'

function digest(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('mapVercelReadyState', () => {
  it('maps known states', () => {
    expect(mapVercelReadyState('READY')).toBe('ready')
    expect(mapVercelReadyState('ERROR')).toBe('error')
    expect(mapVercelReadyState('CANCELED')).toBe('canceled')
    expect(mapVercelReadyState('BUILDING')).toBe('building')
    expect(mapVercelReadyState('QUEUED')).toBe('queued')
  })
})

describe('vercel provider', () => {
  it('uploads files with x-vercel-digest and creates deployment', async () => {
    const html = '<h1>hi</h1>'
    const htmlSha = digest(html)
    const digests: string[] = []
    let createBody: unknown
    let pollCount = 0

    server.use(
      http.post(`${API}/v2/files`, async ({ request }) => {
        const d = request.headers.get('x-vercel-digest')
        expect(d).toBeTruthy()
        digests.push(d!)
        const buf = new Uint8Array(await request.arrayBuffer())
        expect(sha1(buf)).toBe(d)
        return HttpResponse.json({ ok: true })
      }),
      http.post(`${API}/v13/deployments`, async ({ request }) => {
        expect(request.url).toContain('skipAutoDetectionConfirmation=1')
        createBody = await request.json()
        return HttpResponse.json({
          id: 'dpl_1',
          url: 'my-app-abc.vercel.app',
          name: 'my-app',
          projectId: 'prj_1',
          readyState: 'QUEUED',
          createdAt: Date.now(),
        })
      }),
      http.get(`${API}/v13/deployments/dpl_1`, () => {
        pollCount++
        return HttpResponse.json({
          id: 'dpl_1',
          url: 'my-app-abc.vercel.app',
          name: 'my-app',
          projectId: 'prj_1',
          readyState: pollCount >= 2 ? 'READY' : 'BUILDING',
          alias: ['my-app.vercel.app'],
        })
      }),
    )

    const deployer = createDeployer({
      provider: vercel({ token: 'tok' }),
    })

    const result = await deployer.deploy(
      { kind: 'files', files: { 'index.html': html } },
      { name: 'my-app', waitUntil: 'ready', pollIntervalMs: 10 },
    )

    expect(digests).toEqual([htmlSha])
    expect(createBody).toMatchObject({
      name: 'my-app',
      files: [{ file: 'index.html', sha: htmlSha, size: html.length }],
      projectSettings: { framework: null },
    })
    expect(result.status).toBe('ready')
    expect(result.url).toBe('https://my-app-abc.vercel.app')
    expect(result.aliases).toEqual(['https://my-app.vercel.app'])
  })

  it('appends teamId to API calls', async () => {
    const urls: string[] = []
    server.use(
      http.post(`${API}/v2/files`, ({ request }) => {
        urls.push(request.url)
        return HttpResponse.json({})
      }),
      http.post(`${API}/v13/deployments`, ({ request }) => {
        urls.push(request.url)
        return HttpResponse.json({
          id: 'dpl_t',
          readyState: 'READY',
          url: 't.vercel.app',
        })
      }),
    )

    const provider = vercel({ token: 't', teamId: 'team_99' })
    await provider.deploy(fromFiles({ 'a.txt': 'x' }), { name: 'app' })

    expect(urls.every((u) => u.includes('teamId=team_99'))).toBe(true)
  })

  it('treats 409 on upload as dedupe success', async () => {
    server.use(
      http.post(`${API}/v2/files`, () =>
        HttpResponse.json({ error: { code: 'file_already_exists' } }, { status: 409 }),
      ),
      http.post(`${API}/v13/deployments`, () =>
        HttpResponse.json({
          id: 'dpl_dedupe',
          readyState: 'READY',
          url: 'dedupe.vercel.app',
        }),
      ),
    )

    const provider = vercel({ token: 't' })
    const result = await provider.deploy(fromFiles({ 'a.txt': 'hello' }), { name: 'app' })
    expect(result.deploymentId).toBe('dpl_dedupe')
  })

  it('uses gitSource for github remotes', async () => {
    let body: unknown
    server.use(
      http.post(`${API}/v13/deployments`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          id: 'dpl_git',
          readyState: 'READY',
          url: 'git.vercel.app',
        })
      }),
    )

    const provider = vercel({ token: 't' })
    await provider.deploy(
      {
        kind: 'git',
        host: 'github',
        owner: 'acme',
        repo: 'site',
        ref: 'main',
        materialize: async () => fromFiles({}),
      },
      { name: 'app' },
    )

    expect(body).toMatchObject({
      gitSource: { type: 'github', org: 'acme', repo: 'site', ref: 'main' },
    })
  })

  it('falls back to archive when gitSource fails', async () => {
    let attempt = 0
    const uploads: string[] = []

    server.use(
      http.post(`${API}/v13/deployments`, async ({ request }) => {
        attempt++
        const body = (await request.json()) as { gitSource?: unknown; files?: unknown }
        if (body.gitSource) {
          return HttpResponse.json(
            { error: { message: 'GitHub app not installed' } },
            { status: 400 },
          )
        }
        expect(body.files).toBeTruthy()
        return HttpResponse.json({
          id: 'dpl_fallback',
          readyState: 'READY',
          url: 'fallback.vercel.app',
        })
      }),
      http.post(`${API}/v2/files`, async ({ request }) => {
        uploads.push(request.headers.get('x-vercel-digest')!)
        return HttpResponse.json({})
      }),
    )

    const provider = vercel({ token: 't' })
    const result = await provider.deploy(
      {
        kind: 'git',
        host: 'github',
        owner: 'acme',
        repo: 'site',
        materialize: async () => fromFiles({ 'index.html': '<h1>fb</h1>' }),
      },
      { name: 'app' },
    )

    expect(attempt).toBe(2)
    expect(uploads.length).toBe(1)
    expect(result.deploymentId).toBe('dpl_fallback')
  })

  it('sends Authorization bearer token', async () => {
    let auth: string | null = null
    server.use(
      http.post(`${API}/v2/files`, ({ request }) => {
        auth = request.headers.get('authorization')
        return HttpResponse.json({})
      }),
      http.post(`${API}/v13/deployments`, () =>
        HttpResponse.json({ id: 'd', readyState: 'READY', url: 'x.vercel.app' }),
      ),
    )

    await vercel({ token: 'secret' }).deploy(
      fromFiles({ 'a.txt': '1' }),
      { name: 'a' },
    )
    expect(auth).toBe('Bearer secret')
  })

  it('maps 401 on upload to AuthError', async () => {
    server.use(
      http.post(`${API}/v2/files`, () =>
        HttpResponse.json({ error: { message: 'Not authorized' } }, { status: 401 }),
      ),
    )

    await expect(
      vercel({ token: 'bad' }).deploy(fromFiles({ 'a.txt': '1' }), { name: 'a' }),
    ).rejects.toBeInstanceOf(AuthError)
  })

  it('deleteProject DELETEs /v9/projects/:id', async () => {
    let deleted: string | null = null
    server.use(
      http.delete(`${API}/v9/projects/:id`, ({ params }) => {
        deleted = String(params['id'])
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await vercel({ token: 't' }).deleteProject('my-app')
    expect(deleted).toBe('my-app')
  })
})
