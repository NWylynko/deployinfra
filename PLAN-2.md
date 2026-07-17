# DeployInfra polish plan — match the Vercel AI SDK package standard

## Context

The monorepo at `/Users/nick/dev/deploy-sdk` is functionally complete: `@deployinfra/sdk` + 4 providers (vercel, netlify, cloudflare, railway), 50 passing vitest/msw tests, working example, CI + changesets release workflow. An audit against the standard set by Vercel's AI SDK packages (`ai`, `@ai-sdk/*` — the model we're following) found the **code is production-grade but the package presentation is not**: zero npm metadata, no READMEs/LICENSE, ~40% JSDoc coverage, internals leaking from core's public export, no provider spec versioning, e2e scripts unmaterialized, everything still `private: true` at 0.0.0.

What makes AI SDK packages the benchmark (from research): tiny versioned provider spec with shared utils separated from the public surface, thorough TSDoc with examples, per-package READMEs + capability matrix docs, a provider-authoring guide that grew them from 4 to 25+ providers, and immaculate package.json hygiene (sideEffects, exports, provenance). This plan closes those gaps. No behavioral changes to deploy logic.

## Workstream 1 — API surface (the AI SDK "narrow waist")

**Files: `packages/sdk/src/index.ts`, new `packages/sdk/src/internal.ts`, `packages/sdk/src/provider.ts`, `packages/sdk/package.json`, all 4 `packages/*/src/*.ts` imports.**

1. **Add spec versioning**: `readonly specificationVersion: 'v1'` on the `Provider` interface (packages/sdk/src/provider.ts:13); set it in all 4 providers; `createDeployer` throws a clear `ValidationError` on mismatch. This is the AI SDK's `specificationVersion` pattern — it makes future breaking spec changes diagnosable instead of mysterious type errors.
2. **Split public vs internal exports**, mirroring `ai` vs `@ai-sdk/provider-utils`:
   - `@deployinfra/sdk` (main): `createDeployer`, `Deployer`, all types, all 8 error classes, `Provider`, source descriptor types. That's what app authors need.
   - `@deployinfra/sdk/internal` (new subpath export in the exports map, built as second tsdown entry): `request`, `mapHttpError`, `pollDeployment`, `sha1`/`sha256`, `adaptSource`, `detect`/`resolve`/`fromDir`/`fromFiles`/`fromZip*`/`createGitHubSource`/`stripGithubRoot`, `mapPool` — the provider-author toolkit. Update the 4 provider packages to import from the subpath.
   - Semver note in both files' header JSDoc: main = stable, internal = stable-for-provider-authors.
3. **JSDoc to 100% of public API** with `@example` blocks on the big five: `createDeployer`, `DeployOptions` (every field), `Provider`, and each provider factory (`vercel()`, `netlify()`, `cloudflare()`, `railway()` — document every option incl. token scopes needed, e.g. "Pages Write" for Cloudflare, project token recommendation for Railway). AI SDK option types are fully TSDoc'd; match that.

## Workstream 2 — package.json hygiene (all 5 packages + root)

Apply to `packages/*/package.json`:
- `"private": true` → remove; `version` stays 0.0.0 (changesets bumps to 0.1.0 at release).
- Add: `description` (one sharp sentence each), `license: "Apache-2.0"` (matches AI SDK), `repository: { type, url, directory: "packages/<name>" }`, `homepage` (root README anchor for now), `bugs`, `keywords` (["deploy", "deployment", "<provider>", "hosting", "sdk", …]), `sideEffects: false`, `engines: { node: ">=22.12.0" }` (currently root-only), `publishConfig: { access: "public" }`.
- Keep `@deployinfra/sdk` as a regular `workspace:*` dependency in providers (changesets rewrites to a real semver range on publish — same model as `@ai-sdk/*` depending on `@ai-sdk/provider`). A separate spec-only package is a future option, not now.
- Root: add `LICENSE` (Apache-2.0) and copy into each package's `files` so it ships in the tarball.

## Workstream 3 — docs to AI SDK standard

- **Root `README.md`**: hero code sample (the 4-line deploy), provider table with links + auth requirements, the **capability matrix** (dir/zip/zip-url/github per provider, native vs adapted — lift from PLAN.md §capability matrix), install/quickstart, link to guides. This is the storefront; AI SDK's README sells in the first screenful.
- **Per-package `README.md`** (5): short pitch, install, minimal example, full options table (from the JSDoc), provider-specific caveats (Cloudflare undocumented endpoints, Railway "builds what you send — static dirs need a server", Vercel GitHub-app requirement for `gitSource`).
- **`docs/provider-authoring.md`**: the growth lever. Walk through implementing `Provider` end-to-end using Netlify (`packages/netlify/src/provider.ts`) as the reference implementation — exactly the AI SDK's "custom providers + Mistral reference" pattern. Cover: capabilities declaration, `specificationVersion`, using `@deployinfra/sdk/internal` utils, status mapping, error mapping expectations, msw test pattern, and how a future `@deployinfra/aws` would slot in.
- **`CONTRIBUTING.md`**: setup (pnpm/turbo), test/e2e running, changesets flow.

## Workstream 4 — test gaps + e2e materialization

- **Error paths** (audit-identified gaps): provider 401 → `AuthError`; Cloudflare client-side limit enforcement (20k files / 25 MiB) → `ValidationError`; Railway git → archive fallback path; abort-signal propagation through a full `deploy()` (msw + fake timers).
- **e2e scripts**: `e2e/{vercel,netlify,cloudflare,railway}.ts` per the original design — skip with message unless `DEPLOYINFRA_E2E_<PROVIDER>_TOKEN` set, deploy `e2e/fixture-site`, assert `status === 'ready'`, fetch returned `url`, clean up. `e2e/env.ts` helper already exists.

## Workstream 5 — release readiness

1. Verify `deployinfra` npm org (`npm org ls deployinfra` / registry check); fall back to `@anydeploy`/`@unideploy` and rename if taken. **Blocking — do first.**
2. Changesets: configure changelog with GitHub links (`@changesets/changelog-github`), add a changeset declaring 0.1.0 minor for all packages.
3. `pnpm -r exec npm pack --dry-run` audit: dist-only contents, LICENSE + README present, no src leakage.
4. Fresh-project smoke test: `npm init` in scratchpad, install packed tarballs, run the hero example against a `FakeProvider`-style stub (typecheck + import resolution incl. `/internal` subpath, both `import` and `require(esm)`).
5. Release workflow already has provenance/id-token wired — leave as is. Actual `0.1.0` publish is a separate user decision, not part of this plan's execution.

## Order & verification

1. WS5.1 org check (blocks naming) → 2. WS1 API surface → 3. WS2 hygiene → 4. WS4 tests/e2e → 5. WS3 docs (written against the final API) → 6. WS5.2-4 release prep.

Verify: `pnpm build && pnpm typecheck && pnpm test` green after each workstream; pack dry-run audit passes; smoke test project typechecks and runs; README examples are copy-paste-runnable (lint them by executing the hero example file against the stub provider).

Out of scope (unchanged from before): actual npm publish, AWS/GCP/Azure providers, docs website/typedoc HTML (per-package markdown is the v1 bar).
