import { assertLive, FIXTURE, requireEnv, skip } from './env.ts'

const token = requireEnv('DEPLOYINFRA_E2E_VERCEL_TOKEN')
if (!token) skip('set DEPLOYINFRA_E2E_VERCEL_TOKEN to run')

const { createDeployer } = await import('@deployinfra/sdk')
const { vercel } = await import('@deployinfra/vercel')

const deployer = createDeployer({
  provider: vercel({
    token,
    teamId: requireEnv('DEPLOYINFRA_E2E_VERCEL_TEAM_ID'),
  }),
})

const result = await deployer.deploy(FIXTURE, {
  name: requireEnv('DEPLOYINFRA_E2E_VERCEL_PROJECT') ?? `deployinfra-e2e-${Date.now()}`,
  waitUntil: 'ready',
})

if (result.status !== 'ready' || !result.url) {
  throw new Error(`Expected ready deployment with url, got ${JSON.stringify(result)}`)
}

await assertLive(result.url)

if (typeof deployer.provider.deleteDeployment === 'function') {
  await deployer.provider.deleteDeployment(result.deploymentId, {})
}

console.log(`ok: ${result.url}`)
