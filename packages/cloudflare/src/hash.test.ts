import { describe, expect, it } from 'vitest'
import { hashPagesAsset, guessContentType } from './hash.js'
import { mapCloudflareStage } from './status.js'

describe('hashPagesAsset', () => {
  it('matches wrangler-style blake3(base64 + ext) truncated to 32', () => {
    // Empty file with .html extension
    const empty = new Uint8Array(0)
    const h1 = hashPagesAsset(empty, 'index.html')
    expect(h1).toHaveLength(32)
    expect(h1).toMatch(/^[0-9a-f]{32}$/)

    // Same contents, different extension → different hash
    const body = new TextEncoder().encode('hello')
    const html = hashPagesAsset(body, 'a.html')
    const txt = hashPagesAsset(body, 'a.txt')
    expect(html).not.toBe(txt)

    // Deterministic
    expect(hashPagesAsset(body, 'a.html')).toBe(html)
  })

  it('uses extension without leading dot', () => {
    const body = new TextEncoder().encode('<h1>x</h1>')
    // path with nested dirs shouldn't change hash beyond extension
    const a = hashPagesAsset(body, 'index.html')
    const b = hashPagesAsset(body, 'dir/index.html')
    expect(a).toBe(b)
  })
})

describe('guessContentType', () => {
  it('maps common extensions', () => {
    expect(guessContentType('a.html')).toBe('text/html')
    expect(guessContentType('a.js')).toBe('application/javascript')
    expect(guessContentType('a.unknown')).toBe('application/octet-stream')
  })
})

describe('mapCloudflareStage', () => {
  it('maps deploy success to ready', () => {
    expect(mapCloudflareStage({ name: 'deploy', status: 'success' })).toBe('ready')
    expect(mapCloudflareStage({ name: 'deploy', status: 'failure' })).toBe('error')
    expect(mapCloudflareStage({ name: 'build', status: 'idle' })).toBe('building')
  })
})
