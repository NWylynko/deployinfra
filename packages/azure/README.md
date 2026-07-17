# @deployinfra/azure

Azure App Service provider for [DeployInfra](https://github.com/NWylynko/deployinfra).

Zip deploy via Kudu **OneDeploy** (`POST /api/publish?type=zip&async=true`).
Supports publish-profile basic auth or Entra (`@azure/identity`) credentials.

```ts
import { createDeployer } from '@deployinfra/sdk'
import { azure } from '@deployinfra/azure'

const deployer = createDeployer({
  provider: azure({
    credentials: {
      kind: 'publishProfile',
      username: process.env.AZURE_PUBLISH_USER!,
      password: process.env.AZURE_PUBLISH_PASSWORD!,
    },
  }),
})

const result = await deployer.deploy('./dist', { appName: 'my-webapp' })
```

## Install

```bash
pnpm add @deployinfra/sdk @deployinfra/azure
```

## Prerequisites

Create the web app first (this provider does **not** provision ARM resources):

```bash
az webapp up --name my-webapp --runtime 'NODE:20-lts'
```

## Factory options

| Option | Required | Description |
|---|---|---|
| `credentials` | yes | `{ kind: 'publishProfile', username, password }` or `{ kind: 'entra', … }` |
| `scmHost` | no | Override SCM host |
| `appUrl` | no | Public URL override (unique default hostnames / custom domains) |
| `entraScope` | no | Default `https://appservice.azure.com/.default` |

Entra forms:

- `{ kind: 'entra', tenantId, clientId, clientSecret }`
- `{ kind: 'entra', credential }` — any `TokenCredential` (e.g. `DefaultAzureCredential`)

## `deploy()` options

| Option | Required | Description |
|---|---|---|
| `appName` | yes | Existing App Service name |
| `slot` | no | Deployment slot |

Plus core options (`waitUntil`, `timeoutMs`, `signal`, lifecycle hooks, …).

## Caveats

- **Not Static Web Apps**: SWA still has no plain-HTTP zip upload path suitable for this SDK (CLI/Action use a closed-source client; REST expects a pre-hosted package URL).
- New apps may get **unique default hostnames** — pass `appUrl` (publish profiles often include `destinationAppUrl`).
- SCM **basic auth** may be disabled on new apps; use Entra credentials or enable SCM basic auth.
- Cold SCM hosts can return **503** briefly — retry.
- ~**2 GB** zip limit. Linux stacks need a runtime that can serve your content.
- `WEBSITE_RUN_FROM_PACKAGE` is supported by OneDeploy in many scenarios; if deploys behave oddly, check that app setting.
- **GitHub** sources are materialized to files.

## License

Apache-2.0
