# @deployinfra/netlify

Netlify provider for [DeployInfra](https://github.com/NWylynko/deployinfra).

```ts
import { createDeployer } from '@deployinfra/sdk'
import { netlify } from '@deployinfra/netlify'

const deployer = createDeployer({
  provider: netlify({ token: process.env.NETLIFY_TOKEN! }),
})

const result = await deployer.deploy('./dist', {
  name: 'my-site',
  // or siteId: process.env.NETLIFY_SITE_ID!,
})
```

## Install

```bash
pnpm add @deployinfra/sdk @deployinfra/netlify
```

## Factory options

| Option | Required | Description |
|---|---|---|
| `token` | yes | Personal access token / OAuth token |

## `deploy()` options

| Option | Required | Description |
|---|---|---|
| `name` | no | Site name; look up existing or create (random slug when omitted) |
| `siteId` | no | Existing site id; when set, deploys there (`name` ignored for selection) |

Plus core options (`waitUntil`, `timeoutMs`, `signal`, lifecycle hooks, …).

## Caveats

- **Zip passthrough**: when the source is a zip, bytes are posted as `application/zip` without expanding.
- **GitHub** sources are always materialized to files (no native git capability in this provider).
- Digest deploys: JSON `{ files: { "/path": sha1 } }` → upload only `required` digests.

## License

Apache-2.0
