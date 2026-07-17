import { assertLive, FIXTURE, requireEnv, skip } from './env.ts'

const region = requireEnv('DEPLOYINFRA_E2E_AWS_REGION')
if (!region) skip('set DEPLOYINFRA_E2E_AWS_REGION to run')

const { createDeployer } = await import('@deployinfra/sdk')
const { aws } = await import('@deployinfra/aws')

const deployer = createDeployer({
  provider: aws({ region }),
})

const appId = requireEnv('DEPLOYINFRA_E2E_AWS_APP_ID')
const result = await deployer.deploy(FIXTURE, {
  ...(appId
    ? { appId }
    : {
        name:
          requireEnv('DEPLOYINFRA_E2E_AWS_APP_NAME') ??
          `deployinfra-e2e-${Date.now()}`,
      }),
  branchName: requireEnv('DEPLOYINFRA_E2E_AWS_BRANCH') ?? 'main',
  waitUntil: 'ready',
})

if (result.status !== 'ready' || !result.url) {
  throw new Error(`Expected ready deployment with url, got ${JSON.stringify(result)}`)
}

await assertLive(result.url)
console.log(`ok: ${result.url}`)
