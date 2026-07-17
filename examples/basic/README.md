# DeployInfra example

This example deploys `site/` through any implemented provider.

1. Install and build from the repository root:

   ```sh
   pnpm install
   pnpm build
   ```

2. Create the example environment file:

   ```sh
   cp examples/basic/.env.example examples/basic/.env
   ```

3. Add credentials for one provider, then run:

   ```sh
   pnpm example -- vercel
   # or: netlify, cloudflare, railway
   ```

You can also set `DEPLOY_PROVIDER` in `.env` and run `pnpm example` without
an argument. The example prints each normalized deployment status and the
final URL.

Set `DEPLOY_NAME` to pass `deploy({ name })` for any provider. The
provider-specific `VERCEL_PROJECT_NAME`, `NETLIFY_SITE_NAME`, and
`CLOUDFLARE_PROJECT_NAME` variables are fallback names; when none is set,
DeployInfra generates a name.

Railway uses `site/server.mjs` as a minimal web server. The other providers
serve `site/index.html` as a static asset.
