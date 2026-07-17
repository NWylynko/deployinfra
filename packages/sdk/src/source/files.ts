import type { FilesMap, FilesSource, SourceFile } from '../types.js'

function toBytes(value: string | Uint8Array): Uint8Array {
  if (typeof value === 'string') {
    return new TextEncoder().encode(value)
  }
  return value
}

/** Build a FilesSource from an in-memory path → contents map. */
export function fromFiles(files: FilesMap): FilesSource {
  const entries = Object.entries(files).map(([p, contents]) => {
    const normalized = p.replace(/^\//, '')
    const bytes = toBytes(contents)
    return { path: normalized, bytes }
  })

  return {
    kind: 'files',
    async count() {
      return entries.length
    },
    async *files(): AsyncIterable<SourceFile> {
      for (const entry of entries) {
        yield {
          path: entry.path,
          size: entry.bytes.byteLength,
          async read() {
            return entry.bytes
          },
        }
      }
    },
  }
}
