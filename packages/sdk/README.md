# @deployinfra/sdk

Unified deployment SDK. Bind a provider once, deploy any supported source.

```ts
import { createDeployer } from '@deployinfra/sdk'
import { vercel } from '@deployinfra/vercel'

const deployer = createDeployer({
  provider: vercel({ token: process.env.VERCEL_TOKEN! }),
  onDeployStart: ({ name }) => console.log('deploying', name),
  onStatus: (r) => console.log(r.status),
  onDeployComplete: (r) => console.log('live', r.url),
  onDeployError: (err) => console.error(err),
})

const result = await deployer.deploy('./dist', {
  name: 'my-app',
  target: 'production', // typed from the Vercel provider
  // same hooks as createDeployer; compose (deployer first, then call)
  onDeployComplete: (r) => console.log('this call', r.url),
})
console.log(result.url, result.status)
```

## Install

```bash
pnpm add @deployinfra/sdk
```

## API

### `createDeployer({ provider, …hooks })`

Validates `provider.specificationVersion === 'v1'`, then returns a `Deployer`
whose `deploy()` options are typed from that provider.

| Hook | When |
|---|---|
| `onDeployStart` | After name is resolved, before source detection |
| `onStatus` | On create + each poll tick |
| `onDeployComplete` | When `deploy()` is about to return successfully |
| `onDeployError` | When `deploy()` is about to throw (error is rethrown) |

The same hooks are accepted on each `deploy()` call. When both levels are set,
deployer-level runs first, then the per-call hook.

### `deployer.deploy(source, options?)`

| Option | Default | Description |
|---|---|---|
| `waitUntil` | `'ready'` | `'ready'` waits until live; `'created'` returns after accept |
| `timeoutMs` | `600_000` | Overall wait timeout |
| `pollIntervalMs` | `1_000` | Base poll interval (adapts up to ~5s) |
| `signal` | — | AbortSignal for HTTP + polling |
| `onDeployStart` / `onStatus` / `onDeployComplete` / `onDeployError` | — | Same hooks as `createDeployer` (run after deployer-level) |
| `name` | generated dashed slug | Project/site name passed to the provider |
| *(provider fields)* | — | Inferred from the bound provider (e.g. Vercel `target`, Cloudflare `branch`) |

Factory options are credentials / upload tuning. Per-deploy intent
(`name`, `target`, `branch`, …) belongs on each `deploy()` call.

### Errors

`DeployError` → `AuthError`, `NotFoundError`, `RateLimitError`, `QuotaError`, `ValidationError`, `TimeoutError`, `SourceError`, `ProviderError`.

### Provider authors

Import helpers from [`@deployinfra/sdk/internal`](../../docs/provider-authoring.md) (`request`, `sha1`, `mapPool`, source adapters, …).
Declare a `CallOptions` type as `Provider<Raw, CallOptions>` so app authors get typed `deploy()` fields. See the [provider authoring guide](../../docs/provider-authoring.md).

## License

Apache-2.0
