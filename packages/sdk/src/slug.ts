import { randomInt } from 'node:crypto'

const ADJECTIVES = [
  'amber',
  'brisk',
  'calm',
  'clever',
  'crisp',
  'daring',
  'eager',
  'gentle',
  'golden',
  'happy',
  'keen',
  'lively',
  'lucky',
  'mighty',
  'noble',
  'plucky',
  'quick',
  'quiet',
  'rapid',
  'shiny',
  'silent',
  'swift',
  'tidy',
  'vivid',
  'wild',
] as const

const NOUNS = [
  'aurora',
  'brook',
  'cedar',
  'comet',
  'ember',
  'falcon',
  'forest',
  'glacier',
  'harbor',
  'island',
  'meadow',
  'nebula',
  'ocean',
  'orchid',
  'pine',
  'river',
  'sable',
  'sparrow',
  'summit',
  'tide',
  'valley',
  'willow',
  'zephyr',
] as const

function pick<T extends readonly string[]>(words: T): T[number] {
  return words[randomInt(words.length)]!
}

/**
 * Generate a random dashed slug for a new deployment
 * (e.g. `swift-river-falcon`).
 */
export function generateDeploySlug(): string {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${pick(NOUNS)}`
}
