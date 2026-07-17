# Add AWS, GCP (Firebase Hosting) and Azure providers to DeployKit

## Context

DeployKit (`/Users/nick/dev/deploy-sdk`) is complete for Vercel/Netlify/Cloudflare/Railway, polished to publishable standard, with a stable `Provider` v1 contract (`packages/core/src/provider.ts`), an `/internal` toolkit, and a provider-authoring guide (`docs/provider-authoring.md`) whose recipe these three new packages follow exactly. **No core changes are required** — this is three new workspace packages plus docs/e2e wiring.

Service targets (researched against current docs, July 2026; user delegated the per-cloud choice to research):
- **AWS → Amplify Hosting manual deploys** (verified). S3+CloudFront rejected: minutes-long distribution provisioning, no deployment/job object to poll.
- **GCP → Firebase Hosting REST API** (v1beta1; ⚠ firebase.google.com was unreachable during research — flow below is from stable prior knowledge, re-verify as the first task of that milestone). Cloud Run rejected: needs a container or Cloud Build "source deploy" — violates our no-build constraint.
- **Azure → App Service zip deploy (Kudu/OneDeploy)** (verified). Static Web Apps rejected: still no plain-HTTP upload path — the SWA CLI/Action delegate to the closed-source `StaticSitesClient` binary, and the only REST op takes a URL to an already-hosted zip. Document this limitation in the Azure README.

Auth: **official SDK clients** (user decision) — `@aws-sdk/client-amplify`, `google-auth-library` (token acquisition only), `@azure/identity` (Entra tokens only). This buys credential-chain support for free (env vars / shared config / ADC / workload identity / IMDS). REST calls outside the AWS SDK still go through `request`/`mapHttpError` from `@deploykit/core/internal`.

Package names: `@deploykit/aws`, `@deploykit/firebase`, `@deploykit/azure`. "firebase" over "gcp" follows the product-named `@deploykit/cloudflare` precedent (the surface is Firebase Hosting specifically); rename to `gcp` is trivial if you prefer cloud symmetry.

## Cross-cutting decisions

- `capabilities.sources.git: false` for all three (no turnkey git APIs) — core already materializes GitHub → files.
- `zipPassthrough: true` for AWS and Azure (both consume whole zips); not Firebase (per-file hash protocol). AWS/Azure add `fflate` to zip a `FilesSource` when `zipBytes()` is absent.
- Layout per authoring guide: `src/{index,provider,api,status}.ts` + `provider.test.ts` (+ `auth.ts` where needed), package.json cloned from `packages/cloudflare/package.json` (ESM-only, sideEffects:false, node >=22.12), README, LICENSE. Closure-held project state like `packages/cloudflare/src/provider.ts`; auto-create pattern like `packages/netlify/src/provider.ts`.

## M1 — `@deploykit/aws` (Amplify Hosting; fully doc-verified)

Factory `aws({ region, credentials?, appId?, appName?, branchName? })` — `credentials` optional; the SDK's default chain resolves env/config/IMDS. Deps: `@deploykit/core`, `@aws-sdk/client-amplify`, `fflate`.

Deploy flow (all via AmplifyClient commands):
1. Ensure app: `GetApp` if `appId` set (cache `defaultDomain` = `{appId}.amplifyapp.com`), else `CreateApp { name, platform: 'WEB' }`. ⚠ API docs ambiguously say access/oauth token required — the manual-deploys guide says otherwise; confirm in e2e.
2. Ensure branch: `GetBranch`, on not-found `CreateBranch { branchName: 'main' default, stage: 'PRODUCTION' }`.
3. Zip path (`zipBytes()` or fflate): `CreateDeployment` (no fileMap) → plain-fetch `PUT` zip to `zipUploadUrl` (presigned, no auth). File path: `fileMap {path: md5hex}` → `CreateDeployment { fileMap }` → `PUT` each to `fileUploadUrls[path]` with `mapPool` (8).
4. `StartDeployment { jobId }` → result `{ deploymentId: jobId, url: https://{branch}.{defaultDomain}, projectId: appId }`.
5. `getDeployment` = `GetJob`; status map: CREATED/PENDING/PROVISIONING→queued, RUNNING→deploying, SUCCEED→ready, FAILED→error, CANCELLING/CANCELLED→canceled, unknown→deploying. Map SDK exceptions (`UnauthorizedException`→AuthError, `LimitExceededException`→RateLimitError) in api.ts.

Tests: `aws-sdk-client-mock` for Amplify commands (assert inputs: platform, fileMap md5s, jobId) + msw for the presigned PUT (assert `PK` magic, no auth header) + `createDeployer` poll RUNNING→SUCCEED. e2e/aws.ts gated on `DEPLOYKIT_E2E_AWS_*`. Risks to document: 5 GB zip cap, zip must have site at root (Amplify "Access Denied" footgun), 8h create→start window.

## M2 — `@deploykit/firebase` (Firebase Hosting)

**First task: re-verify the v1beta1 API against live docs** (unreachable during planning): populateFiles hash semantics, upload endpoint, version naming, release synchronicity.

Factory `firebase({ serviceAccount?, projectId?, siteId? })` — auth via `google-auth-library` (`GoogleAuth` with scope `https://www.googleapis.com/auth/cloud-platform`; supports ADC when `serviceAccount` omitted). Deps: `@deploykit/core`, `google-auth-library`. REST via core `request` + bearer token.

Deploy flow: ensure site (`GET /v1beta1/projects/{p}/sites/{siteId}`; 404 + non-default id → create site; 404 on default site → descriptive `ValidationError`: "enable Firebase Hosting on the project") → `POST .../sites/{s}/versions` → gzip each file (`node:zlib`) + sha256 hex **of the gzipped bytes** → `:populateFiles {files: {"/path": hash}}` → upload only `uploadRequiredHashes` to the returned `uploadUrl/{hash}` via `mapPool` → `PATCH version ?update_mask=status` `FINALIZED` → `POST releases?versionName=…`. Release is synchronous → `deploy()` returns `status: 'ready'`, `deploymentId` = full version name, `url: https://{siteId}.web.app`, `aliases: [firebaseapp.com]`; core's ready-poll confirms on first tick. Version-status map: CREATED→deploying, FINALIZED→ready, DELETED/ABANDONED→canceled, EXPIRED→error. Optional `deleteDeployment` = version delete (cannot un-release; note in JSDoc).

Tests: msw on `firebasehosting.googleapis.com` (recompute sha256-of-gzip in test, assert map; return subset as required hashes), upload host (assert gzip magic `1f 8b`), finalize + release; stub token via injected `accessToken`/mocked GoogleAuth. e2e/firebase.ts gated on `DEPLOYKIT_E2E_FIREBASE_SERVICE_ACCOUNT`.

## M3 — `@deploykit/azure` (App Service zip deploy)

**First task: verify OneDeploy async semantics** (`async=true` vs `isAsync=true`, Location header shape, Kudu status ints) against a throwaway app; legacy `/api/zipdeploy?isAsync=true` is the fallback.

Factory `azure({ appName, credentials, scmHost?, appUrl?, slot? })` — `credentials` = `{ kind: 'publishProfile', username, password }` (basic auth, hand-built header) or `{ kind: 'entra', tenantId, clientId, clientSecret }` via `@azure/identity` `ClientSecretCredential` (scope `https://management.azure.com/.default`); also accept any `TokenCredential` (so users can pass `DefaultAzureCredential`). **Requires a pre-existing web app** — no ARM provisioning (resource group + plan + SKU decisions are a billing footgun; document `az webapp up` as prerequisite). Deps: `@deploykit/core`, `@azure/identity`, `fflate`.

Deploy flow: zip (`zipBytes()` or fflate) → `POST https://{app}.scm.azurewebsites.net/api/publish?type=zip&async=true`, `Content-Type: application/zip` → 202 + `Location` → parse deployment id → return `status: 'deploying'`, `url: appUrl ?? https://{appName}.azurewebsites.net`. `getDeployment` = `GET {scm}/api/deployments/{id}`; Kudu status map: 0→queued, 1→building, 2→deploying, 4→ready, 3→error, `complete:false`/unknown→deploying. Error mapping: 401/403 → `AuthError` hinting "SCM basic auth may be disabled — use Entra credentials"; 409 → `ProviderError` with run-from-package/in-progress remediation.

Risks to document in README: new apps get unique default hostnames (hence `appUrl` option; publish profile carries `destinationAppUrl`), `WEBSITE_RUN_FROM_PACKAGE=1` rejects zipdeploy, SCM cold-start 503s, 2 GB limit, Linux stacks need a static-capable runtime, and the SWA limitation note.

Tests: msw on `login.microsoftonline.com` token endpoint is unnecessary (mock the credential object instead); msw on `*.scm.azurewebsites.net` publish (assert query params, auth header per mode, `PK` magic; 202 + Location) and deployments status sequence 2→4; failure test 3→error. e2e/azure.ts gated on `DEPLOYKIT_E2E_AZURE_*` (either credential mode).

## M4 — docs + release wiring

- Root `README.md`: three new rows in the provider table + capability matrix columns; SWA note on the Azure row.
- `docs/provider-authoring.md`: update only the final "Slotting in @deploykit/aws (future)" section — it's now real.
- `CONTRIBUTING.md` e2e env table; root `package.json` `e2e:aws|firebase|azure` scripts; three changesets (minor).

## Verification

Per milestone: `pnpm build && pnpm typecheck && pnpm test` green; new package's msw suite passes; `npm pack --dry-run` audit (metadata pattern matches existing packages). Live: run `e2e/<provider>.ts` with real credentials — deploy `e2e/fixture-site`, assert `status === 'ready'`, fetch the returned URL for fixture content. The two verification spikes (Firebase API details, Kudu async semantics) happen before their milestone's implementation, not after.

## Flagged uncertainties (verify, don't assume)

1. All Firebase v1beta1 details (docs unreachable during research).
2. Kudu OneDeploy async param + status-int enum.
3. Amplify `CreateApp` without repo tokens (doc language conflicts with the manual-deploys guide).
