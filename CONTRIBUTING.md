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

Opt-in scripts under `e2e/` skip unless a token env var is set:

| Script | Required env |
|---|---|
| `pnpm e2e:vercel` | `DEPLOYINFRA_E2E_VERCEL_TOKEN` (+ optional `…_TEAM_ID`, `…_PROJECT`) |
| `pnpm e2e:netlify` | `DEPLOYINFRA_E2E_NETLIFY_TOKEN` (+ optional `…_SITE_ID`, `…_SITE_NAME`) |
| `pnpm e2e:cloudflare` | `DEPLOYINFRA_E2E_CLOUDFLARE_TOKEN`, `…_ACCOUNT_ID` (+ optional `…_PROJECT`) |
| `pnpm e2e:railway` | `DEPLOYINFRA_E2E_RAILWAY_TOKEN` (+ optional project/env/service ids) |
| `pnpm e2e:aws` | `DEPLOYINFRA_E2E_AWS_REGION` (+ optional `…_APP_ID` / `…_APP_NAME` / `…_BRANCH`; AWS default credential chain) |
| `pnpm e2e:firebase` | `DEPLOYINFRA_E2E_FIREBASE_SERVICE_ACCOUNT`, `…_PROJECT_ID` (+ optional `…_SITE_ID`) |
| `pnpm e2e:azure` | `DEPLOYINFRA_E2E_AZURE_APP_NAME` + publish profile (`…_PUBLISH_USER`/`…_PUBLISH_PASSWORD`) or Entra (`…_TENANT_ID`/`…_CLIENT_ID`/`…_CLIENT_SECRET`); optional `…_SCM_HOST`, `…_APP_URL`, `…_SLOT` |

Each script deploys `e2e/fixture-site`, asserts `status === 'ready'`, fetches the URL, and cleans up when the provider supports deletion.

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
