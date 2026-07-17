import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { FilesSource, SourceFile } from '../types.js'

async function walk(dir: string, base: string = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(full, base)))
    } else if (entry.isFile()) {
      files.push(path.relative(base, full).split(path.sep).join('/'))
    }
  }
  return files
}

/** Resolve a local directory into a lazy FilesSource. */
export async function fromDir(dirPath: string): Promise<FilesSource> {
  const absolute = path.resolve(dirPath)
  const info = await stat(absolute)
  if (!info.isDirectory()) {
    throw new Error(`Not a directory: ${dirPath}`)
  }

  let cached: string[] | undefined
  const list = async () => {
    cached ??= await walk(absolute)
    return cached
  }

  return {
    kind: 'files',
    async count() {
      return (await list()).length
    },
    async *files(): AsyncIterable<SourceFile> {
      for (const rel of await list()) {
        const full = path.join(absolute, rel)
        const { size } = await stat(full)
        yield {
          path: rel.startsWith('/') ? rel.slice(1) : rel,
          size,
          async read() {
            const { readFile } = await import('node:fs/promises')
            const buf = await readFile(full)
            return new Uint8Array(buf)
          },
        }
      }
    },
  }
}
