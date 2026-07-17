# DeployInfra

One API to deploy to Vercel, Netlify, Cloudflare Pages, Railway, AWS Amplify,
and Firebase Hosting.

```ts
import { createDeployer } from '@deployinfra/sdk'
import { vercel } from '@deployinfra/vercel'

const deployer = createDeployer({
  provider: vercel({ token: process.env.VERCEL_TOKEN! }),
})

const result = await deployer.deploy('./dist', { name: 'my-app' })
// → { deploymentId, url, status: 'ready', … }
```

## Install

```bash
pnpm add @deployinfra/sdk @deployinfra/vercel
# or: @deployinfra/netlify | @deployinfra/cloudflare | @deployinfra/railway
# or: @deployinfra/aws | @deployinfra/firebase
```

Requires **Node.js ≥ 22.12**.

## Providers

| Package | Auth | Notes |
|---|---|---|
| [`@deployinfra/vercel`](./packages/vercel) | Access token | Optional `teamId`. GitHub deploy needs the Vercel GitHub app (else archive fallback). |
| [`@deployinfra/netlify`](./packages/netlify) | Personal access token | Pass `siteId` or `name` on `deploy()`. Zip passthrough supported. |
| [`@deployinfra/cloudflare`](./packages/cloudflare) | API token (**Pages Write**) + account id | Wrangler-compatible direct upload. |
| [`@deployinfra/railway`](./packages/railway) | Prefer a **project token** | Builds what you send — static dirs need a server. |
| [`@deployinfra/aws`](./packages/aws) | AWS credential chain / explicit keys | Amplify Hosting manual zip deploy. Pass `appId` or `name` on `deploy()`. |
| [`@deployinfra/firebase`](./packages/firebase) | ADC or service account | Firebase Hosting REST (`v1beta1`). Pass `projectId` on `deploy()`. |

## Capability matrix

| Source | Vercel | Netlify | Cloudflare Pages | Railway | AWS Amplify | Firebase Hosting |
|---|---|---|---|---|---|---|
| dir | native (sha1 upload) | native (digest deploy) | native (direct upload) | native (tar.gz `/up`) | zip (fflate) | gzip + sha256 |
| zip | core unzips | **zip passthrough** | core unzips | core unzips → re-tars | **zip passthrough** | core unzips |
| github | native `gitSource` (needs GH app) or archive | archive | archive | serviceCreate (needs GH app) or archive | archive | archive |

## Quickstart

```ts
import { createDeployer } from '@deployinfra/sdk'
import { netlify } from '@deployinfra/netlify'

const deployer = createDeployer({
  provider: netlify({ token: process.env.NETLIFY_TOKEN! }),
})

const result = await deployer.deploy('./dist', {
  name: 'my-site',
  waitUntil: 'ready',
  onStatus: (r) => console.log(r.status),
})

console.log(result.url)
```

Sources can be a local directory, zip path/URL, GitHub repo URL, or an explicit descriptor (`{ kind: 'files', files: { … } }`).
Project and site names are passed per deployment as `deploy(source, { name })`;
when omitted, `createDeployer()` generates a dashed slug.

## Packages

- [`@deployinfra/sdk`](./packages/sdk) — `createDeployer`, types, errors
- [`@deployinfra/sdk/internal`](./docs/provider-authoring.md) — provider-author toolkit
- Provider packages above

## Guides

- [Provider authoring](./docs/provider-authoring.md) — implement a new provider
- [Contributing](./CONTRIBUTING.md) — setup, tests, changesets

## License

Apache-2.0
