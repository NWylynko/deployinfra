#!/usr/bin/env bash
set -euo pipefail
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT
ROOT=/Users/nick/dev/deploy-sdk
cd "$ROOT/packages/sdk"
npm pack --silent
mv deployinfra-sdk-0.0.0.tgz "$SCRATCH/"
cd "$SCRATCH"
npm init -y >/dev/null
npm pkg set type=module
npm install ./deployinfra-sdk-0.0.0.tgz

cat > smoke.mjs << 'EOF'
import { createDeployer } from '@deployinfra/sdk'
import { mapPool, sha1 } from '@deployinfra/sdk/internal'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const coreCjs = require('@deployinfra/sdk')
const internalCjs = require('@deployinfra/sdk/internal')

const fake = {
  specificationVersion: 'v1',
  name: 'fake',
  capabilities: { sources: { files: true, git: false } },
  async deploy() {
    return { provider: 'fake', deploymentId: 'd1', status: 'ready', url: 'https://fake.example', raw: {} }
  },
  async getDeployment(id) {
    return { provider: 'fake', deploymentId: id, status: 'ready', url: 'https://fake.example', raw: {} }
  },
}

const deployer = createDeployer({ provider: fake })
const result = await deployer.deploy({ kind: 'files', files: { 'index.html': '<h1>ok</h1>' } })
if (result.status !== 'ready') throw new Error('deploy failed')
if (typeof sha1('x') !== 'string') throw new Error('sha1 missing')
await mapPool([1, 2], 2, async () => {})
if (typeof coreCjs.createDeployer !== 'function') throw new Error('cjs createDeployer')
if (typeof internalCjs.sha1 !== 'function') throw new Error('cjs internal')
console.log('smoke ok', result.url)
EOF

node smoke.mjs

cat > smoke.ts << 'EOF'
import { createDeployer, type Provider } from '@deployinfra/sdk'
import { sha1 } from '@deployinfra/sdk/internal'

const provider: Provider = {
  specificationVersion: 'v1',
  name: 'fake',
  capabilities: { sources: { files: true, git: false } },
  async deploy() {
    return { provider: 'fake', deploymentId: 'd1', status: 'ready', url: 'https://t', raw: {} }
  },
  async getDeployment(id: string) {
    return { provider: 'fake', deploymentId: id, status: 'ready', raw: {} }
  },
}

const deployer = createDeployer({ provider })
const digest: string = sha1('hi')
void deployer
void digest
EOF

npm install --no-save typescript@5.9.3 >/dev/null
./node_modules/.bin/tsc --strict --module nodenext --moduleResolution nodenext --target es2022 --noEmit smoke.ts
echo ALL_OK
