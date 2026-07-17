import type { DeploymentResult, Provider, SourceInput } from '@deployinfra/sdk'
import { env, providerEnabled, uniqueSlug } from './env.ts'

export interface CleanupContext {
  deploymentId?: string
}

export interface TrackedProvider {
  provider: Provider
  deployOptions: () => Record<string, unknown>
  onStatus?: (result: DeploymentResult) => void
  cleanup: (ctx: CleanupContext) => Promise<void>
}

export interface ProviderAdapter {
  name: string
  enabled: boolean
  skipReason?: string
  timeoutMs: number
  /** When false, skip HTTP content marker check (unused; Railway fixture serves marker). */
  assertLive?: boolean
  createTracked: () => TrackedProvider
}

function disabled(name: string, reason: string): ProviderAdapter {
  return {
    name,
    enabled: false,
    skipReason: reason,
    timeoutMs: 60_000,
    createTracked: () => {
      throw new Error(`Provider ${name} is disabled`)
    },
  }
}

export async function loadAdapters(): Promise<ProviderAdapter[]> {
  return [
    await vercelAdapter(),
    await netlifyAdapter(),
    await cloudflareAdapter(),
    await railwayAdapter(),
    await awsAdapter(),
    await firebaseAdapter(),
  ]
}

async function vercelAdapter(): Promise<ProviderAdapter> {
  const name = 'vercel'
  if (!providerEnabled(name)) return disabled(name, 'filtered out')
  const token = env('DEPLOYINFRA_E2E_VERCEL_TOKEN')
  if (!token) return disabled(name, 'set DEPLOYINFRA_E2E_VERCEL_TOKEN')

  const { vercel } = await import('@deployinfra/vercel')
  const teamId = env('DEPLOYINFRA_E2E_VERCEL_TEAM_ID')
  const reuseProject = env('DEPLOYINFRA_E2E_VERCEL_PROJECT')

  return {
    name,
    enabled: true,
    timeoutMs: 8 * 60_000,
    createTracked() {
      const projectName = reuseProject ?? uniqueSlug('di-e2e')
      const created = !reuseProject
      const provider = vercel({ token, teamId })
      return {
        provider,
        deployOptions: () => ({ name: projectName, target: 'production' }),
        async cleanup() {
          if (created) {
            await provider.deleteProject(projectName)
          }
        },
      }
    },
  }
}

async function netlifyAdapter(): Promise<ProviderAdapter> {
  const name = 'netlify'
  if (!providerEnabled(name)) return disabled(name, 'filtered out')
  const token = env('DEPLOYINFRA_E2E_NETLIFY_TOKEN')
  if (!token) return disabled(name, 'set DEPLOYINFRA_E2E_NETLIFY_TOKEN')

  const { netlify } = await import('@deployinfra/netlify')
  const reuseSiteId = env('DEPLOYINFRA_E2E_NETLIFY_SITE_ID')

  return {
    name,
    enabled: true,
    timeoutMs: 5 * 60_000,
    createTracked() {
      const siteName = uniqueSlug('di-e2e')
      const provider = netlify({ token })
      let siteId = reuseSiteId
      const created = !reuseSiteId
      return {
        provider,
        deployOptions: () =>
          siteId ? { siteId } : { name: siteName },
        onStatus(r) {
          if (r.projectId) siteId = r.projectId
        },
        async cleanup() {
          if (created && siteId) {
            await provider.deleteSite(siteId)
          }
        },
      }
    },
  }
}

async function cloudflareAdapter(): Promise<ProviderAdapter> {
  const name = 'cloudflare'
  if (!providerEnabled(name)) return disabled(name, 'filtered out')
  const token = env('DEPLOYINFRA_E2E_CLOUDFLARE_TOKEN')
  const accountId = env('DEPLOYINFRA_E2E_CLOUDFLARE_ACCOUNT_ID')
  if (!token || !accountId) {
    return disabled(
      name,
      'set DEPLOYINFRA_E2E_CLOUDFLARE_TOKEN and DEPLOYINFRA_E2E_CLOUDFLARE_ACCOUNT_ID',
    )
  }

  const { cloudflare } = await import('@deployinfra/cloudflare')
  const reuseProject = env('DEPLOYINFRA_E2E_CLOUDFLARE_PROJECT')

  return {
    name,
    enabled: true,
    timeoutMs: 5 * 60_000,
    createTracked() {
      const projectName = reuseProject ?? uniqueSlug('di-e2e')
      const created = !reuseProject
      const provider = cloudflare({ token, accountId })
      return {
        provider,
        deployOptions: () => ({ name: projectName, branch: 'main' }),
        async cleanup() {
          if (created) {
            await provider.deleteProject(projectName)
          }
        },
      }
    },
  }
}

async function railwayAdapter(): Promise<ProviderAdapter> {
  const name = 'railway'
  if (!providerEnabled(name)) return disabled(name, 'filtered out')
  const token = env('DEPLOYINFRA_E2E_RAILWAY_TOKEN')
  if (!token) return disabled(name, 'set DEPLOYINFRA_E2E_RAILWAY_TOKEN')

  const { railway } = await import('@deployinfra/railway')
  const reuseProjectId = env('DEPLOYINFRA_E2E_RAILWAY_PROJECT_ID')
  const environmentId = env('DEPLOYINFRA_E2E_RAILWAY_ENVIRONMENT_ID')
  const serviceId = env('DEPLOYINFRA_E2E_RAILWAY_SERVICE_ID')

  return {
    name,
    enabled: true,
    timeoutMs: 12 * 60_000,
    createTracked() {
      const provider = railway({ token })
      let projectId = reuseProjectId
      const created = !reuseProjectId
      return {
        provider,
        deployOptions: () => ({
          name: uniqueSlug('di-e2e'),
          projectId,
          environmentId,
          serviceId,
        }),
        onStatus(r) {
          if (r.projectId) projectId = r.projectId
        },
        async cleanup() {
          if (created && projectId) {
            await provider.deleteProject(projectId)
          }
        },
      }
    },
  }
}

async function awsAdapter(): Promise<ProviderAdapter> {
  const name = 'aws'
  if (!providerEnabled(name)) return disabled(name, 'filtered out')
  const region = env('DEPLOYINFRA_E2E_AWS_REGION')
  if (!region) return disabled(name, 'set DEPLOYINFRA_E2E_AWS_REGION')

  const { aws } = await import('@deployinfra/aws')
  const reuseAppId = env('DEPLOYINFRA_E2E_AWS_APP_ID')
  const branchName =
    env('DEPLOYINFRA_E2E_AWS_BRANCH') ??
    (reuseAppId ? `e2e-${Date.now().toString(36)}` : 'main')

  return {
    name,
    enabled: true,
    timeoutMs: 12 * 60_000,
    createTracked() {
      const provider = aws({ region })
      let appId = reuseAppId
      const createdApp = !reuseAppId
      const createdBranch = Boolean(reuseAppId)
      return {
        provider,
        deployOptions: () =>
          appId
            ? { appId, branchName }
            : { name: uniqueSlug('di-e2e'), branchName },
        onStatus(r) {
          if (r.projectId) appId = r.projectId
        },
        async cleanup() {
          if (!appId) return
          if (createdApp) {
            await provider.deleteApp(appId)
          } else if (createdBranch) {
            await provider.deleteBranch(appId, branchName)
          }
        },
      }
    },
  }
}

async function firebaseAdapter(): Promise<ProviderAdapter> {
  const name = 'firebase'
  if (!providerEnabled(name)) return disabled(name, 'filtered out')
  const projectId = env('DEPLOYINFRA_E2E_FIREBASE_PROJECT_ID')
  const sa = env('DEPLOYINFRA_E2E_FIREBASE_SERVICE_ACCOUNT')
  if (!projectId) {
    return disabled(name, 'set DEPLOYINFRA_E2E_FIREBASE_PROJECT_ID')
  }

  const { firebase } = await import('@deployinfra/firebase')
  const reuseSiteId = env('DEPLOYINFRA_E2E_FIREBASE_SITE_ID')

  return {
    name,
    enabled: true,
    timeoutMs: 5 * 60_000,
    createTracked() {
      // Site ids: hostname label, ≤30 chars, globally unique.
      const siteId =
        reuseSiteId ??
        uniqueSlug('die2e').replace(/-/g, '').slice(0, 30)
      const createdSite = !reuseSiteId && siteId !== projectId
      const provider = firebase(
        sa ? { serviceAccount: sa } : {},
      )
      let deploymentId: string | undefined
      return {
        provider,
        deployOptions: () => ({ projectId, siteId }),
        onStatus(r) {
          deploymentId = r.deploymentId
        },
        async cleanup(ctx) {
          const id = ctx.deploymentId ?? deploymentId
          if (createdSite) {
            await provider.deleteSite(projectId, siteId)
            return
          }
          if (id) {
            await provider.deleteDeployment(id, { projectId, siteId })
          }
        },
      }
    },
  }
}

/** Re-export for typing deploy helpers. */
export type { SourceInput }
