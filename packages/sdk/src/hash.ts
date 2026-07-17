import { createHash } from 'node:crypto'

/** SHA-1 hex digest of bytes (used by Vercel / Netlify file digests). */
export function sha1(data: Uint8Array | string): string {
  return createHash('sha1').update(data).digest('hex')
}

/** SHA-256 hex digest. */
export function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}
