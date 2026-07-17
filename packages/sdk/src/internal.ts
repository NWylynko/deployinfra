/**
 * `@deployinfra/sdk/internal` — provider-author toolkit.
 *
 * Semver-stable for provider packages (`@deployinfra/vercel`, community
 * providers, etc.). Application authors should prefer the main
 * `@deployinfra/sdk` entry; this subpath may grow helpers that are not
 * part of the app-facing contract.
 *
 * @packageDocumentation
 */

export { request, mapHttpError } from './http.js'
export type { HttpRequestInit, HttpResponse } from './http.js'

export { pollDeployment } from './poll.js'
export type { PollOptions } from './poll.js'

export { sha1, sha256 } from './hash.js'

export { adaptSource } from './deployer.js'

export { mapPool } from './map-pool.js'

export { detect } from './source/detect.js'
export { resolve } from './source/resolve.js'
export { fromDir } from './source/dir.js'
export { fromFiles } from './source/files.js'
export { fromZipBytes, fromZipFile, fromZipUrl, collectFiles } from './source/zip.js'
export {
  createGitHubSource,
  parseGitHubInput,
  stripGithubRoot,
} from './source/github.js'
