import type { DeploymentStatus } from '@deployinfra/sdk'

/** Railway GraphQL deployment status → normalized. */
export function mapRailwayStatus(status: string | undefined): DeploymentStatus {
  switch (status) {
    case 'SUCCESS':
      return 'ready'
    case 'FAILED':
    case 'CRASHED':
    case 'REMOVED':
      return 'error'
    case 'CANCELED':
      return 'canceled'
    case 'QUEUED':
    case 'WAITING':
    case 'PENDING':
      return 'queued'
    case 'INITIALIZING':
    case 'BUILDING':
      return 'building'
    case 'DEPLOYING':
      return 'deploying'
    default:
      return 'deploying'
  }
}
