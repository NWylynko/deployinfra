import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { detect } from './detect.js'
import { SourceError } from '../errors.js'

describe('detect', () => {
  it('detects github.com URLs', async () => {
    await expect(detect('https://github.com/acme/site')).resolves.toEqual({
      kind: 'github',
      host: 'github',
      owner: 'acme',
      repo: 'site',
      ref: undefined,
    })

    await expect(
      detect('https://github.com/acme/site/tree/main'),
    ).resolves.toMatchObject({
      kind: 'github',
      owner: 'acme',
      repo: 'site',
      ref: 'main',
    })
  })

  it('detects zip URLs', async () => {
    await expect(
      detect('https://example.com/artifacts/app.zip?token=1'),
    ).resolves.toEqual({
      kind: 'zip-url',
      url: 'https://example.com/artifacts/app.zip?token=1',
    })
  })

  it('detects local directories and zip files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'deployinfra-'))
    const zipPath = path.join(dir, 'site.zip')
    await writeFile(zipPath, 'PK fake')

    await expect(detect(dir)).resolves.toEqual({ kind: 'dir', path: dir })
    await expect(detect(zipPath)).resolves.toEqual({ kind: 'zip', path: zipPath })
  })

  it('detects owner/repo shorthand', async () => {
    await expect(detect('vercel/next.js')).resolves.toEqual({
      kind: 'github',
      host: 'github',
      owner: 'vercel',
      repo: 'next.js',
      ref: undefined,
    })
    await expect(detect('acme/site@v1')).resolves.toMatchObject({
      kind: 'github',
      owner: 'acme',
      repo: 'site',
      ref: 'v1',
    })
  })

  it('passes through explicit descriptors', async () => {
    const desc = { kind: 'files' as const, files: { 'index.html': '<h1>hi</h1>' } }
    await expect(detect(desc)).resolves.toBe(desc)
  })

  it('throws SourceError for ambiguous inputs', async () => {
    await expect(detect('not a source')).rejects.toBeInstanceOf(SourceError)
    await expect(detect('https://example.com/page')).rejects.toBeInstanceOf(SourceError)
  })

  it('detects tar by extension', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'deployinfra-'))
    const tarPath = path.join(dir, 'bundle.tar.gz')
    await writeFile(tarPath, 'fake')
    await expect(detect(tarPath)).resolves.toEqual({ kind: 'tar', path: tarPath })
  })

  it('rejects empty string', async () => {
    await expect(detect('  ')).rejects.toBeInstanceOf(SourceError)
  })
})
