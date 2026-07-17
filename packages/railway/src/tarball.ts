import { createTarGzip } from 'nanotar'
import type { FilesSource } from '@deployinfra/sdk'

/** Build a gzipped tarball from a FilesSource (railway up format). */
export async function createTarball(source: FilesSource): Promise<Uint8Array> {
  const files: Array<{ name: string; data: Uint8Array }> = []
  for await (const file of source.files()) {
    files.push({ name: file.path, data: await file.read() })
  }
  return createTarGzip(files)
}
