# Unified Deployment SDK — Plan

## Context

Build a greenfield TypeScript SDK in `/Users/nick/dev/deploy-sdk` that unifies deployment across hosting providers. Every platform (Vercel, Netlify, Cloudflare, Railway…) has a different deploy API; this SDK puts one consistent interface in front of them:

```ts
import { createDeployer } from '@deployinfra/sdk'
import { vercel } from '@deployinfra/vercel'

const deployer = createDeployer({ provider: vercel({ token }) })
const result = await deployer.deploy('./dist')
// → { deploymentId, slug, url, aliases, status: 'ready', raw }
```

The value is breadth of providers behind one API. Decisions confirmed with user: providers Vercel/Netlify/Cloudflare Pages/Railway (AWS/GCP/Azure as post-v1 stretch); sources = local dir, zip file, zip URL, GitHub repo (+ in-memory files map); **no local builds** — deploy prebuilt output or hand the repo to the provider; **pnpm monorepo with per-provider packages**.

Suggested npm scope: `@deployinfra` (packages appear unpublished; verify org availability with `npm org ls deployinfra` before scaffolding — fallbacks `@anydeploy`, `@unideploy`).

## Stack

- **Workspace:** plain pnpm workspaces (no turborepo — 5 small packages, linear dep graph; `pnpm -r build` is already topological).
- **Build:** tsdown (rolldown-based tsup successor, first-class .d.ts). **Tests:** vitest + msw (`msw/node` intercepts native fetch). **Publishing:** changesets.
- **Node ≥22.12, ESM-only** (`require(esm)` is stable in that range, so CJS consumers still work). Native `fetch` everywhere.
- **Runtime deps (total):** core → `fflate` (zip); cloudflare → `@noble/hashes` (blake3); railway → `nanotar` + `node:zlib` (tar.gz). Vercel/Netlify need only `node:crypto` sha1.

## Monorepo layout

```
deploy-sdk/
├── package.json  pnpm-workspace.yaml  tsconfig.base.json
├── .changeset/   .github/workflows/{ci,release}.yml
├── packages/
│   ├── core/src/
│   │   ├── index.ts  deployer.ts  provider.ts  types.ts  errors.ts
│   │   ├── http.ts   poll.ts      hash.ts
│   │   └── source/{detect,resolve,dir,zip,github,files}.ts
│   ├── vercel/src/{index,provider,api,status}.ts
│   ├── netlify/src/{index,provider,api,status}.ts
│   ├── cloudflare/src/{index,provider,api,hash,upload,status}.ts
│   └── railway/src/{index,provider,api,tarball,status}.ts
├── e2e/            # tsx scripts gated on env tokens, + fixture-site/
└── docs/
```

## Core abstractions

### Sources
`SourceInput = string | SourceDescriptor` where the descriptor union covers `dir | zip | zip-url | tar | github | files` (files = in-memory `Record<path, string|Uint8Array>`). String auto-detection order: github.com URL → `github`; URL ending .zip → `zip-url`; existing local path → `dir`/`zip`/`tar` by stat+extension; `owner/repo` shorthand not on disk → `github`; ambiguous → `SourceError` telling user to pass the explicit form.

Resolution produces one of only **two canonical forms**:

```ts
type ResolvedSource = FilesSource | GitRemoteSource

interface SourceFile { path: string; size: number; read(): Promise<Uint8Array> } // lazy
interface FilesSource { kind: 'files'; files(): AsyncIterable<SourceFile>; count(): Promise<number> }
interface GitRemoteSource {
  kind: 'git'; host: 'github'; owner: string; repo: string; ref?: string
  materialize(): Promise<FilesSource>  // downloads codeload.github.com zipball, strips top dir
}
```

### Provider contract

```ts
interface Provider<Raw = unknown> {
  readonly name: string
  readonly capabilities: { sources: { files: boolean; git: boolean }; zipPassthrough?: boolean }
  deploy(source: ResolvedSource, ctx: DeployContext): Promise<DeploymentResult<Raw>>   // returns at 'created'; core waits
  getDeployment(id: string, ctx: DeployContext): Promise<DeploymentResult<Raw>>        // used by core's polling loop
  deleteDeployment?(id, ctx): Promise<void>       // optional extensions
  listDeployments?(ctx): Promise<DeploymentResult<Raw>[]>
}
```

Core's `deploy()` flow: detect → resolve → **adapt** (git source + provider lacks native git → `materialize()`; zip + `zipPassthrough` → hand bytes through) → `provider.deploy()` → poll `getDeployment()` until ready.

### Results, status, errors, await semantics

- `DeploymentStatus`: `queued | building | deploying | ready | error | canceled`.
- `DeploymentResult<Raw>`: `{ provider, deploymentId, status, url?, aliases?, projectId?, slug?, createdAt?, raw }` — `raw` is the untouched provider payload.
- Error hierarchy: `DeployError` base → `AuthError` (401/403), `NotFoundError`, `RateLimitError` (429, carries retryAfter), `QuotaError`, `ValidationError`, `TimeoutError` (carries lastStatus), `SourceError`, `ProviderError` (carries statusCode/body).
- `DeployOptions`: `waitUntil: 'created' | 'ready'` (default `'ready'` — resolves when live), `timeoutMs` (default 600s), `pollIntervalMs` (adaptive 1s→5s), `signal`, `onStatus` callback, `name`, `providerOptions` (per-call escape hatch merged over factory opts).

## Provider implementations (APIs verified July 2026)

Capability matrix — "archive fallback" = core downloads the GitHub zipball and deploys as files (no provider build):

| Source | Vercel | Netlify | Cloudflare Pages | Railway |
|---|---|---|---|---|
| dir | native (sha1 upload) | native (digest deploy) | native (direct upload) | native (tar.gz `/up`) |
| zip | core unzips | **zip passthrough** | core unzips | core unzips→re-tars |
| github | native `gitSource` (needs GH app) or archive | archive | archive | native `serviceCreate` (needs GH app) or archive |

**Netlify** `netlify({ token, siteId?, siteName? })` — Bearer token, `api.netlify.com`. Create site if needed (`POST /api/v1/sites`). Zip: `POST /api/v1/sites/{id}/deploys` with `application/zip` body. Dir: same endpoint with JSON `{files: {"/path": sha1}}` → response lists `required` shas → `PUT /api/v1/deploys/{id}/files/{path}` each (deduped across deploys). Poll `state`: `…processing → ready | error`. `url` = `deploy_ssl_url`, alias = site `ssl_url`.

**Vercel** `vercel({ token, teamId?, projectName?, target? })` — Bearer token, `api.vercel.com`, `?teamId=` on every call. Upload each file: `POST /v2/files` raw bytes + `x-vercel-digest: <sha1>` (dedupes; ~8 concurrent). Create: `POST /v13/deployments?skipAutoDetectionConfirmation=1` with `{ name, target, files: [{file, sha, size}] }` — or `gitSource: { type:'github', org, repo, ref }` (mutually exclusive with `files`; needs Vercel GitHub app, fall back to archive with clear hint). Poll `readyState`: `QUEUED/INITIALIZING → BUILDING → READY|ERROR|CANCELED`.

**Cloudflare Pages** `cloudflare({ apiToken, accountId, projectName, branch? })` — protocol lifted from wrangler source (endpoints are wrangler-internal but canonical; pin with e2e):
1. Ensure project (`GET`/`POST /accounts/{acc}/pages/projects[/{name}]`).
2. Per-file hash = `blake3(base64(contents) + ext_without_dot)` hex **truncated to 32 chars** (`@noble/hashes`; validate against wrangler's own test vectors).
3. `GET .../upload-token` → short-lived JWT (decode exp, refetch on 401).
4. `POST /pages/assets/check-missing` (no account prefix, JWT auth) → missing hashes; `POST /pages/assets/upload` with `[{key: hash, value: base64, metadata:{contentType}, base64: true}]` batched (~50 MiB/5k files per request, 3 concurrent, retry+JWT refresh); `POST /pages/assets/upsert-hashes` (non-fatal).
5. Create: `POST .../deployments` multipart with `manifest` JSON (`"/path" → hash`), `branch`; send `_headers`/`_redirects` as separate form fields like wrangler does.
6. Poll: done when `latest_stage.name === 'deploy'` && status `success|failure`. Limits: 20k files, 25 MiB/file — enforce client-side.

**Railway** `railway({ token, projectId?, environmentId?, serviceId? })` — GraphQL `backboard.railway.com/graphql/v2` (Bearer for account tokens, `Project-Access-Token` header for project tokens — recommend the latter in docs). Provision missing ids via `projectCreate`/`serviceCreate`. Dir deploy = the `railway up` path (confirmed in CLI source, CLI-parity not formally documented): `POST /project/{p}/environment/{e}/up?serviceId=` with `application/gzip` tarball → `{ deploymentId, url, deploymentDomain }`. Git: `serviceCreate(source:{repo})` (needs Railway GH app) else archive fallback. Domain: `serviceDomainCreate` when none exists. Poll GraphQL `deployment(id)` status: `QUEUED/WAITING/INITIALIZING → BUILDING → DEPLOYING → SUCCESS | FAILED/CRASHED` (introspect exact enum during M5). Docs note: Railway builds what you send — a static dir needs a static-server config; it's an app platform, non-goal to paper over in v1.

## Testing

- **Unit** (vitest + msw per package): fixture handlers asserting exact request shapes — Netlify digest→required→PUT sequence, Vercel sha1 digest headers, CF blake3 known-vectors + JWT-expiry refresh, Railway tarball + GraphQL bodies. Core: detection table tests, zip round-trip (fflate in-memory), poll timeout/abort with fake timers, HTTP error mapping (401→AuthError, 429→RateLimitError).
- **E2E** (`e2e/*.ts` via tsx, opt-in): each script skips unless `DEPLOYINFRA_E2E_<PROVIDER>_TOKEN` is set; deploys `e2e/fixture-site`, asserts `status==='ready'`, fetches the returned `url` expecting fixture content, cleans up.

## Milestones (each independently verifiable)

- **M0 Scaffold:** workspace, tsconfig, tsdown+vitest, changesets, CI (Node 22/24). ✓ `pnpm -r build && pnpm -r test` green.
- **M1 Core:** types/errors, detect/resolve pipeline, http/poll/hash utils, `createDeployer` tested against a `FakeProvider`. ✓ detection matrix + waitUntil/timeout/abort tests pass; pack dry-run shows only `fflate` dep.
- **M2 Netlify** (simplest; exercises zip passthrough + digest paths). ✓ msw suite + e2e from dir and zip.
- **M3 Vercel** (locks in multi-file-upload pattern; gitSource + archive fallback). ✓ msw suite + e2e dir deploy.
- **M4 Cloudflare Pages** (hardest protocol, after the pattern exists). ✓ hash matches wrangler vectors byte-for-byte; e2e serves on `*.pages.dev`.
- **M5 Railway** (tarball `/up` + GraphQL provisioning + domain creation; introspect status enum). ✓ e2e deploy, domain resolves.
- **M6 Docs + publish:** per-package READMEs, capability matrix, provider-authoring guide (paves the AWS/GCP/Azure path), `0.1.0` via changesets. ✓ `npm pack` audit + fresh-project install smoke test.

## Open items / risks

1. Verify `deployinfra` npm org availability before M0 (fallbacks: `@anydeploy`, `@unideploy`).
2. Cloudflare `/pages/assets/*` and Railway `/up` are undocumented-but-canonical (used by wrangler / Railway CLI); pinned by e2e tests, expect occasional churn.
3. Cloudflare `_headers`/`_redirects`: replicate wrangler's separate-form-field behavior.
4. GitHub descriptor keeps a `host` field so GitLab/Bitbucket can be added without breaking the union.
