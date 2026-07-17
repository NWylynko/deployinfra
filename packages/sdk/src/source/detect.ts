import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import { SourceError } from '../errors.js'
import type { SourceDescriptor, SourceInput } from '../types.js'
import { parseGitHubInput } from './github.js'

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/**
 * Normalize a SourceInput into an explicit SourceDescriptor.
 *
 * Detection order for strings:
 * 1. github.com URL → github
 * 2. URL ending in .zip → zip-url
 * 3. existing local path → dir / zip / tar by stat + extension
 * 4. owner/repo shorthand (not on disk) → github
 * 5. ambiguous → SourceError
 */
export async function detect(input: SourceInput): Promise<SourceDescriptor> {
  if (typeof input !== 'string') {
    return input
  }

  const trimmed = input.trim()
  if (!trimmed) {
    throw new SourceError('Source input is empty')
  }

  // 1. github.com URL
  if (/^https?:\/\/(?:www\.)?github\.com\//i.test(trimmed)) {
    const parsed = parseGitHubInput(trimmed)
    if (!parsed) {
      throw new SourceError(`Could not parse GitHub URL: ${trimmed}`)
    }
    return { kind: 'github', host: 'github', ...parsed }
  }

  // 2. URL ending in .zip
  if (/^https?:\/\//i.test(trimmed)) {
    const withoutQuery = trimmed.split(/[?#]/)[0]!
    if (withoutQuery.toLowerCase().endsWith('.zip')) {
      return { kind: 'zip-url', url: trimmed }
    }
    throw new SourceError(
      `Unsupported URL source: ${trimmed}. Pass an explicit descriptor (e.g. { kind: 'zip-url', url }) or a github.com / .zip URL.`,
    )
  }

  // 3. existing local path
  const resolved = path.resolve(trimmed)
  if (await exists(resolved)) {
    const info = await stat(resolved)
    if (info.isDirectory()) {
      return { kind: 'dir', path: resolved }
    }
    if (info.isFile()) {
      const ext = path.extname(resolved).toLowerCase()
      if (ext === '.zip') return { kind: 'zip', path: resolved }
      if (ext === '.tar' || ext === '.tgz' || resolved.endsWith('.tar.gz')) {
        return { kind: 'tar', path: resolved }
      }
      throw new SourceError(
        `Ambiguous file source: ${trimmed}. Pass { kind: 'zip' | 'tar', path } explicitly.`,
      )
    }
  }

  // 4. owner/repo[@ref] shorthand (exactly two path segments, not a filesystem path)
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:@[^\s/\\]+)?$/.test(trimmed)) {
    const gh = parseGitHubInput(trimmed)
    if (gh) {
      return { kind: 'github', host: 'github', ...gh }
    }
  }

  // 5. ambiguous
  throw new SourceError(
    `Could not detect source type for: ${trimmed}. Pass an explicit descriptor ({ kind: 'dir' | 'zip' | 'zip-url' | 'github' | 'files', ... }).`,
  )
}
