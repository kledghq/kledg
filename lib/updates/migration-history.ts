/**
 * The Prisma migrations applied to this database, read through
 * kledg_applied_migrations() (migration 20261203090000_migration_history_reader):
 * a SECURITY DEFINER function, so the restricted application role of
 * KLEDG_RLS=enforce reads the names and end times without any right on
 * "_prisma_migrations" (docs/rls.md). Finished and not rolled back only.
 */

import { prisma } from '@/lib/prisma'

export interface AppliedMigration {
  name: string
  finishedAt: Date
}

/** Applied migrations, in the order they finished (then by name). */
export async function readAppliedMigrations(): Promise<AppliedMigration[]> {
  const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date }>>`
    SELECT migration_name, finished_at FROM kledg_applied_migrations() ORDER BY finished_at, migration_name
  `
  return rows.map((r) => ({ name: r.migration_name, finishedAt: r.finished_at }))
}

/** Names of the migrations finished after `since` and up to `until`, in the order they ran. */
export async function migrationsFinishedBetween(since: Date, until: Date): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name FROM kledg_applied_migrations()
    WHERE finished_at > ${since} AND finished_at <= ${until}
    ORDER BY finished_at, migration_name
  `
  return rows.map((r) => r.migration_name)
}
