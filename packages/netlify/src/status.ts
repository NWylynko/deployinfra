import type { DeploymentStatus } from '@deployinfra/sdk'

/** Netlify deploy `state` values → normalized status. */
export function mapNetlifyState(state: string | undefined): DeploymentStatus {
  switch (state) {
    case 'ready':
      return 'ready'
    case 'error':
      return 'error'
    case 'new':
    case 'pending_review':
    case 'accepted':
      return 'queued'
    case 'uploading':
    case 'uploaded':
    case 'preparing':
    case 'prepared':
    case 'processing':
      return 'deploying'
    case 'retrying':
      return 'building'
    default:
      return 'deploying'
  }
}
