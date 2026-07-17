# @deployinfra/firebase

Firebase Hosting provider for [DeployInfra](https://github.com/NWylynko/deployinfra).

Deploys via the Hosting REST API (`v1beta1`): gzip + SHA-256 file protocol,
finalize, and synchronous release.

```ts
import { createDeployer } from '@deployinfra/sdk'
import { firebase } from '@deployinfra/firebase'

const deployer = createDeployer({
  provider: firebase({
    // optional — otherwise Application Default Credentials
    serviceAccount: JSON.parse(process.env.FIREBASE_SA!),
  }),
})

const result = await deployer.deploy('./dist', {
  projectId: 'my-gcp-project',
  // siteId: 'my-site', // defaults to projectId (default site)
})
```

## Install

```bash
pnpm add @deployinfra/sdk @deployinfra/firebase
```

## Factory options

| Option | Required | Description |
|---|---|---|
| `serviceAccount` | no | Service account JSON object/string; ADC when omitted |
| `uploadConcurrency` | no | Concurrent file uploads (default `8`) |

## `deploy()` options

| Option | Required | Description |
|---|---|---|
| `projectId` | yes | GCP / Firebase project id |
| `siteId` | no | Hosting site id (defaults to `projectId`) |

Plus core options (`waitUntil`, `timeoutMs`, `signal`, lifecycle hooks, …).

## Caveats

- The **default site** (`siteId === projectId`) must already exist — enable Firebase Hosting in the console. Additional site ids are created automatically.
- Hash = **SHA-256 of gzipped bytes**; uploads go to `upload-firebasehosting.googleapis.com` with a bearer token.
- `populateFiles` is batched at 1000 files per request.
- `deleteDeployment` deletes a version resource; it does **not** un-release the live site.
- **GitHub** sources are materialized to files.

## License

Apache-2.0
