import type { SourceInput } from '@deployinfra/sdk'
import type { E2eFixture } from './fixture.ts'
import { env } from './env.ts'

export type SemanticSource = 'dir' | 'files' | 'zip' | 'zip-url' | 'github'

export interface SourceCase {
  label: SemanticSource
  make: (fixture: E2eFixture) => SourceInput
}

export function githubConfig(): {
  owner: string
  repo: string
  ref?: string
  url: string
  root?: string
} {
  const owner = env('DEPLOYINFRA_E2E_GITHUB_OWNER') ?? 'NWylynko'
  const repo = env('DEPLOYINFRA_E2E_GITHUB_REPO') ?? 'deployinfra-e2e-fixture'
  const ref = env('DEPLOYINFRA_E2E_GITHUB_REF')
  const root = env('DEPLOYINFRA_E2E_GITHUB_ROOT')
  const url = ref
    ? `https://github.com/${owner}/${repo}/tree/${ref}`
    : `https://github.com/${owner}/${repo}`
  return { owner, repo, ref, url, root }
}

export function semanticSources(): SourceCase[] {
  const gh = githubConfig()
  return [
    {
      label: 'dir',
      make: (f) => f.dirPath,
    },
    {
      label: 'files',
      make: (f) => ({ kind: 'files', files: f.files }),
    },
    {
      label: 'zip',
      make: (f) => f.zipPath,
    },
    {
      label: 'zip-url',
      make: (f) => f.zipUrl,
    },
    {
      label: 'github',
      make: () => ({
        kind: 'github',
        owner: gh.owner,
        repo: gh.repo,
        ref: gh.ref,
      }),
    },
  ]
}

export function smokeSources(): SourceCase[] {
  return semanticSources().filter((s) => s.label === 'files')
}
