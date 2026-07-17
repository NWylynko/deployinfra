import type { DeploymentStatus } from '@deployinfra/sdk'

/**
 * Kudu `DeployStatus` integers → normalized status.
 * 0 Pending, 1 Building, 2 Deploying, 3 Failed, 4 Success.
 */
export function mapKuduDeployStatus(
  status: number | string | undefined,
  complete?: boolean,
): DeploymentStatus {
  const n = typeof status === 'string' ? Number(status) : status
  switch (n) {
    case 0:
      return 'queued'
    case 1:
      return 'building'
    case 2:
      return 'deploying'
    case 3:
      return 'error'
    case 4:
      return 'ready'
    default:
      if (complete === false) return 'deploying'
      return 'deploying'
  }
}
