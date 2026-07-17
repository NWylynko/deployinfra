import { GoogleAuth, type JWTInput } from 'google-auth-library'
import { AuthError } from '@deployinfra/sdk'

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

export type TokenProvider = () => Promise<string>

/**
 * Build a token provider from an optional service-account object / JSON,
 * or ADC when omitted. `accessToken` short-circuits for tests.
 */
export function createTokenProvider(options: {
  serviceAccount?: JWTInput | string
  accessToken?: string
}): TokenProvider {
  if (options.accessToken) {
    return async () => options.accessToken!
  }

  const credentials =
    typeof options.serviceAccount === 'string'
      ? (JSON.parse(options.serviceAccount) as JWTInput)
      : options.serviceAccount

  const auth = new GoogleAuth({
    credentials,
    scopes: [SCOPE],
  })

  return async () => {
    const client = await auth.getClient()
    const token = await client.getAccessToken()
    const value = typeof token === 'string' ? token : token?.token
    if (!value) {
      throw new AuthError('Failed to obtain Google access token')
    }
    return value
  }
}
