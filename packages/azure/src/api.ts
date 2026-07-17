import {
  AuthError,
  ProviderError,
  ValidationError,
} from '@deployinfra/sdk'
import { mapHttpError, request } from '@deployinfra/sdk/internal'
import type { AuthHeaderProvider } from './auth.js'

export interface KuduDeployment {
  id?: string
  status?: number
  complete?: boolean
  active?: boolean
  message?: string
  author?: string
  deployer?: string
  end_time?: string
  last_success_end_time?: string
  log_url?: string
  received_time?: string
  start_time?: string
  url?: string
}

export interface PublishResult {
  deploymentId: string
  location?: string | null
  rawStatus: number
}

export interface AzureClientOptions {
  scmBaseUrl: string
  getAuthHeaders: AuthHeaderProvider
  signal?: AbortSignal
}

function hintAuth(message: string): string {
  return (
    `${message}. If using a publish profile, SCM basic auth may be disabled ` +
    'on the app — enable it or use Entra credentials instead.'
  )
}

export function createAzureClient(opts: AzureClientOptions) {
  const { scmBaseUrl, getAuthHeaders, signal } = opts
  const base = scmBaseUrl.replace(/\/$/, '')

  return {
    async publishZip(zip: Uint8Array): Promise<PublishResult> {
      const headers = await getAuthHeaders()
      let res
      try {
        res = await request(`${base}/api/publish?type=zip&async=true`, {
          method: 'POST',
          headers: {
            ...headers,
            'content-type': 'application/zip',
          },
          body: Buffer.from(zip),
          signal,
        })
      } catch (err) {
        if (err instanceof AuthError) {
          throw new AuthError(hintAuth(err.message), { cause: err })
        }
        if (err instanceof ProviderError && err.statusCode === 409) {
          throw new ProviderError(
            `${err.message}. Another deployment may be in progress — wait and retry.`,
            { statusCode: 409, body: err.body, cause: err },
          )
        }
        throw err
      }

      const deploymentId = res.headers.get('scm-deployment-id')
      if (!deploymentId) {
        throw new ValidationError(
          'Azure OneDeploy response missing SCM-DEPLOYMENT-ID header',
        )
      }

      return {
        deploymentId,
        location: res.headers.get('location'),
        rawStatus: res.status,
      }
    },

    async getDeployment(id: string): Promise<KuduDeployment> {
      const headers = await getAuthHeaders()
      try {
        const res = await request<KuduDeployment>(
          `${base}/api/deployments/${encodeURIComponent(id)}`,
          {
            headers,
            signal,
          },
        )
        return res.data
      } catch (err) {
        if (err instanceof AuthError) {
          throw new AuthError(hintAuth(err.message), { cause: err })
        }
        // Some Kudu hosts return 202 while still deploying; surface as soft status.
        if (err instanceof ProviderError && err.statusCode === 202) {
          const body = err.body
          if (body && typeof body === 'object') {
            return body as KuduDeployment
          }
        }
        throw err
      }
    },
  }
}

export type AzureClient = ReturnType<typeof createAzureClient>

/** Build SCM hostname for an app (and optional slot). */
export function defaultScmHost(appName: string, slot?: string): string {
  if (slot) {
    return `${appName}-${slot}.scm.azurewebsites.net`
  }
  return `${appName}.scm.azurewebsites.net`
}

export function defaultAppUrl(appName: string, slot?: string): string {
  if (slot) {
    return `https://${appName}-${slot}.azurewebsites.net`
  }
  return `https://${appName}.azurewebsites.net`
}

/** Re-export for tests that want mapHttpError behavior documented. */
export { mapHttpError }
