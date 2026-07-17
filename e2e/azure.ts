import { assertLive, FIXTURE, requireEnv, skip } from './env.ts'

const appName = requireEnv('DEPLOYINFRA_E2E_AZURE_APP_NAME')
if (!appName) skip('set DEPLOYINFRA_E2E_AZURE_APP_NAME to run')

const publishUser = requireEnv('DEPLOYINFRA_E2E_AZURE_PUBLISH_USER')
const publishPassword = requireEnv('DEPLOYINFRA_E2E_AZURE_PUBLISH_PASSWORD')
const tenantId = requireEnv('DEPLOYINFRA_E2E_AZURE_TENANT_ID')
const clientId = requireEnv('DEPLOYINFRA_E2E_AZURE_CLIENT_ID')
const clientSecret = requireEnv('DEPLOYINFRA_E2E_AZURE_CLIENT_SECRET')

const { createDeployer } = await import('@deployinfra/sdk')
const { azure } = await import('@deployinfra/azure')

let credentials
if (publishUser && publishPassword) {
  credentials = {
    kind: 'publishProfile' as const,
    username: publishUser,
    password: publishPassword,
  }
} else if (tenantId && clientId && clientSecret) {
  credentials = {
    kind: 'entra' as const,
    tenantId,
    clientId,
    clientSecret,
  }
} else {
  skip(
    'set DEPLOYINFRA_E2E_AZURE_PUBLISH_USER/PASSWORD or TENANT_ID/CLIENT_ID/CLIENT_SECRET to run',
  )
}

const deployer = createDeployer({
  provider: azure({
    credentials,
    scmHost: requireEnv('DEPLOYINFRA_E2E_AZURE_SCM_HOST'),
    appUrl: requireEnv('DEPLOYINFRA_E2E_AZURE_APP_URL'),
  }),
})

const result = await deployer.deploy(FIXTURE, {
  appName,
  slot: requireEnv('DEPLOYINFRA_E2E_AZURE_SLOT'),
  waitUntil: 'ready',
})

if (result.status !== 'ready' || !result.url) {
  throw new Error(`Expected ready deployment with url, got ${JSON.stringify(result)}`)
}

await assertLive(result.url)
console.log(`ok: ${result.url}`)
