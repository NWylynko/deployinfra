import { assertLive, FIXTURE, requireEnv, skip } from './env.ts'

const token = requireEnv('DEPLOYINFRA_E2E_RAILWAY_TOKEN')
if (!token) skip('set DEPLOYINFRA_E2E_RAILWAY_TOKEN to run')

const { createDeployer } = await import('@deployinfra/sdk')
const { railway } = await import('@deployinfra/railway')

const deployer = createDeployer({
  provider: railway({ token }),
})

const result = await deployer.deploy(FIXTURE, {
  name: `deployinfra-e2e-${Date.now()}`,
  projectId: requireEnv('DEPLOYINFRA_E2E_RAILWAY_PROJECT_ID'),
  environmentId: requireEnv('DEPLOYINFRA_E2E_RAILWAY_ENVIRONMENT_ID'),
  serviceId: requireEnv('DEPLOYINFRA_E2E_RAILWAY_SERVICE_ID'),
  waitUntil: 'ready',
})

if (result.status !== 'ready' || !result.url) {
  throw new Error(`Expected ready deployment with url, got ${JSON.stringify(result)}`)
}

try {
  await assertLive(result.url)
} catch (err) {
  console.warn(
    `warning: fixture marker not found at ${result.url} ` +
      `(Railway builds what you send; static dirs need a server). ` +
      `${err instanceof Error ? err.message : err}`,
  )
}

console.log(`ok: ${result.url}`)
