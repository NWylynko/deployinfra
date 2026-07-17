import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'
import { MARKER } from './env.ts'

const SITE_ROOT = fileURLToPath(new URL('../fixtures/site', import.meta.url))

export interface E2eFixture {
  dirPath: string
  zipPath: string
  zipUrl: string
  zipBytes: Uint8Array
  files: Record<string, string>
  close(): Promise<void>
}

export async function createFixture(): Promise<E2eFixture> {
  const dirPath = await mkdtemp(join(tmpdir(), 'deployinfra-e2e-'))
  await cp(SITE_ROOT, dirPath, { recursive: true })

  const indexHtml = await readFile(join(dirPath, 'index.html'), 'utf8')
  if (!indexHtml.includes(MARKER)) {
    throw new Error(`Fixture missing marker ${MARKER}`)
  }

  const files: Record<string, string> = {
    'index.html': indexHtml,
    'package.json': await readFile(join(dirPath, 'package.json'), 'utf8'),
    'server.mjs': await readFile(join(dirPath, 'server.mjs'), 'utf8'),
  }

  const zipBytes = zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, content]) => [
        path,
        new TextEncoder().encode(content),
      ]),
    ),
  )
  const zipPath = join(dirPath, 'site.zip')
  await writeFile(zipPath, zipBytes)

  const server: Server = createServer((req, res) => {
    if (req.url?.split('?')[0] === '/site.zip') {
      res.writeHead(200, {
        'content-type': 'application/zip',
        'content-length': zipBytes.byteLength,
      })
      res.end(Buffer.from(zipBytes))
      return
    }
    res.writeHead(404)
    res.end('not found')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind local zip fixture server')
  }
  const zipUrl = `http://127.0.0.1:${address.port}/site.zip`

  return {
    dirPath,
    zipPath,
    zipUrl,
    zipBytes,
    files,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(dirPath, { recursive: true, force: true })
    },
  }
}
