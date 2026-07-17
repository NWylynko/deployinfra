import type { DeploymentStatus } from '@deployinfra/sdk'

/** Amplify `JobSummary.status` → normalized status. */
export function mapAmplifyJobStatus(
  status: string | undefined,
): DeploymentStatus {
  switch (status) {
    case 'CREATED':
    case 'PENDING':
    case 'PROVISIONING':
      return 'queued'
    case 'RUNNING':
      return 'deploying'
    case 'SUCCEED':
      return 'ready'
    case 'FAILED':
      return 'error'
    case 'CANCELLING':
    case 'CANCELLED':
      return 'canceled'
    default:
      return 'deploying'
  }
}
