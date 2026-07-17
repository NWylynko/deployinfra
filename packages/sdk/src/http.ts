import {
  AuthError,
  NotFoundError,
  ProviderError,
  QuotaError,
  RateLimitError,
} from './errors.js'

export interface HttpRequestInit extends Omit<RequestInit, 'body'> {
  body?: RequestInit['body']
  /** Parsed as JSON when response is JSON; otherwise text. */
  json?: unknown
  signal?: AbortSignal
}

export interface HttpResponse<T = unknown> {
  ok: boolean
  status: number
  headers: Headers
  data: T
  raw: Response
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const asInt = Number(header)
  if (!Number.isNaN(asInt)) return asInt * 1000
  const date = Date.parse(header)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  return undefined
}

async function readBody(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    try {
      return await res.json()
    } catch {
      return undefined
    }
  }
  const text = await res.text()
  return text.length ? text : undefined
}

/** Pull a human-readable message out of common API error body shapes. */
function messageFromBody(body: unknown): string | undefined {
  if (typeof body === 'string' && body.length > 0) return body
  if (typeof body !== 'object' || body === null) return undefined

  const record = body as Record<string, unknown>

  if (typeof record.message === 'string') return record.message

  // Vercel: { error: { code, message } }
  if (typeof record.error === 'object' && record.error !== null) {
    const err = record.error as Record<string, unknown>
    if (typeof err.message === 'string') return err.message
  }

  // Netlify / generic: { errors: [{ message }] } or { error_description }
  if (Array.isArray(record.errors) && record.errors[0]) {
    const first = record.errors[0]
    if (typeof first === 'string') return first
    if (
      typeof first === 'object' &&
      first !== null &&
      typeof (first as { message?: unknown }).message === 'string'
    ) {
      return (first as { message: string }).message
    }
  }

  if (typeof record.error_description === 'string') return record.error_description
  if (typeof record.error === 'string') return record.error

  return undefined
}

/** Map HTTP status codes to typed DeployError subclasses. */
export function mapHttpError(
  status: number,
  body: unknown,
  message?: string,
): Error {
  const fromBody = messageFromBody(body)
  let msg = message ?? fromBody ?? `HTTP ${status}`
  // Keep status + body when the API returns no useful message (common for 422).
  if (!fromBody && body !== undefined) {
    try {
      msg = `HTTP ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`
    } catch {
      msg = `HTTP ${status}`
    }
  }

  if (status === 401 || status === 403) {
    return new AuthError(msg, { cause: body })
  }
  if (status === 404) {
    return new NotFoundError(msg, { cause: body })
  }
  if (status === 429) {
    return new RateLimitError(msg, { cause: body })
  }
  if (status === 402 || status === 413) {
    return new QuotaError(msg, { cause: body })
  }
  return new ProviderError(msg, { statusCode: status, body })
}

/**
 * Thin fetch wrapper that JSON-encodes `json`, parses JSON responses,
 * and throws typed errors for non-2xx.
 */
export async function request<T = unknown>(
  url: string,
  init: HttpRequestInit = {},
): Promise<HttpResponse<T>> {
  const { json, headers: initHeaders, body, ...rest } = init
  const headers = new Headers(initHeaders)

  let finalBody = body
  if (json !== undefined) {
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }
    finalBody = JSON.stringify(json)
  }

  const raw = await fetch(url, { ...rest, headers, body: finalBody })
  const data = (await readBody(raw)) as T

  if (!raw.ok) {
    const err = mapHttpError(raw.status, data)
    if (err instanceof RateLimitError && !err.retryAfter) {
      const retryAfter = parseRetryAfter(raw.headers.get('retry-after'))
      throw new RateLimitError(err.message, {
        cause: data,
        retryAfter,
      })
    }
    throw err
  }

  return { ok: true, status: raw.status, headers: raw.headers, data, raw }
}
