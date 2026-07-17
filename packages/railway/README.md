# @deployinfra/railway

Railway provider for [DeployInfra](https://github.com/NWylynko/deployinfra).

```ts
import { createDeployer } from '@deployinfra/sdk'
import { railway } from '@deployinfra/railway'

const deployer = createDeployer({
  provider: railway({ token: process.env.RAILWAY_TOKEN! }),
})

const result = await deployer.deploy('./dist', {
  projectId: process.env.RAILWAY_PROJECT_ID,
  environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
  serviceId: process.env.RAILWAY_SERVICE_ID,
})
```

## Install

```bash
pnpm add @deployinfra/sdk @deployinfra/railway
```

## Factory options

| Option | Required | Description |
|---|---|---|
| `token` | yes | Prefer a **project token** (`Project-Access-Token`) over an account token |

## `deploy()` options

| Option | Required | Description |
|---|---|---|
| `projectId` | no | Created on first deploy when omitted |
| `environmentId` | no | Defaults to the project's production environment |
| `serviceId` | no | Created on first deploy when omitted |

Plus core options (`name`, `waitUntil`, `timeoutMs`, `signal`, lifecycle hooks, …).

## Caveats

- Deploys via the `railway up` path: gzip tarball to `/project/{p}/environment/{e}/up`.
- **Railway builds what you send.** A static HTML directory needs a static file server in the service config — this SDK does not invent one.
- GitHub: `serviceCreate(source: { repo })` when the Railway GitHub app is linked; otherwise archive materialization + `/up`.

## License

Apache-2.0
