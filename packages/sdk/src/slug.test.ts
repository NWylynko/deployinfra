import { describe, expect, it } from 'vitest'
import { generateDeploySlug } from './slug.js'

describe('generateDeploySlug', () => {
  it('returns three dashed lowercase words', () => {
    const slug = generateDeploySlug()
    expect(slug).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/)
  })

  it('produces varying values', () => {
    const set = new Set(Array.from({ length: 20 }, () => generateDeploySlug()))
    expect(set.size).toBeGreaterThan(1)
  })
})
