import { assertLive, FIXTURE, requireEnv, skip } from './env.ts'

const token = requireEnv('DEPLOYINFRA_E2E_NETLIFY_TOKEN')
if (!token) skip('set DEPLOYINFRA_E2E_NETLIFY_TOKEN to run')

const { createDeployer } = await import('@deployinfra/sdk')
const { netlify } = await import('@deployinfra/netlify')

const deployer = createDeployer({
  provider: netlify({ token }),
})

const siteId = requireEnv('DEPLOYINFRA_E2E_NETLIFY_SITE_ID')
const result = await deployer.deploy(FIXTURE, {
  ...(siteId
    ? { siteId }
    : {
        name:
          requireEnv('DEPLOYINFRA_E2E_NETLIFY_SITE_NAME') ??
          `deployinfra-e2e-${Date.now()}`,
      }),
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
