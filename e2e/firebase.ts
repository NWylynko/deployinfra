import { assertLive, FIXTURE, requireEnv, skip } from './env.ts'

const sa = requireEnv('DEPLOYINFRA_E2E_FIREBASE_SERVICE_ACCOUNT')
const projectId = requireEnv('DEPLOYINFRA_E2E_FIREBASE_PROJECT_ID')
if (!sa || !projectId) {
  skip(
    'set DEPLOYINFRA_E2E_FIREBASE_SERVICE_ACCOUNT and DEPLOYINFRA_E2E_FIREBASE_PROJECT_ID to run',
  )
}

const { createDeployer } = await import('@deployinfra/sdk')
const { firebase } = await import('@deployinfra/firebase')

const deployer = createDeployer({
  provider: firebase({ serviceAccount: sa }),
})

const result = await deployer.deploy(FIXTURE, {
  projectId,
  siteId: requireEnv('DEPLOYINFRA_E2E_FIREBASE_SITE_ID'),
  waitUntil: 'ready',
})

if (result.status !== 'ready' || !result.url) {
  throw new Error(`Expected ready deployment with url, got ${JSON.stringify(result)}`)
}

await assertLive(result.url)

if (typeof deployer.provider.deleteDeployment === 'function') {
  await deployer.provider.deleteDeployment(result.deploymentId, {
    projectId,
    siteId: requireEnv('DEPLOYINFRA_E2E_FIREBASE_SITE_ID'),
  })
}

console.log(`ok: ${result.url}`)
