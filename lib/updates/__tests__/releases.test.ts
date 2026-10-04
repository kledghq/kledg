import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearReleaseCache,
  diffMigrations,
  fetchReleases,
  fetchUpstreamMigrations,
  latestRelease,
  migrationsFromFiles,
  releasesSince,
  updateState,
  type Release,
} from '../releases'
import { fakeGitHub, resetGitHub } from './fake-github'

const gh = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  name: `Kledg ${tag}`,
  body: `Notes ${tag}`,
  html_url: `https://github.com/kledghq/kledg/releases/tag/${tag}`,
  published_at: '2026-10-01T00:00:00Z',
  draft: false,
  prerelease: false,
  ...extra,
})

const rel = (version: string, prerelease = false): Release => ({
  tag: `v${version}`,
  version,
  name: `Kledg v${version}`,
  body: '',
  url: 'https://github.com/kledghq/kledg/releases',
  publishedAt: null,
  prerelease,
})

beforeEach(() => clearReleaseCache())
afterEach(() => resetGitHub())

describe('fetchReleases', () => {
  it('keeps published semver releases, newest first, without a token', async () => {
    const fake = fakeGitHub({
      'GET /repos/kledghq/kledg/releases': {
        body: [gh('v0.1.0'), gh('v0.3.0-beta.1', { prerelease: true }), gh('v0.2.0'), gh('v9.9.9', { draft: true }), gh('nightly')],
      },
    })
    const result = await fetchReleases()
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.data.map((r) => r.tag)).toEqual(['v0.3.0-beta.1', 'v0.2.0', 'v0.1.0'])
    expect(fake.calls[0].authorization).toBeNull()
  })

  it('caches the answer for an hour', async () => {
    const fake = fakeGitHub({ 'GET /repos/kledghq/kledg/releases': { body: [gh('v0.1.0')] } })
    await fetchReleases()
    await fetchReleases()
    expect(fake.calls).toHaveLength(1)
  })

  it('is graceful when the repository is private (404)', async () => {
    fakeGitHub({})
    const result = await fetchReleases()
    expect(result).toEqual({ status: 'unavailable', message: expect.stringContaining('non public') })
  })

  it('is graceful when rate-limited', async () => {
    fakeGitHub({
      'GET /repos/kledghq/kledg/releases': { status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: { message: 'API rate limit exceeded' } },
    })
    const result = await fetchReleases()
    expect(result).toEqual({ status: 'unavailable', message: expect.stringContaining('Limite de requêtes GitHub') })
  })

  it('is graceful offline', async () => {
    const { setGitHubFetch } = await import('../github')
    setGitHubFetch((async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch)
    const result = await fetchReleases()
    expect(result.status).toBe('unavailable')
  })

  it('handles no release at all', async () => {
    fakeGitHub({ 'GET /repos/kledghq/kledg/releases': { body: [] } })
    const result = await fetchReleases()
    expect(result).toEqual({ status: 'ok', data: [] })
    expect(latestRelease([], '0.1.0')).toBeNull()
    expect(updateState('0.1.0', null)).toBe('unknown')
  })
})

describe('release selection', () => {
  const releases = [rel('0.4.0-rc.1', true), rel('0.3.0'), rel('0.2.0'), rel('0.1.0')]

  it('offers the latest stable release to stable instances', () => {
    expect(latestRelease(releases, '0.1.0')?.version).toBe('0.3.0')
  })

  it('offers pre-releases to instances already on a pre-release', () => {
    expect(latestRelease(releases, '0.3.0-beta.1')?.version).toBe('0.4.0-rc.1')
  })

  it('selects the notes between the current version and the target', () => {
    const target = latestRelease(releases, '0.1.0')
    expect(releasesSince(releases, '0.1.0', target).map((r) => r.version)).toEqual(['0.3.0', '0.2.0'])
    expect(releasesSince(releases, '0.3.0', target)).toEqual([])
    expect(releasesSince(releases, '0.1.0', null)).toEqual([])
  })

  it('computes the state', () => {
    expect(updateState('0.1.0', rel('0.3.0'))).toBe('available')
    expect(updateState('0.3.0', rel('0.3.0'))).toBe('up-to-date')
    expect(updateState('0.4.0', rel('0.3.0'))).toBe('ahead')
    expect(updateState('0.3.0-rc.1', rel('0.3.0'))).toBe('available')
  })
})

describe('migrations', () => {
  it('lists the migrations of a release from the contents API', async () => {
    const fake = fakeGitHub({
      'GET /repos/kledghq/kledg/contents/prisma/migrations?ref=v0.2.0': {
        body: [
          { name: '20261003120000_b', type: 'dir' },
          { name: '20261003000000_init', type: 'dir' },
          { name: 'migration_lock.toml', type: 'file' },
        ],
      },
    })
    const result = await fetchUpstreamMigrations('v0.2.0')
    expect(result).toEqual({ status: 'ok', data: ['20261003000000_init', '20261003120000_b'] })
    expect(fake.calls[0].path).toBe('/repos/kledghq/kledg/contents/prisma/migrations?ref=v0.2.0')
  })

  it('diffs target and applied migrations', () => {
    expect(diffMigrations(['20261003000000_init', '20261101000000_new', '20261001000000_a'], ['20261003000000_init'])).toEqual([
      '20261001000000_a',
      '20261101000000_new',
    ])
    expect(diffMigrations(['20261003000000_init'], ['20261003000000_init'])).toEqual([])
  })

  it('finds added migrations in pull request files', () => {
    expect(
      migrationsFromFiles([
        { filename: 'prisma/migrations/20261101000000_new/migration.sql', status: 'added' },
        { filename: 'prisma/migrations/20261003000000_init/migration.sql', status: 'modified' },
        { filename: 'prisma/schema.prisma', status: 'modified' },
        { filename: 'prisma/migrations/bad name/migration.sql', status: 'added' },
      ]),
    ).toEqual(['20261101000000_new'])
  })
})
