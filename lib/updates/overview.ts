/**
 * What the "Mises à jour" page shows without a token: running version,
 * latest Kledg release, release notes since the running version and the
 * database migrations the update would apply.
 */

import { actionRefusalMessage, isActionAllowed, type InstanceActor } from '@/lib/instance'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { getConnectionSummary, type ConnectionSummary } from './connection'
import {
  diffMigrations,
  fetchReleases,
  fetchUpstreamMigrations,
  latestRelease,
  releasesSince,
  updateState,
  type Release,
  type UpdateState,
} from './releases'
import { getDeployedVersion, type DeployedVersion } from './version'

export interface UpdateOverview {
  current: DeployedVersion
  state: UpdateState
  latest: Release | null
  /** Release notes newer than the running version, newest first. */
  notes: Release[]
  /** Why releases could not be read (offline, rate limit, private repository). */
  releasesError: string | null
  migrations: { names: string[]; error: string | null } | null
  connection: ConnectionSummary | null
  /**
   * Why this user may not manage updates on this instance (instance policy,
   * lib/instance), or null: the page then only shows versions and notes.
   */
  managementRefused: string | null
}

/** Migrations recorded as applied in this database (Prisma's own table). */
export async function appliedMigrations(): Promise<string[] | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `
    return rows.map((r) => r.migration_name)
  } catch (error) {
    logger.warn('Could not read applied migrations', { error: error instanceof Error ? error.message : String(error) })
    return null
  }
}

export async function getUpdateOverview(
  options: { light?: boolean; actor?: InstanceActor | null } = {},
): Promise<UpdateOverview> {
  const current = getDeployedVersion()
  const [releases, connection, allowed] = await Promise.all([
    fetchReleases(),
    options.light ? null : getConnectionSummary(),
    isActionAllowed('manage-updates', options.actor ?? null),
  ])
  const managementRefused = allowed ? null : actionRefusalMessage('manage-updates')

  if (releases.status !== 'ok') {
    return { current, state: 'unknown', latest: null, notes: [], releasesError: releases.message, migrations: null, connection, managementRefused }
  }

  const latest = latestRelease(releases.data, current.version)
  const state = updateState(current.version, latest)
  const notes = releasesSince(releases.data, current.version, latest)

  let migrations: UpdateOverview['migrations'] = null
  if (!options.light && latest && state === 'available') {
    const [target, applied] = await Promise.all([fetchUpstreamMigrations(latest.tag), appliedMigrations()])
    if (target.status !== 'ok') {
      migrations = { names: [], error: target.message }
    } else if (applied) {
      migrations = { names: diffMigrations(target.data, applied), error: null }
    } else {
      // Fall back to the migrations of the release the instance runs.
      const base = await fetchUpstreamMigrations(`v${current.version}`)
      migrations =
        base.status === 'ok'
          ? { names: diffMigrations(target.data, base.data), error: null }
          : { names: [], error: base.message }
    }
  }

  return { current, state, latest, notes, releasesError: null, migrations, connection, managementRefused }
}
