import type { DeploymentStatus } from '@deployinfra/sdk'

export function mapCloudflareStage(stage?: {
  name?: string
  status?: string
}): DeploymentStatus {
  if (!stage) return 'queued'
  const { name, status } = stage
  if (name === 'deploy' && status === 'success') return 'ready'
  if (status === 'failure' || status === 'canceled') return 'error'
  if (name === 'build' || name === 'queued') return 'building'
  if (name === 'deploy') return 'deploying'
  return 'deploying'
}
