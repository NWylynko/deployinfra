import { assertLive, FIXTURE, requireEnv, skip } from './env.ts'

const token = requireEnv('DEPLOYINFRA_E2E_CLOUDFLARE_TOKEN')
if (!token) skip('set DEPLOYINFRA_E2E_CLOUDFLARE_TOKEN to run')

const accountId = requireEnv('DEPLOYINFRA_E2E_CLOUDFLARE_ACCOUNT_ID')
if (!accountId) skip('set DEPLOYINFRA_E2E_CLOUDFLARE_ACCOUNT_ID to run')

const projectName =
  requireEnv('DEPLOYINFRA_E2E_CLOUDFLARE_PROJECT') ?? 'deployinfra-e2e'

const { createDeployer } = await import('@deployinfra/sdk')
const { cloudflare } = await import('@deployinfra/cloudflare')

const deployer = createDeployer({
  provider: cloudflare({
    token,
    accountId,
  }),
})

const result = await deployer.deploy(FIXTURE, { name: projectName, waitUntil: 'ready' })

if (result.status !== 'ready' || !result.url) {
  throw new Error(`Expected ready deployment with url, got ${JSON.stringify(result)}`)
}

await assertLive(result.url)

console.log(`ok: ${result.url}`)
