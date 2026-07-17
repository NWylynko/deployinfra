import {
  ClientSecretCredential,
  type TokenCredential,
} from '@azure/identity'

export const DEFAULT_ENTRA_SCOPE = 'https://appservice.azure.com/.default'

export interface PublishProfileCredentials {
  kind: 'publishProfile'
  username: string
  password: string
}

export interface EntraClientSecretCredentials {
  kind: 'entra'
  tenantId: string
  clientId: string
  clientSecret: string
}

export interface EntraTokenCredentialCredentials {
  kind: 'entra'
  /** Any `@azure/identity` `TokenCredential` (e.g. `DefaultAzureCredential`). */
  credential: TokenCredential
}

export type AzureCredentials =
  | PublishProfileCredentials
  | EntraClientSecretCredentials
  | EntraTokenCredentialCredentials

export type AuthHeaderProvider = () => Promise<Record<string, string>>

export function createAuthHeaderProvider(
  credentials: AzureCredentials,
  entraScope: string = DEFAULT_ENTRA_SCOPE,
): AuthHeaderProvider {
  if (credentials.kind === 'publishProfile') {
    const basic = Buffer.from(
      `${credentials.username}:${credentials.password}`,
      'utf8',
    ).toString('base64')
    return async () => ({ authorization: `Basic ${basic}` })
  }

  const credential: TokenCredential =
    'credential' in credentials
      ? credentials.credential
      : new ClientSecretCredential(
          credentials.tenantId,
          credentials.clientId,
          credentials.clientSecret,
        )

  return async () => {
    const token = await credential.getToken(entraScope)
    if (!token?.token) {
      throw new Error('Failed to obtain Entra access token for App Service SCM')
    }
    return { authorization: `Bearer ${token.token}` }
  }
}
