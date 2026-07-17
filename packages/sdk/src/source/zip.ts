import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { SourceError } from '../errors.js'
import type { FilesSource, SourceFile } from '../types.js'
import { fromFiles } from './files.js'

function unzipToMap(bytes: Uint8Array): Record<string, Uint8Array> {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch (err) {
    throw new SourceError('Failed to unzip archive', { cause: err })
  }

  const files: Record<string, Uint8Array> = {}
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue
    const normalized = name.replace(/^\//, '')
    files[normalized] = data
  }
  return files
}

/** Expand zip bytes into a FilesSource; retains zipBytes for passthrough. */
export function fromZipBytes(bytes: Uint8Array): FilesSource {
  const map = unzipToMap(bytes)
  const source = fromFiles(map)
  return {
    ...source,
    zipBytes: async () => bytes,
  }
}

/** Read a local zip file and expand it. */
export async function fromZipFile(filePath: string): Promise<FilesSource> {
  const buf = await readFile(filePath)
  return fromZipBytes(new Uint8Array(buf))
}

/** Fetch a remote zip URL and expand it. */
export async function fromZipUrl(
  url: string,
  signal?: AbortSignal,
): Promise<FilesSource> {
  const res = await fetch(url, { signal })
  if (!res.ok) {
    throw new SourceError(`Failed to download zip: HTTP ${res.status} from ${url}`)
  }
  const buf = new Uint8Array(await res.arrayBuffer())
  return fromZipBytes(buf)
}

/** Collect all files from a FilesSource into a path→bytes map (for tests / re-pack). */
export async function collectFiles(
  source: FilesSource,
): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {}
  for await (const file of source.files()) {
    out[file.path] = await file.read()
  }
  return out
}

export type { SourceFile }
