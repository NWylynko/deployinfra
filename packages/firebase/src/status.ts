import type { DeploymentStatus } from '@deployinfra/sdk'

/** Firebase Hosting `Version.status` → normalized status. */
export function mapFirebaseVersionStatus(
  status: string | undefined,
): DeploymentStatus {
  switch (status) {
    case 'FINALIZED':
      return 'ready'
    case 'DELETED':
    case 'ABANDONED':
      return 'canceled'
    case 'EXPIRED':
      return 'error'
    case 'CREATED':
    case 'CLONING':
    case 'VERSION_STATUS_UNSPECIFIED':
    default:
      return 'deploying'
  }
}
