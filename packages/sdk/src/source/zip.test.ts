import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { collectFiles, fromZipBytes } from './zip.js'
import { stripGithubRoot } from './github.js'
import { fromFiles } from './files.js'

describe('zip', () => {
  it('round-trips files through zip', async () => {
    const zipped = zipSync({
      'index.html': new TextEncoder().encode('<h1>hi</h1>'),
      'assets/app.js': new TextEncoder().encode('console.log(1)'),
    })

    const source = fromZipBytes(zipped)
    const files = await collectFiles(source)

    expect(Object.keys(files).sort()).toEqual(['assets/app.js', 'index.html'])
    expect(new TextDecoder().decode(files['index.html'])).toBe('<h1>hi</h1>')
    expect(source.zipBytes).toBeTypeOf('function')
    await expect(source.zipBytes!()).resolves.toEqual(zipped)
  })
})

describe('fromFiles', () => {
  it('normalizes paths and encodes strings', async () => {
    const source = fromFiles({
      '/index.html': '<h1>x</h1>',
      'bin.dat': new Uint8Array([1, 2, 3]),
    })
    expect(await source.count()).toBe(2)
    const files = await collectFiles(source)
    expect(files['index.html']).toEqual(new TextEncoder().encode('<h1>x</h1>'))
    expect(files['bin.dat']).toEqual(new Uint8Array([1, 2, 3]))
  })
})

describe('stripGithubRoot', () => {
  it('strips the single top-level directory', () => {
    const input = {
      'acme-site-abc123/index.html': new Uint8Array([1]),
      'acme-site-abc123/css/app.css': new Uint8Array([2]),
    }
    const out = stripGithubRoot(input)
    expect(Object.keys(out).sort()).toEqual(['css/app.css', 'index.html'])
  })

  it('leaves multi-root archives alone', () => {
    const input = {
      'a/x': new Uint8Array([1]),
      'b/y': new Uint8Array([2]),
    }
    expect(stripGithubRoot(input)).toEqual(input)
  })
})
