import { blake3 } from '@noble/hashes/blake3.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import path from 'node:path'

/**
 * Cloudflare Pages asset hash (wrangler-compatible):
 * blake3(base64(contents) + ext_without_dot) → first 32 hex chars.
 */
export function hashPagesAsset(contents: Uint8Array, filePath: string): string {
  const base64 = Buffer.from(contents).toString('base64')
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase()
  const input = new TextEncoder().encode(base64 + ext)
  return bytesToHex(blake3(input)).slice(0, 32)
}

/** Minimal content-type guess from extension (wrangler-style). */
export function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.html':
    case '.htm':
      return 'text/html'
    case '.css':
      return 'text/css'
    case '.js':
    case '.mjs':
      return 'application/javascript'
    case '.json':
      return 'application/json'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    case '.txt':
      return 'text/plain'
    case '.xml':
      return 'application/xml'
    case '.wasm':
      return 'application/wasm'
    default:
      return 'application/octet-stream'
  }
}
