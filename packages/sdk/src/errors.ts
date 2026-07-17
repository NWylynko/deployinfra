export class DeployError extends Error {
  readonly code: string

  constructor(message: string, options?: { cause?: unknown; code?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'DeployError'
    this.code = options?.code ?? 'DEPLOY_ERROR'
  }
}

export class AuthError extends DeployError {
  constructor(message = 'Authentication failed', options?: { cause?: unknown }) {
    super(message, { ...options, code: 'AUTH_ERROR' })
    this.name = 'AuthError'
  }
}

export class NotFoundError extends DeployError {
  constructor(message = 'Resource not found', options?: { cause?: unknown }) {
    super(message, { ...options, code: 'NOT_FOUND' })
    this.name = 'NotFoundError'
  }
}

export class RateLimitError extends DeployError {
  readonly retryAfter?: number

  constructor(
    message = 'Rate limited',
    options?: { cause?: unknown; retryAfter?: number },
  ) {
    super(message, { cause: options?.cause, code: 'RATE_LIMIT' })
    this.name = 'RateLimitError'
    this.retryAfter = options?.retryAfter
  }
}

export class QuotaError extends DeployError {
  constructor(message = 'Quota exceeded', options?: { cause?: unknown }) {
    super(message, { ...options, code: 'QUOTA_ERROR' })
    this.name = 'QuotaError'
  }
}

export class ValidationError extends DeployError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { ...options, code: 'VALIDATION_ERROR' })
    this.name = 'ValidationError'
  }
}

export class TimeoutError extends DeployError {
  readonly lastStatus?: string

  constructor(
    message = 'Timed out waiting for deployment',
    options?: { cause?: unknown; lastStatus?: string },
  ) {
    super(message, { cause: options?.cause, code: 'TIMEOUT' })
    this.name = 'TimeoutError'
    this.lastStatus = options?.lastStatus
  }
}

export class SourceError extends DeployError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { ...options, code: 'SOURCE_ERROR' })
    this.name = 'SourceError'
  }
}

export class ProviderError extends DeployError {
  readonly statusCode?: number
  readonly body?: unknown

  constructor(
    message: string,
    options?: { cause?: unknown; statusCode?: number; body?: unknown },
  ) {
    super(message, { cause: options?.cause, code: 'PROVIDER_ERROR' })
    this.name = 'ProviderError'
    this.statusCode = options?.statusCode
    this.body = options?.body
  }
}
