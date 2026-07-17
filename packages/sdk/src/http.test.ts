import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  AuthError,
  NotFoundError,
  ProviderError,
  RateLimitError,
} from './errors.js'
import { mapHttpError, request } from './http.js'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('mapHttpError', () => {
  it('maps status codes to typed errors', () => {
    expect(mapHttpError(401, null)).toBeInstanceOf(AuthError)
    expect(mapHttpError(403, null)).toBeInstanceOf(AuthError)
    expect(mapHttpError(404, null)).toBeInstanceOf(NotFoundError)
    expect(mapHttpError(429, null)).toBeInstanceOf(RateLimitError)
    const provider = mapHttpError(500, { message: 'boom' })
    expect(provider).toBeInstanceOf(ProviderError)
    expect((provider as ProviderError).statusCode).toBe(500)
  })

  it('extracts nested Vercel-style error messages', () => {
    const err = mapHttpError(400, {
      error: { code: 'bad_request', message: 'Project name is required' },
    })
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.message).toBe('Project name is required')
  })
})

describe('request', () => {
  it('parses JSON and returns data', async () => {
    server.use(
      http.get('https://api.example.com/ok', () =>
        HttpResponse.json({ hello: 'world' }),
      ),
    )
    const res = await request<{ hello: string }>('https://api.example.com/ok')
    expect(res.data).toEqual({ hello: 'world' })
    expect(res.status).toBe(200)
  })

  it('throws AuthError on 401', async () => {
    server.use(
      http.get('https://api.example.com/secret', () =>
        HttpResponse.json({ message: 'nope' }, { status: 401 }),
      ),
    )
    await expect(request('https://api.example.com/secret')).rejects.toBeInstanceOf(
      AuthError,
    )
  })

  it('throws RateLimitError with retryAfter', async () => {
    server.use(
      http.get('https://api.example.com/limited', () =>
        HttpResponse.json(
          { message: 'slow down' },
          { status: 429, headers: { 'retry-after': '2' } },
        ),
      ),
    )
    try {
      await request('https://api.example.com/limited')
      expect.fail('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError)
      expect((err as RateLimitError).retryAfter).toBe(2000)
    }
  })
})
