import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { SourceError, createDeployer } from '@deployinfra/sdk'
import { detect, resolve } from '@deployinfra/sdk/internal'
import { createFixture, type E2eFixture } from './helpers/fixture.ts'
import { githubConfig } from './helpers/sources.ts'

describe('e2e source contract (no credentials)', () => {
  let fixture: E2eFixture
  let tarPath: string
  let tmp: string

  beforeAll(async () => {
    fixture = await createFixture()
    tmp = await mkdtemp(join(tmpdir(), 'deployinfra-tar-'))
    tarPath = join(tmp, 'site.tar')
    await writeFile(tarPath, 'not-a-real-tar')
  })

  afterAll(async () => {
    await fixture.close()
    await rm(tmp, { recursive: true, force: true })
  })

  it('detects directory string and descriptor', async () => {
    await expect(detect(fixture.dirPath)).resolves.toMatchObject({
      kind: 'dir',
    })
    await expect(
      detect({ kind: 'dir', path: fixture.dirPath }),
    ).resolves.toEqual({
      kind: 'dir',
      path: fixture.dirPath,
    })
    const resolved = await resolve({ kind: 'dir', path: fixture.dirPath })
    expect(resolved.kind).toBe('files')
  })

  it('resolves files descriptor', async () => {
    const resolved = await resolve({
      kind: 'files',
      files: fixture.files,
    })
    expect(resolved.kind).toBe('files')
    expect(await resolved.count()).toBeGreaterThan(0)
  })

  it('detects zip string and descriptor', async () => {
    expect(await detect(fixture.zipPath)).toMatchObject({ kind: 'zip' })
    expect(
      await detect({ kind: 'zip', path: fixture.zipPath }),
    ).toMatchObject({ kind: 'zip' })
    const resolved = await resolve({ kind: 'zip', path: fixture.zipPath })
    expect(resolved.kind).toBe('files')
    expect(resolved.zipBytes).toBeTypeOf('function')
  })

  it('detects zip-url string and descriptor', async () => {
    expect(await detect(fixture.zipUrl)).toEqual({
      kind: 'zip-url',
      url: fixture.zipUrl,
    })
    const resolved = await resolve({
      kind: 'zip-url',
      url: fixture.zipUrl,
    })
    expect(resolved.kind).toBe('files')
    expect(resolved.zipBytes).toBeTypeOf('function')
    const bytes = await resolved.zipBytes!()
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })

  it('detects GitHub URL and descriptor', async () => {
    const gh = githubConfig()
    expect(await detect(gh.url)).toMatchObject({
      kind: 'github',
      owner: gh.owner,
      repo: gh.repo,
    })
    const resolved = await resolve({
      kind: 'github',
      owner: gh.owner,
      repo: gh.repo,
      ref: gh.ref,
    })
    expect(resolved.kind).toBe('git')
  })

  it('rejects tar sources from createDeployer', async () => {
    const deployer = createDeployer({
      provider: {
        specificationVersion: 'v1',
        name: 'fake',
        capabilities: { sources: { files: true, git: false } },
        async deploy() {
          return {
            provider: 'fake',
            deploymentId: 'x',
            status: 'ready',
            raw: {},
          }
        },
        async getDeployment(id) {
          return {
            provider: 'fake',
            deploymentId: id,
            status: 'ready',
            raw: {},
          }
        },
      },
    })

    await expect(
      deployer.deploy({ kind: 'tar', path: tarPath }, { waitUntil: 'created' }),
    ).rejects.toBeInstanceOf(SourceError)

    await expect(
      deployer.deploy({ kind: 'tar', path: tarPath }, { waitUntil: 'created' }),
    ).rejects.toThrow(/Tar sources are not yet supported/)
  })

  it('builds a valid zip fixture (PK magic)', () => {
    const zipped = zipSync({
      'index.html': new TextEncoder().encode('<h1>deployinfra-ok</h1>'),
    })
    expect(zipped[0]).toBe(0x50)
    expect(zipped[1]).toBe(0x4b)
  })
})
