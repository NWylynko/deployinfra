import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AuthError, createDeployer } from '@deployinfra/sdk'
import { fromFiles } from '@deployinfra/sdk/internal'
import { parseTarGzip } from 'nanotar'
import { railway } from './index.js'
import { mapRailwayStatus } from './status.js'
import { createTarball } from './tarball.js'

const GQL = 'https://backboard.railway.com/graphql/v2'
const UP = 'https://backboard.railway.com'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('mapRailwayStatus', () => {
  it('maps known statuses', () => {
    expect(mapRailwayStatus('SUCCESS')).toBe('ready')
    expect(mapRailwayStatus('FAILED')).toBe('error')
    expect(mapRailwayStatus('BUILDING')).toBe('building')
    expect(mapRailwayStatus('DEPLOYING')).toBe('deploying')
    expect(mapRailwayStatus('QUEUED')).toBe('queued')
  })
})

describe('createTarball', () => {
  it('packs files into a gzip tar', async () => {
    const source = fromFiles({
      'index.html': '<h1>hi</h1>',
      'assets/app.js': 'console.log(1)',
    })
    const tar = await createTarball(source)
    expect(tar.byteLength).toBeGreaterThan(0)
    const entries = await parseTarGzip(tar)
    const names = entries.map((e) => e.name).sort()
    expect(names).toEqual(['assets/app.js', 'index.html'])
  })
})

describe('railway provider', () => {
  it('uploads gzip tarball to /up and polls GraphQL status', async () => {
    let uploadedContentType: string | null = null
    let uploadedBytes = 0
    let poll = 0

    server.use(
      http.post(`${UP}/project/prj_1/environment/env_1/up`, async ({ request }) => {
        expect(request.url).toContain('serviceId=svc_1')
        uploadedContentType = request.headers.get('content-type')
        uploadedBytes = (await request.arrayBuffer()).byteLength
        return HttpResponse.json({
          deploymentId: 'dep_1',
          url: 'https://web-production.up.railway.app',
        })
      }),
      http.post(GQL, async ({ request }) => {
        const body = (await request.json()) as { query: string }
        expect(body.query).toContain('deployment')
        poll++
        return HttpResponse.json({
          data: {
            deployment: {
              id: 'dep_1',
              status: poll >= 2 ? 'SUCCESS' : 'BUILDING',
              staticUrl: 'web-production.up.railway.app',
            },
          },
        })
      }),
    )

    const deployer = createDeployer({
      provider: railway({ token: 'railway_token' }),
    })

    const result = await deployer.deploy(
      { kind: 'files', files: { 'index.html': '<h1>hi</h1>' } },
      {
        projectId: 'prj_1',
        environmentId: 'env_1',
        serviceId: 'svc_1',
        waitUntil: 'ready',
        pollIntervalMs: 10,
      },
    )

    expect(uploadedContentType).toBe('application/gzip')
    expect(uploadedBytes).toBeGreaterThan(0)
    expect(result.status).toBe('ready')
    expect(result.deploymentId).toBe('dep_1')
    expect(result.url).toBe('https://web-production.up.railway.app')
  })

  it('provisions project/service when ids omitted', async () => {
    const ops: string[] = []

    server.use(
      http.post(GQL, async ({ request }) => {
        const body = (await request.json()) as {
          query: string
          variables?: { input?: Record<string, unknown> }
        }
        if (body.query.includes('projectCreate')) {
          ops.push('projectCreate')
          return HttpResponse.json({ data: { projectCreate: { id: 'prj_new' } } })
        }
        if (body.query.includes('environments')) {
          ops.push('environments')
          return HttpResponse.json({
            data: {
              project: {
                environments: {
                  edges: [{ node: { id: 'env_new', name: 'production' } }],
                },
              },
            },
          })
        }
        if (body.query.includes('serviceCreate')) {
          ops.push('serviceCreate')
          return HttpResponse.json({ data: { serviceCreate: { id: 'svc_new' } } })
        }
        if (body.query.includes('domains')) {
          ops.push('domains')
          return HttpResponse.json({
            data: { domains: { serviceDomains: [] } },
          })
        }
        if (body.query.includes('serviceDomainCreate')) {
          ops.push('serviceDomainCreate')
          return HttpResponse.json({
            data: { serviceDomainCreate: { domain: 'new.up.railway.app' } },
          })
        }
        return HttpResponse.json({ data: {} })
      }),
      http.post(`${UP}/project/prj_new/environment/env_new/up`, () =>
        HttpResponse.json({
          deploymentId: 'dep_new',
          deploymentDomain: 'new.up.railway.app',
        }),
      ),
    )

    const result = await railway({ token: 'tok' }).deploy(fromFiles({ 'a.txt': 'x' }), {
      name: 'demo',
    })

    // deploy returns at created (queued) without polling when calling provider directly
    expect(ops).toContain('projectCreate')
    expect(ops).toContain('serviceCreate')
    expect(result.deploymentId).toBe('dep_new')
    expect(result.url).toBe('https://new.up.railway.app')
  })

  it('uses per-call ids for consecutive deploys', async () => {
    const uploads: string[] = []
    server.use(
      http.post(`${UP}/project/:project/environment/:environment/up`, ({ params, request }) => {
        const serviceId = new URL(request.url).searchParams.get('serviceId')
        uploads.push(`${params['project']}/${params['environment']}/${serviceId}`)
        return HttpResponse.json({
          deploymentId: `dep_${serviceId}`,
          deploymentDomain: `${serviceId}.up.railway.app`,
        })
      }),
    )

    const provider = railway({ token: 'tok' })
    await provider.deploy(fromFiles({ 'a.txt': '1' }), {
      projectId: 'prj_a',
      environmentId: 'env_a',
      serviceId: 'svc_a',
    })
    await provider.deploy(fromFiles({ 'a.txt': '2' }), {
      projectId: 'prj_b',
      environmentId: 'env_b',
      serviceId: 'svc_b',
    })

    expect(uploads).toEqual([
      'prj_a/env_a/svc_a',
      'prj_b/env_b/svc_b',
    ])
  })

  it('maps 401 to AuthError', async () => {
    server.use(
      http.post(GQL, () =>
        HttpResponse.json({ errors: [{ message: 'Not Authorized' }] }, { status: 401 }),
      ),
    )

    await expect(
      railway({ token: 'bad' }).deploy(fromFiles({ 'a.txt': 'x' }), { name: 'demo' }),
    ).rejects.toBeInstanceOf(AuthError)
  })

  it('falls back to archive when git-linked serviceCreate fails', async () => {
    const materialize = vi.fn().mockResolvedValue(
      fromFiles({ 'index.html': '<h1>archived</h1>' }),
    )
    let serviceCreates = 0

    server.use(
      http.post(GQL, async ({ request }) => {
        const body = (await request.json()) as {
          query: string
          variables?: { input?: { source?: { repo?: string } } }
        }
        if (body.query.includes('projectCreate')) {
          return HttpResponse.json({ data: { projectCreate: { id: 'prj_g' } } })
        }
        if (body.query.includes('environments')) {
          return HttpResponse.json({
            data: {
              project: {
                environments: {
                  edges: [{ node: { id: 'env_g', name: 'production' } }],
                },
              },
            },
          })
        }
        if (body.query.includes('serviceCreate')) {
          serviceCreates++
          if (body.variables?.input?.source?.repo) {
            return HttpResponse.json({
              errors: [{ message: 'GitHub app not installed' }],
            })
          }
          return HttpResponse.json({ data: { serviceCreate: { id: 'svc_g' } } })
        }
        if (body.query.includes('domains')) {
          return HttpResponse.json({
            data: { domains: { serviceDomains: [{ domain: 'g.up.railway.app' }] } },
          })
        }
        return HttpResponse.json({ data: {} })
      }),
      http.post(`${UP}/project/prj_g/environment/env_g/up`, () =>
        HttpResponse.json({
          deploymentId: 'dep_g',
          deploymentDomain: 'g.up.railway.app',
        }),
      ),
    )

    const result = await railway({ token: 'tok' }).deploy(
      {
        kind: 'git',
        host: 'github',
        owner: 'acme',
        repo: 'site',
        materialize,
      },
      { name: 'git-demo' },
    )

    expect(materialize).toHaveBeenCalled()
    expect(result.deploymentId).toBe('dep_g')
    expect(serviceCreates).toBeGreaterThanOrEqual(2)
  })

  it('deleteProject calls projectDelete mutation', async () => {
    let deletedId: string | null = null
    server.use(
      http.post(GQL, async ({ request }) => {
        const body = (await request.json()) as {
          query?: string
          variables?: { id?: string }
        }
        expect(body.query).toContain('projectDelete')
        deletedId = body.variables?.id ?? null
        return HttpResponse.json({ data: { projectDelete: true } })
      }),
    )
    await railway({ token: 'tok' }).deleteProject('prj_x')
    expect(deletedId).toBe('prj_x')
  })
})
