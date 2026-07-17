# @deployinfra/vercel

Vercel provider for [DeployInfra](https://github.com/deployinfra/deploy-sdk).

```ts
import { createDeployer } from '@deployinfra/sdk'
import { vercel } from '@deployinfra/vercel'

const deployer = createDeployer({
  provider: vercel({
    token: process.env.VERCEL_TOKEN!,
    // teamId: 'team_…',
    // uploadConcurrency: 8,
  }),
  onStatus: (r) => console.log(r.status),
})

const result = await deployer.deploy('./dist', {
  name: 'my-app',
  target: 'production',
})
```

## Install

```bash
pnpm add @deployinfra/sdk @deployinfra/vercel
```

## Factory options

Credentials and upload tuning (not per-deploy intent):

| Option | Required | Description |
|---|---|---|
| `token` | yes | Vercel access token with deploy scope |
| `teamId` | no | Appended as `?teamId=` on every call |
| `uploadConcurrency` | no | Max parallel file uploads (default `8`) |

## `deploy()` options

| Option | Required | Description |
|---|---|---|
| `name` | no | Project name; random slug generated when omitted |
| `target` | no | `production` \| `preview` \| `staging` \| `development` |

Plus core options (`waitUntil`, `timeoutMs`, `signal`, lifecycle hooks, …).

## Caveats

- **GitHub `gitSource`** requires the Vercel GitHub app on the repo. If create fails, the provider materializes the GitHub zipball and uploads files instead.
- File deploys use `POST /v2/files` digests (`x-vercel-digest`); 409 is treated as a successful dedupe hit.

## License

Apache-2.0
