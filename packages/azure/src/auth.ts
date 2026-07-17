import {
  ClientSecretCredential,
  type TokenCredential,
} from '@azure/identity'

export const DEFAULT_ENTRA_SCOPE = 'https://appservice.azure.com/.default'

/**
 * SCM basic auth from an App Service **publish profile**.
 *
 * Download it in the Azure portal: App Service → your web app →
 * **Get publish profile** (or `az webapp deployment list-publishing-profiles`).
 * Use the `userName` / `userPWD` from an MSDeploy / Zip Deploy profile entry.
 *
 * @see https://learn.microsoft.com/azure/app-service/deploy-ftp#get-ftp-ftp-credentials
 */
export interface PublishProfileCredentials {
  kind: 'publishProfile'
  username: string
  password: string
}

/**
 * Entra (Azure AD) app registration client-secret credentials.
 *
 * Create an app at
 * {@link https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade | App registrations},
 * add a client secret under **Certificates & secrets**, and grant the app
 * access to the web app (e.g. Website Contributor on the App Service resource).
 * Then request tokens for `https://appservice.azure.com/.default` (or set
 * `entraScope` on the provider).
 *
 * @see https://learn.microsoft.com/entra/identity-platform/quickstart-register-app
 */
export interface EntraClientSecretCredentials {
  kind: 'entra'
  tenantId: string
  clientId: string
  clientSecret: string
}

/**
 * Entra credentials via any `@azure/identity` {@link TokenCredential}
 * (e.g. `DefaultAzureCredential` after `az login`).
 */
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
