import { SourceError } from '../errors.js'
import type { FilesSource, GitRemoteSource } from '../types.js'
import { fromFiles } from './files.js'
import { fromZipBytes } from './zip.js'

const CODELOAD = 'https://codeload.github.com'

/**
 * Strip the single top-level directory GitHub zipballs wrap files in
 * (e.g. `owner-repo-abc1234/README.md` → `README.md`).
 */
export function stripGithubRoot(files: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const keys = Object.keys(files)
  if (keys.length === 0) return files

  const roots = new Set(keys.map((k) => k.split('/')[0]!))
  if (roots.size !== 1) return files

  const root = [...roots][0]!
  const allUnder = keys.every((k) => k === root || k.startsWith(`${root}/`))
  if (!allUnder) return files

  const out: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(files)) {
    if (k === root) continue
    const stripped = k.slice(root.length + 1)
    if (stripped) out[stripped] = v
  }
  return out
}

export function createGitHubSource(opts: {
  owner: string
  repo: string
  ref?: string
  host?: 'github'
}): GitRemoteSource {
  const { owner, repo, ref } = opts
  return {
    kind: 'git',
    host: 'github',
    owner,
    repo,
    ref,
    async materialize(): Promise<FilesSource> {
      const spec = ref ?? 'HEAD'
      const url = `${CODELOAD}/${owner}/${repo}/zip/${encodeURIComponent(spec)}`
      const res = await fetch(url)
      if (!res.ok) {
        throw new SourceError(
          `Failed to download GitHub archive for ${owner}/${repo}@${spec}: HTTP ${res.status}`,
        )
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      const expanded = fromZipBytes(bytes)
      const files: Record<string, Uint8Array> = {}
      for await (const file of expanded.files()) {
        files[file.path] = await file.read()
      }
      return fromFiles(stripGithubRoot(files))
    },
  }
}

/** Parse github.com URLs or `owner/repo[@ref]` shorthand. */
export function parseGitHubInput(input: string): {
  owner: string
  repo: string
  ref?: string
} | null {
  const trimmed = input.trim()

  const urlMatch = trimmed.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/(?:tree|blob|commits)\/([^/#?]+))?\/?(?:[?#].*)?$/i,
  )
  if (urlMatch) {
    return {
      owner: urlMatch[1]!,
      repo: urlMatch[2]!.replace(/\.git$/i, ''),
      ref: urlMatch[3],
    }
  }

  const short = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:@([^/\s]+))?$/)
  if (short) {
    return { owner: short[1]!, repo: short[2]!, ref: short[3] }
  }

  return null
}
