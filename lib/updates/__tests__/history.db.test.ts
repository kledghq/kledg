/**
 * Update history (lib/updates/history.ts) against PostgreSQL: one row per
 * version and commit, the previous version and the migrations finished since,
 * attribution to the administrator who installed it from the "Mises à jour"
 * page, one row under concurrent starts, and the paged listing. Skipped
 * without the test database server.
 */

import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('update_history')
})

import { prepareTestDatabase, queryAsOwner, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { rlsMode } from '@/lib/rls/mode'

const available = await testDatabaseAvailable()
const DB = 'update_history'

const SHA1 = '1111111111111111111111111111111111111111'
const SHA2 = '2222222222222222222222222222222222222222'
const SHA3 = '3333333333333333333333333333333333333333'

let prisma: typeof import('@/lib/prisma').prisma
let history: typeof import('../history')

function env(version: string, commit: string | null) {
  return {
    VERCEL: '1',
    VERCEL_GIT_PROVIDER: 'github',
    VERCEL_GIT_REPO_OWNER: 'acme',
    VERCEL_GIT_REPO_SLUG: 'compta',
    VERCEL_GIT_COMMIT_REF: 'main',
    KLEDG_VERSION: version,
    ...(commit ? { VERCEL_GIT_COMMIT_SHA: commit } : {}),
  }
}

const at = (iso: string) => new Date(iso)

async function migration(name: string, finishedAt: string | null, rolledBack = false) {
  await queryAsOwner(
    DB,
    `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, rolled_back_at, started_at, applied_steps_count)
     VALUES ($1, 'x', $1, $2, $3, now(), 1)`,
    [name, finishedAt, rolledBack ? finishedAt : null],
  )
}

async function mergeAudit(userId: string, newCommit: string, createdAt: string) {
  await prisma.auditLog.createMany({
    data: [
      {
        action: 'UPDATES_MERGE',
        message: 'Kledg update installed',
        userId,
        metadata: { repository: 'acme/compta', mode: 'pull', pullNumber: 7, previousCommit: SHA1, newCommit },
        createdAt: at(createdAt),
      },
    ],
  })
}

describe.skipIf(!available)('update history', () => {
  beforeAll(async () => {
    await prepareTestDatabase(DB)
    // The test databases are built from the migration files, without Prisma's own table.
    await queryAsOwner(
      DB,
      `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
         id VARCHAR(36) PRIMARY KEY, checksum VARCHAR(64) NOT NULL, finished_at TIMESTAMPTZ,
         migration_name VARCHAR(255) NOT NULL, logs TEXT, rolled_back_at TIMESTAMPTZ,
         started_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_steps_count INTEGER NOT NULL DEFAULT 0)`,
    )
    ;({ prisma } = await import('@/lib/prisma'))
    history = await import('../history')
  })

  beforeEach(async () => {
    await queryAsOwner(DB, 'TRUNCATE "instance_versions", "audit_logs", "_prisma_migrations", "user" CASCADE')
    const now = new Date()
    await prisma.user.createMany({
      data: [
        { id: 'u-admin', name: 'Alice Martin', email: 'alice@example.com', role: 'admin', createdAt: now, updatedAt: now },
        { id: 'u-member', name: 'Bob Durand', email: 'bob@example.com', role: 'user', createdAt: now, updatedAt: now },
      ],
    })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('records the first version without previous version nor migrations', async () => {
    await migration('20261001090000_old', '2026-10-01T09:00:00Z')
    const outcome = await history.recordDeployedVersion({ env: env('1.3.0', SHA1), now: at('2026-10-02T10:00:00Z') })
    expect(outcome).toBe('recorded')
    const rows = await prisma.instanceVersion.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      version: '1.3.0',
      commit: SHA1,
      branch: 'main',
      platform: 'vercel',
      firstSeenAt: at('2026-10-02T10:00:00Z'),
      previousVersion: null,
      previousCommit: null,
      installedByUserId: null,
      source: 'external',
      migrations: [],
      migrationsKnown: true,
    })
  })

  it('adds no row while the version and commit stay the same', async () => {
    await history.recordDeployedVersion({ env: env('1.3.0', SHA1), now: at('2026-10-02T10:00:00Z') })
    expect(await history.recordDeployedVersion({ env: env('1.3.0', SHA1), now: at('2026-10-03T10:00:00Z') })).toBe('unchanged')
    expect(await prisma.instanceVersion.count()).toBe(1)
  })

  it.skipIf(rlsMode() === 'enforce')(
    'records a new commit with the previous version and the migrations finished since',
    async () => {
      await history.recordDeployedVersion({ env: env('1.3.0', SHA1), now: at('2026-10-02T10:00:00Z') })
      await migration('20261001090000_before', '2026-10-01T09:00:00Z')
      await migration('20261102090000_b', '2026-10-05T08:01:00Z')
      await migration('20261101090000_a', '2026-10-05T08:00:00Z')
      await migration('20261103090000_rolled_back', '2026-10-05T08:02:00Z', true)
      await migration('20261104090000_unfinished', null)

      expect(await history.recordDeployedVersion({ env: env('1.3.0', SHA2), now: at('2026-10-05T08:10:00Z') })).toBe('recorded')
      const latest = await prisma.instanceVersion.findFirstOrThrow({ orderBy: { firstSeenAt: 'desc' } })
      expect(latest).toMatchObject({
        version: '1.3.0',
        commit: SHA2,
        previousVersion: '1.3.0',
        previousCommit: SHA1,
        source: 'external',
        migrations: ['20261101090000_a', '20261102090000_b'],
        migrationsKnown: true,
      })
      expect(await prisma.instanceVersion.count()).toBe(2)
    },
  )

  it('attributes the version to the administrator who merged its commit from the updates page', async () => {
    await history.recordDeployedVersion({ env: env('1.3.0', SHA1), now: at('2026-10-02T10:00:00Z') })
    // writeAuditLog stores the email of the user.
    await mergeAudit('alice@example.com', SHA2, '2026-10-05T08:00:00Z')
    await history.recordDeployedVersion({ env: env('1.4.0', SHA2), now: at('2026-10-05T08:10:00Z') })
    const latest = await prisma.instanceVersion.findFirstOrThrow({ where: { commit: SHA2 } })
    expect(latest).toMatchObject({ source: 'update-page', installedByUserId: 'u-admin', previousVersion: '1.3.0' })
  })

  it('attributes the first recorded version too, and a version without known commit to the latest merge', async () => {
    await mergeAudit('u-admin', SHA2, '2026-10-05T08:00:00Z')
    await history.recordDeployedVersion({ env: env('1.4.0', null), now: at('2026-10-05T08:10:00Z') })
    expect(await prisma.instanceVersion.findFirstOrThrow()).toMatchObject({ commit: null, source: 'update-page', installedByUserId: 'u-admin' })
  })

  it('keeps an update external when the merge does not match it', async () => {
    await history.recordDeployedVersion({ env: env('1.3.0', SHA1), now: at('2026-10-02T10:00:00Z') })
    // Another commit was merged from the page, then something else was deployed.
    await mergeAudit('alice@example.com', SHA2, '2026-10-05T08:00:00Z')
    // Merged by a user who is not an instance administrator (any more).
    await mergeAudit('bob@example.com', SHA3, '2026-10-05T08:00:00Z')
    // Merged before the previous version was first seen.
    await mergeAudit('alice@example.com', SHA3, '2026-10-01T08:00:00Z')
    await history.recordDeployedVersion({ env: env('1.4.0', SHA3), now: at('2026-10-05T08:10:00Z') })
    expect(await prisma.instanceVersion.findFirstOrThrow({ where: { commit: SHA3 } })).toMatchObject({
      source: 'external',
      installedByUserId: null,
    })
  })

  it('ignores a merge older than the attribution window', async () => {
    await mergeAudit('alice@example.com', SHA2, '2026-10-01T08:00:00Z')
    await history.recordDeployedVersion({ env: env('1.4.0', SHA2), now: at('2026-10-05T08:10:00Z') })
    expect(await prisma.instanceVersion.findFirstOrThrow()).toMatchObject({ source: 'external' })
  })

  it('inserts one row when several servers start at once, with or without a commit', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => history.recordDeployedVersion({ env: env('1.4.0', SHA2), now: at('2026-10-05T08:10:00Z') })),
    )
    expect(outcomes.filter((o) => o === 'recorded')).toHaveLength(1)
    expect(await prisma.instanceVersion.count()).toBe(1)

    await Promise.all(
      Array.from({ length: 5 }, () => history.recordDeployedVersion({ env: env('1.5.0', null), now: at('2026-10-06T08:10:00Z') })),
    )
    expect(await prisma.instanceVersion.count({ where: { version: '1.5.0' } })).toBe(1)
  })

  it('records nothing in tests through ensureVersionRecorded', async () => {
    await history.ensureVersionRecorded()
    expect(await prisma.instanceVersion.count()).toBe(0)
  })

  it('lists the versions newest first, page by page, with the installer name and the notes link', async () => {
    await history.recordDeployedVersion({ env: env('1.2.0', SHA1), now: at('2026-10-01T10:00:00Z') })
    await mergeAudit('alice@example.com', SHA2, '2026-10-02T09:00:00Z')
    await history.recordDeployedVersion({ env: env('1.3.0', SHA2), now: at('2026-10-02T10:00:00Z') })
    await history.recordDeployedVersion({ env: env('1.4.0-rc.1', SHA3), now: at('2026-10-03T10:00:00Z') })

    const listEnv = env('1.4.0-rc.1', SHA3)
    const first = await history.listVersionHistory({ limit: 2, env: listEnv })
    expect(first.items.map((i) => i.version)).toEqual(['1.4.0-rc.1', '1.3.0'])
    expect(first.nextCursor).toBe(first.items[1].id)
    expect(first.items[0]).toMatchObject({
      source: 'external',
      installedBy: null,
      previousVersion: '1.3.0',
      notesKind: 'commit',
      notesUrl: `https://github.com/acme/compta/commit/${SHA3}`,
      firstSeenAt: '2026-10-03T10:00:00.000Z',
    })
    expect(first.items[1]).toMatchObject({
      source: 'update-page',
      installedBy: { name: 'Alice Martin' },
      notesKind: 'release',
      notesUrl: 'https://github.com/kledghq/kledg/releases/tag/v1.3.0',
    })
    expect(JSON.stringify(first)).not.toContain('alice@example.com')

    const second = await history.listVersionHistory({ limit: 2, cursor: first.nextCursor!, env: listEnv })
    expect(second.items.map((i) => i.version)).toEqual(['1.2.0'])
    expect(second.nextCursor).toBeNull()
  })
})

describe('releaseUrl', () => {
  it('links plain releases only', async () => {
    const { releaseUrl } = await import('../history')
    expect(releaseUrl('1.4.0')).toBe('https://github.com/kledghq/kledg/releases/tag/v1.4.0')
    expect(releaseUrl('1.4.0-rc.1')).toBeNull()
    expect(releaseUrl('1.4.0+build.5')).toBeNull()
    expect(releaseUrl('main')).toBeNull()
  })
})
