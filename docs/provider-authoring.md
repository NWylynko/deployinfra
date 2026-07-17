# Provider authoring guide

How to add a new DeployInfra provider. The reference implementation is
[`@deployinfra/netlify`](../packages/netlify/src/provider.ts) — small surface,
digest + zip paths, clear status mapping.

## Contract

Every provider implements `Provider` from `@deployinfra/sdk`:

```ts
import type { Provider } from '@deployinfra/sdk'

/** Per-call fields accepted on deploy() when using this provider. */
export interface AcmeDeployOptions {
  region?: string
}

export function acme(options: AcmeOptions): Provider<AcmeRaw, AcmeDeployOptions> {
  return {
    specificationVersion: 'v1', // required — createDeployer rejects mismatches
    name: 'acme',
    capabilities: {
      sources: { files: true, git: false },
      // zipPassthrough: true,  // optional
    },
    async deploy(source, ctx) {
      // ctx.region is typed from AcmeDeployOptions
      /* create, return at queued/building */
    },
    async getDeployment(id, ctx) { /* poll status */ },
    // deleteDeployment?(id, ctx) {}
  }
}
```

Rules:

1. **`specificationVersion: 'v1'`** — always. Core throws `ValidationError` otherwise.
2. **`deploy` returns early** — as soon as the platform has accepted the deployment. Core polls via `getDeployment` until `ready` / `error` / `canceled`.
3. **Declare capabilities honestly** — if `git: false`, core materializes GitHub sources to files before calling you. If `zipPassthrough: true`, a zip `FilesSource` may expose `zipBytes()`.
4. **Normalize status** — map provider enums onto `DeploymentStatus`: `queued | building | deploying | ready | error | canceled`.
5. **Map HTTP errors** — use `request` / `mapHttpError` from `@deployinfra/sdk/internal` so 401 → `AuthError`, 429 → `RateLimitError`, etc.
6. **Type call options** — `Provider<Raw, CallOptions>` so `createDeployer` infers typed fields on `deploy()` (factory = credentials; call = per-deploy intent).

## Internal toolkit

```ts
import {
  request,
  mapHttpError,
  sha1,
  mapPool,
  fromFiles,
  adaptSource,
  // …
} from '@deployinfra/sdk/internal'
```

| Helper | Use |
|---|---|
| `request` / `mapHttpError` | Typed fetch + error mapping |
| `sha1` / `sha256` | Digests for upload APIs |
| `mapPool` | Bounded-concurrency uploads |
| `fromFiles` / `fromDir` / `fromZip*` | Build `FilesSource` in tests |
| `adaptSource` | Rarely needed in providers (core already adapts) |
| `pollDeployment` | Prefer letting core poll; use only for custom flows |

Public app authors should import from `@deployinfra/sdk` only. The `/internal` subpath is semver-stable for **provider packages**.

## Walkthrough (Netlify-shaped)

1. **Factory options** — credentials and upload tuning (e.g.
   `uploadConcurrency`). Document token scopes in JSDoc. Resource selection and
   per-deploy intent (`name`, project/site ids, `target`, `branch`) belong on
   `CallOptions` / `deploy()`, not the factory.
2. **API client** — thin wrapper around `request` with auth headers and `signal` from `DeployContext`.
3. **`deploy`**:
   - If `source.kind === 'git'` and you don't support git, materialize (or rely on core when `capabilities.sources.git === false`).
   - Ensure project/site exists.
   - Upload (digest map, zip body, multipart, …).
   - Return `DeploymentResult` with `status` from the create response (often `queued` / `building`).
4. **`getDeployment`** — fetch by id, map status, fill `url` / `aliases`.
5. **Tests with msw** — intercept the real API host; assert auth headers, request shapes, and happy-path polling via `createDeployer`.

Minimal test sketch:

```ts
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createDeployer } from '@deployinfra/sdk'
import { fromFiles } from '@deployinfra/sdk/internal'
import { acme } from './index.js'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

it('deploys files', async () => {
  server.use(
    http.post('https://api.acme.example/deploys', () =>
      HttpResponse.json({ id: 'd1', state: 'ready', url: 'https://x.acme' }),
    ),
  )
  const deployer = createDeployer({ provider: acme({ token: 't' }) })
  const result = await deployer.deploy(
    { kind: 'files', files: { 'index.html': '<h1>ok</h1>' } },
    { waitUntil: 'created' },
  )
  expect(result.deploymentId).toBe('d1')
})
```

## Package layout

```
packages/acme/
  package.json          # depends on @deployinfra/sdk workspace:*
  src/index.ts          # acme() factory + JSDoc @example
  src/provider.ts       # Provider implementation
  src/api.ts            # HTTP client
  src/status.ts         # enum → DeploymentStatus
  src/provider.test.ts  # msw
  README.md
  LICENSE
```

Export the factory from `src/index.ts`. Keep provider-specific types (`AcmeOptions`) public; keep raw API types internal unless useful.

## Reference providers beyond Netlify

The same layout powers:

- [`@deployinfra/aws`](../packages/aws) — Amplify Hosting manual zip (`@aws-sdk/client-amplify` + presigned PUT)
- [`@deployinfra/firebase`](../packages/firebase) — Hosting REST v1beta1 (gzip SHA-256 + release)
- [`@deployinfra/azure`](../packages/azure) — App Service Kudu OneDeploy

Each has msw (and SDK-mock where needed) tests plus an opt-in `e2e/<provider>.ts` gated on `DEPLOYINFRA_E2E_*`. No core changes are required unless the shared `Provider` contract itself grows (then bump `specificationVersion`).
