# Contributing

## Setup

- **Node.js ≥ 22.12**
- **pnpm** 10 (`packageManager` field in root `package.json`)

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

The monorepo uses **pnpm workspaces** + **Turbo**. Packages live under `packages/*`; the basic example under `examples/basic`.

## Tests

Unit/integration tests are **vitest + msw** per package:

```bash
pnpm test                          # all packages
pnpm --filter @deployinfra/sdk test # one package
```

## End-to-end

Live e2e is a Vitest suite under `e2e/` (sequential, one worker). Providers without credentials **fail** (so CI surfaces missing secrets). Use `DEPLOYINFRA_E2E_PROVIDERS` to intentionally skip providers you are not testing.

```bash
pnpm test:e2e:source   # credential-free source contract (CI)
pnpm test:e2e          # smoke: one `files` deploy per enabled provider
pnpm test:e2e:full     # full matrix: dir, files, zip, zip-url, github × providers
```

### Profiles and filters

| Env | Meaning |
|---|---|
| `DEPLOYINFRA_E2E_PROFILE=smoke\|full` | Smoke (default) vs full source matrix |
| `DEPLOYINFRA_E2E_PROVIDERS=aws,firebase` | Comma allowlist (empty = all) |
| `DEPLOYINFRA_E2E_KEEP_RESOURCES=1` | Skip teardown (debug) |

### Provider credentials

| Provider | Required | Optional |
|---|---|---|
| Vercel | `DEPLOYINFRA_E2E_VERCEL_TOKEN` | `…_TEAM_ID`, `…_PROJECT` (reuse; skips project delete) |
| Netlify | `DEPLOYINFRA_E2E_NETLIFY_TOKEN` | `…_SITE_ID` (reuse; skips site delete) |
| Cloudflare | `…_CLOUDFLARE_TOKEN`, `…_ACCOUNT_ID` | `…_PROJECT` (reuse) |
| AWS | `…_AWS_REGION` + AWS default credential chain | `…_APP_ID`, `…_BRANCH` |
| Firebase | `…_FIREBASE_PROJECT_ID` (+ `…_SERVICE_ACCOUNT` or ADC) | `…_SITE_ID` (reuse default/shared site) |

### GitHub fixture

Full profile deploys a public GitHub repo at **repository root** (the SDK strips only the zipball wrapper, not a subdirectory).

| Env | Default |
|---|---|
| `DEPLOYINFRA_E2E_GITHUB_OWNER` | `NWylynko` |
| `DEPLOYINFRA_E2E_GITHUB_REPO` | `deployinfra-e2e-fixture` |
| `DEPLOYINFRA_E2E_GITHUB_REF` | (default branch) |
| `DEPLOYINFRA_E2E_GITHUB_ROOT` | unset — if set, contract tests document that subdirectory selection is unsupported |

Create a public repo whose root matches `e2e/fixtures/site` (`index.html` with `deployinfra-ok`).

### Teardown

By default the suite creates disposable names/ids and cascade-deletes:

- Vercel → `deleteProject`
- Netlify → `deleteSite`
- Cloudflare → `deleteProject`
- AWS → `deleteApp` (or `deleteBranch` when reusing an app)
- Firebase → `deleteSite` for non-default sites; otherwise best-effort version delete (cannot unpublish)

When reuse IDs are set via env, cleanup is narrower so shared resources survive.

### Cost / quotas

Full matrix is **5 sources × N providers**. Prefer smoke locally; use `DEPLOYINFRA_E2E_PROVIDERS` to limit blast radius. `.github/workflows/e2e.yml` runs the full matrix for every commit in a non-draft pull request targeting `main`, using the `e2e` GitHub Environment for secrets.

## Changesets

This repo uses [changesets](https://github.com/changesets/changesets) for versioning and publishing.

```bash
pnpm exec changeset          # declare a change
pnpm exec changeset version  # bump versions + changelogs (CI / release)
```

Provider packages depend on `@deployinfra/sdk` via `workspace:*`; changesets rewrites that to a real semver range on publish.

## Package conventions

- ESM-only, `sideEffects: false`, `engines.node: >=22.12.0`
- Public surface from `@deployinfra/sdk`; provider helpers from `@deployinfra/sdk/internal`
- Every provider sets `specificationVersion: 'v1'`
- Apache-2.0 `LICENSE` + `README.md` ship in the npm tarball

Release dry-run: `pnpm -r --filter './packages/*' exec npm pack --dry-run`, then `bash scripts/smoke-pack.sh` (fresh install of the core tarball + FakeProvider).

See [docs/provider-authoring.md](./docs/provider-authoring.md) to add a provider.
