# @deployinfra/aws

AWS Amplify Hosting provider for [DeployInfra](https://github.com/deployinfra/deploy-sdk).

Manual zip deploys (no Git connection required). Uses `@aws-sdk/client-amplify`
and the SDK default credential chain when `credentials` is omitted.

```ts
import { createDeployer } from '@deployinfra/sdk'
import { aws } from '@deployinfra/aws'

const deployer = createDeployer({
  provider: aws({ region: 'us-east-1' }),
})

const result = await deployer.deploy('./dist', {
  name: 'my-app',
  // or appId: process.env.AMPLIFY_APP_ID!,
})
```

## Install

```bash
pnpm add @deployinfra/sdk @deployinfra/aws
```

## Factory options

| Option | Required | Description |
|---|---|---|
| `region` | yes | Amplify region (e.g. `us-east-1`) |
| `credentials` | no | Explicit AWS credentials; otherwise the default chain |

## `deploy()` options

| Option | Required | Description |
|---|---|---|
| `name` | no* | App name for `CreateApp` when `appId` is omitted |
| `appId` | no* | Existing Amplify app id |
| `branchName` | no | Branch name (default `main`; auto-created as `PRODUCTION`) |

\* One of `appId` or `name` is required (`createDeployer` supplies a random slug when both are omitted).

Plus core options (`waitUntil`, `timeoutMs`, `signal`, lifecycle hooks, …).

## Caveats

- **Zip at archive root**: Amplify serves the zip root. Zipping a parent folder (so `index.html` is nested) commonly yields “Access Denied”.
- **5 GB** zip limit; **8 hour** window between `CreateDeployment` and `StartDeployment`.
- Presigned upload URLs must be used promptly; do not assume they last the full 8 hours.
- **GitHub** sources are materialized to files (no native git capability).
- URL shape: `https://{branchDisplayName}.{app.defaultDomain}`.

## License

Apache-2.0
