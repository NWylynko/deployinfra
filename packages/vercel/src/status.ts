import type { DeploymentStatus } from '@deployinfra/sdk'

/** Vercel deployment `readyState` → normalized status. */
export function mapVercelReadyState(state: string | undefined): DeploymentStatus {
  switch (state) {
    case 'READY':
      return 'ready'
    case 'ERROR':
      return 'error'
    case 'CANCELED':
      return 'canceled'
    case 'QUEUED':
    case 'INITIALIZING':
      return 'queued'
    case 'BUILDING':
      return 'building'
    default:
      return 'deploying'
  }
}
