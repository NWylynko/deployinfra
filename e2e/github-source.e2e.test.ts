import { describe, expect, it } from 'vitest'
import { SourceError } from '@deployinfra/sdk'
import { resolve, stripGithubRoot } from '@deployinfra/sdk/internal'
import { env } from './helpers/env.ts'
import { githubConfig } from './helpers/sources.ts'

describe('e2e GitHub source behavior', () => {
  it('materializes a public fixture and strips the zipball root', async () => {
    const gh = githubConfig()
    const source = await resolve({
      kind: 'github',
      owner: gh.owner,
      repo: gh.repo,
      ref: gh.ref,
    })
    expect(source.kind).toBe('git')
    if (source.kind !== 'git') return

    let files
    try {
      files = await source.materialize()
    } catch (err) {
      if (err instanceof SourceError) {
        console.log(
          `skip materialize: could not download ${gh.owner}/${gh.repo}` +
            ` — create a public fixture repo or set DEPLOYINFRA_E2E_GITHUB_*`,
        )
        return
      }
      throw err
    }

    const map: Record<string, Uint8Array> = {}
    for await (const file of files.files()) {
      map[file.path] = await file.read()
    }

    const top = new Set(Object.keys(map).map((p) => p.split('/')[0]!))
    expect(top.size).toBeGreaterThan(0)
    expect([...top].some((t) => t.includes(`${gh.repo}-`))).toBe(false)

    const root = gh.root ?? env('DEPLOYINFRA_E2E_GITHUB_ROOT')
    if (root) {
      const prefixed = Object.keys(map).filter((p) => p.startsWith(`${root}/`))
      expect(prefixed.length).toBeGreaterThan(0)
      // Public API has no way to strip this root — materialize keeps prefixes.
      expect(map['index.html']).toBeUndefined()
    } else if (Object.keys(map).length > 0) {
      // Prefer the DeployInfra fixture marker when present.
      const hasMarker = Object.values(map).some((bytes) =>
        new TextDecoder().decode(bytes).includes('deployinfra-ok'),
      )
      expect(hasMarker || map['README.md'] || map['index.html']).toBeTruthy()
    }
  }, 120_000)

  it('stripGithubRoot only removes a single shared top folder', () => {
    const input = {
      'acme-site-abc1234/index.html': new TextEncoder().encode('ok'),
      'acme-site-abc1234/assets/a.js': new TextEncoder().encode('js'),
    }
    const out = stripGithubRoot(input)
    expect(Object.keys(out).sort()).toEqual(['assets/a.js', 'index.html'])
  })
})
