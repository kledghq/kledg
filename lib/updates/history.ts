/**
 * Update history of the instance ("Historique des mises à jour" on the
 * "Mises à jour" page): one `instance_versions` row per version and commit
 * the instance has run.
 *
 * - Recorded at server start (instrumentation.ts, ensureVersionRecorded):
 *   when the running version or commit differs from the latest row, a row is
 *   inserted with the previous version, the Prisma migrations finished since
 *   the previous row, and who installed it. Idempotent: the unique index on
 *   (version, commit) makes concurrent cold starts insert one row, the
 *   others' unique violation is ignored. A version seen before (a rollback to
 *   an older deployment) keeps its first row.
 * - Attribution: the version comes from the "Mises à jour" page
 *   (`update-page`) when an UPDATES_MERGE audit row by an instance
 *   administrator was written after the previous version was first seen and
 *   at most 24 hours before this one, and its merged commit is the running
 *   commit (any such row when the running commit is unknown). Otherwise it
 *   is `external`: a redeploy by the host, a git push, a manual update.
 * - Never blocks a request and never throws at start: failures are logged.
 *   Nothing is recorded in tests or without a database URL.
 */

import { Prisma } from '@prisma/client'
import { prisma, databaseUrl } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { withSystemContext } from '@/lib/rls/context'
import { UPSTREAM } from './github'
import { HISTORY_PAGE_SIZE } from './history-query'
import { getDeployedVersion, parseVersion } from './version'

type Env = Record<string, string | undefined>

export type VersionSource = 'update-page' | 'external'

/** How long after the merge on the "Mises à jour" page the new version may first start. */
export const ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000

export type RecordOutcome = 'recorded' | 'unchanged'

interface RecordOptions {
  env?: Env
  now?: Date
}

/** Prisma migrations finished after `since` (and up to `until`), in the order they ran; null when unreadable. */
async function migrationsBetween(since: Date, until: Date): Promise<string[] | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL AND finished_at > ${since} AND finished_at <= ${until}
      ORDER BY finished_at, migration_name
    `
    return rows.map((r) => r.migration_name)
  } catch (error) {
    // KLEDG_RLS=enforce: the application role has no right on the migration history.
    logger.warn('Update history: could not read the migration history', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function sameCommit(a: string, b: string): boolean {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x.startsWith(y) || y.startsWith(x)
}

/** The administrator whose UPDATES_MERGE audit row installed the running version, or null (see the module comment). */
async function installerOf(commit: string | null, since: Date, now: Date): Promise<string | null> {
  const audits = await prisma.auditLog.findMany({
    where: { action: 'UPDATES_MERGE', createdAt: { gt: since, lte: now } },
    orderBy: { createdAt: 'desc' },
    select: { userId: true, metadata: true },
    take: 20,
  })
  for (const audit of audits) {
    if (!audit.userId) continue
    if (commit) {
      const merged = (audit.metadata as { newCommit?: unknown } | null)?.newCommit
      if (typeof merged !== 'string' || !merged || !sameCommit(merged, commit)) continue
    }
    // writeAuditLog stores the user's email (or id when it has none).
    const user = await prisma.user.findFirst({
      where: { OR: [{ id: audit.userId }, { email: audit.userId }] },
      select: { id: true, role: true },
    })
    if (user?.role === 'admin') return user.id
  }
  return null
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/**
 * Inserts a row when the running version or commit differs from the latest
 * one. Throws on a database error (callers at start use ensureVersionRecorded).
 */
export async function recordDeployedVersion(options: RecordOptions = {}): Promise<RecordOutcome> {
  const now = options.now ?? new Date()
  const current = getDeployedVersion(options.env ?? process.env)
  const latest = await prisma.instanceVersion.findFirst({ orderBy: [{ firstSeenAt: 'desc' }, { id: 'desc' }] })
  if (latest && latest.version === current.version && latest.commit === current.commit) return 'unchanged'

  // The audit rows have no company: only an unrestricted context reads them (docs/rls.md).
  return withSystemContext('version-history', async () => {
    const migrations = latest ? await migrationsBetween(latest.firstSeenAt, now) : []
    const since = new Date(Math.max(now.getTime() - ATTRIBUTION_WINDOW_MS, latest?.firstSeenAt.getTime() ?? 0))
    const installedByUserId = await installerOf(current.commit, since, now)
    try {
      await prisma.instanceVersion.create({
        data: {
          version: current.version,
          commit: current.commit,
          branch: current.branch,
          platform: current.platform,
          firstSeenAt: now,
          previousVersion: latest?.version ?? null,
          previousCommit: latest?.commit ?? null,
          installedByUserId,
          source: installedByUserId ? 'update-page' : 'external',
          migrations: migrations ?? [],
          migrationsKnown: migrations !== null,
        },
      })
      logger.info(`Update history: Kledg ${current.version}${current.commit ? ` (${current.commit.slice(0, 7)})` : ''} recorded`)
      return 'recorded' as const
    } catch (error) {
      // Another server starting at the same time recorded it, or this version ran before.
      if (isUniqueViolation(error)) return 'unchanged' as const
      throw error
    }
  })
}

function recordingDisabled(env: Env): boolean {
  return env.NODE_ENV === 'test' || Boolean(env.VITEST) || !databaseUrl(env)
}

let pending: Promise<void> | null = null

/**
 * Records the running version once per process: called at server start
 * (instrumentation.ts, not awaited) and awaited by the history route, which
 * then lists the current version even when the start was cut short. Never
 * throws; a failure is logged and the next call tries again. Does nothing in
 * tests or without a database URL.
 */
export function ensureVersionRecorded(env: Env = process.env): Promise<void> {
  if (recordingDisabled(env)) return Promise.resolve()
  pending ??= recordDeployedVersion({ env }).then(
    () => undefined,
    (error: unknown) => {
      pending = null
      logger.error('Update history: could not record the running version', error)
    },
  )
  return pending
}

export interface VersionHistoryEntry {
  id: string
  version: string
  commit: string | null
  branch: string | null
  platform: string
  firstSeenAt: string
  previousVersion: string | null
  previousCommit: string | null
  source: VersionSource
  /** Name of the administrator who installed it from the "Mises à jour" page. */
  installedBy: { name: string } | null
  migrations: string[]
  /** False when the migration history could not be read when the version was recorded. */
  migrationsKnown: boolean
  /** Release notes on GitHub (plain release versions), else the deployed commit, else null. */
  notesUrl: string | null
  notesKind: 'release' | 'commit' | null
}

export interface VersionHistoryPage {
  items: VersionHistoryEntry[]
  nextCursor: string | null
}

/** The GitHub release of a plain semver release version (1.2.3, no pre-release or build metadata), else null. */
export function releaseUrl(version: string): string | null {
  const parsed = parseVersion(version)
  if (!parsed || parsed.prerelease.length || !/^\d+\.\d+\.\d+$/.test(version)) return null
  return `https://github.com/${UPSTREAM.owner}/${UPSTREAM.repo}/releases/tag/v${version}`
}

function notesLink(
  version: string,
  commit: string | null,
  repository: { owner: string; repo: string } | null,
): Pick<VersionHistoryEntry, 'notesUrl' | 'notesKind'> {
  const release = releaseUrl(version)
  if (release) return { notesUrl: release, notesKind: 'release' }
  if (commit && repository) {
    return { notesUrl: `https://github.com/${repository.owner}/${repository.repo}/commit/${commit}`, notesKind: 'commit' }
  }
  return { notesUrl: null, notesKind: null }
}

/** Versions newest first, `limit` per page after the row `cursor` (its id). */
export async function listVersionHistory(
  options: { cursor?: string; limit?: number; env?: Env } = {},
): Promise<VersionHistoryPage> {
  const limit = Math.min(Math.max(options.limit ?? HISTORY_PAGE_SIZE, 1), HISTORY_PAGE_SIZE)
  const rows = await prisma.instanceVersion.findMany({
    orderBy: [{ firstSeenAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  })
  const page = rows.slice(0, limit)
  const installerIds = [...new Set(page.map((r) => r.installedByUserId).filter((id): id is string => Boolean(id)))]
  const installers = installerIds.length
    ? await prisma.user.findMany({ where: { id: { in: installerIds } }, select: { id: true, name: true } })
    : []
  const names = new Map(installers.map((u) => [u.id, u.name]))
  // The instance deploys from one repository: the current one names the commits of earlier rows too.
  const { repository } = getDeployedVersion(options.env ?? process.env)

  return {
    items: page.map((row) => {
      const name = row.installedByUserId ? names.get(row.installedByUserId) : undefined
      return {
        id: row.id,
        version: row.version,
        commit: row.commit,
        branch: row.branch,
        platform: row.platform,
        firstSeenAt: row.firstSeenAt.toISOString(),
        previousVersion: row.previousVersion,
        previousCommit: row.previousCommit,
        source: row.source === 'update-page' ? 'update-page' : 'external',
        installedBy: row.source === 'update-page' ? { name: name || 'Administrateur supprimé' } : null,
        migrations: row.migrations,
        migrationsKnown: row.migrationsKnown,
        ...notesLink(row.version, row.commit, repository),
      }
    }),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  }
}
