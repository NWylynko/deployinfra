# @deployinfra/cloudflare

Cloudflare Pages provider for [DeployInfra](https://github.com/deployinfra/deploy-sdk).

```ts
import { createDeployer } from '@deployinfra/sdk'
import { cloudflare } from '@deployinfra/cloudflare'

const deployer = createDeployer({
  provider: cloudflare({
    token: process.env.CLOUDFLARE_API_TOKEN!,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    // uploadConcurrency: 3,
  }),
  onStatus: (r) => console.log(r.status),
})

const result = await deployer.deploy('./dist', {
  name: 'my-site',
  branch: 'main',
})
```

## Install

```bash
pnpm add @deployinfra/sdk @deployinfra/cloudflare
```

## Factory options

Credentials and upload tuning (not per-deploy intent):

| Option | Required | Description |
|---|---|---|
| `token` | yes | Token with **Account → Cloudflare Pages → Edit** |
| `accountId` | yes | Cloudflare account id |
| `uploadConcurrency` | no | Max concurrent asset-batch uploads (default `3`) |

## `deploy()` options

| Option | Required | Description |
|---|---|---|
| `name` | no | Pages project name; random slug when omitted (created if missing) |
| `branch` | no | Branch label on the deployment (default `'main'`) |

Plus core options (`waitUntil`, `timeoutMs`, `signal`, lifecycle hooks, …).

## Caveats

- Upload protocol matches **wrangler** direct upload (BLAKE3 asset hashes, JWT upload token). Some endpoints are wrangler-internal but canonical in practice.
- Client-side limits: **20 000 files**, **25 MiB per file**.
- `_headers` / `_redirects` are sent as separate multipart fields (not in the asset manifest).

## License

Apache-2.0
