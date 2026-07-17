import { SourceError } from '../errors.js'
import type { ResolvedSource, SourceDescriptor } from '../types.js'
import { fromDir } from './dir.js'
import { fromFiles } from './files.js'
import { createGitHubSource } from './github.js'
import { fromZipFile, fromZipUrl } from './zip.js'

export interface ResolveOptions {
  signal?: AbortSignal
}

/** Resolve a descriptor into FilesSource | GitRemoteSource. */
export async function resolve(
  descriptor: SourceDescriptor,
  options: ResolveOptions = {},
): Promise<ResolvedSource> {
  switch (descriptor.kind) {
    case 'dir':
      return fromDir(descriptor.path)
    case 'zip':
      return fromZipFile(descriptor.path)
    case 'zip-url':
      return fromZipUrl(descriptor.url, options.signal)
    case 'files':
      return fromFiles(descriptor.files)
    case 'github':
      return createGitHubSource({
        owner: descriptor.owner,
        repo: descriptor.repo,
        ref: descriptor.ref,
        host: descriptor.host,
      })
    case 'tar':
      throw new SourceError(
        'Tar sources are not yet supported in core resolution; use a directory, zip, or files map.',
      )
    default: {
      const _exhaustive: never = descriptor
      throw new SourceError(`Unknown source kind: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
