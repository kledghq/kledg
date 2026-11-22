/**
 * #161: the guard bypasses are for the owner, and the application purges
 * companies with their books through kledg_purge_companies only (migration
 * 20261224090000_company_purge_function). Connected as the application role
 * of KLEDG_RLS=enforce:
 * - kledg.company_purge and kledg.closed_year_bypass set with set_config no
 *   longer let a company with books be deleted;
 * - the purge deletes only the companies the context reaches, all or none;
 * - the mark of the purge cannot be written by the application role and is
 *   gone after the purge.
 * Skipped without the test database.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('rls_company_purge')
})

import { Client } from 'pg'
import { grantTestAppRole, prepareTestDatabase, testAppDatabaseUrl, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

describe.skipIf(!available)('company purge (PostgreSQL, application role)', () => {
  let owner: Client
  let app: Client
  let n = 0

  /** A company with a validated entry and a closed fiscal year, written by the owner. */
  async function companyWithBooks(): Promise<string> {
    n += 1
    const id = `purge-co-${n}`
    await owner.query(`INSERT INTO "companies" ("id", "name", "slug", "siren", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, now(), now())`, [id, `Purge ${n}`, `purge-${n}`, String(200000000 + n)])
    await owner.query(`INSERT INTO "fiscal_years" ("id", "companyId", "year", "startDate", "endDate", "createdAt", "updatedAt") VALUES ($1, $2, 2025, '2025-01-01', '2025-12-31', now(), now())`, [`${id}-fy`, id])
    await owner.query(`INSERT INTO "journals" ("id", "companyId", "code", "label", "createdAt", "updatedAt") VALUES ($1, $2, 'OD', 'OD', now(), now())`, [`${id}-j`, id])
    for (const [code, label] of [['512000', 'Banque'], ['706000', 'Ventes']]) {
      await owner.query(`INSERT INTO "accounts" ("id", "companyId", "fiscalYearId", "code", "label", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, now(), now())`, [`${id}-${code}`, id, `${id}-fy`, code, label])
    }
    await owner.query(
      `INSERT INTO "accounting_entries" ("id", "companyId", "fiscalYearId", "journalId", "entryNumber", "date", "description", "status", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, 'BR-1', '2025-03-01', 'Vente', 'draft', now(), now())`,
      [`${id}-e`, id, `${id}-fy`, `${id}-j`],
    )
    for (const [code, debit, credit] of [['512000', 10, 0], ['706000', 0, 10]] as const) {
      await owner.query(
        `INSERT INTO "entry_lines" ("id", "accountingEntryId", "accountingEntryNumber", "accountId", "accountFiscalYearId", "debit", "credit", "createdAt", "updatedAt") VALUES ($1, $2, 'BR-1', $3, $4, $5, $6, now(), now())`,
        [`${id}-l${code}`, `${id}-e`, `${id}-${code}`, `${id}-fy`, debit, credit],
      )
    }
    await owner.query(`UPDATE "accounting_entries" SET "status" = 'validated', "entryNumber" = '1' WHERE "id" = $1`, [`${id}-e`])
    await owner.query(`UPDATE "fiscal_years" SET "isClosed" = true, "closedAt" = now() WHERE "id" = $1`, [`${id}-fy`])
    return id
  }

  const exists = async (id: string) => (await owner.query(`SELECT 1 FROM "companies" WHERE "id" = $1`, [id])).rowCount === 1

  /** Runs `statements` as the application role in one transaction, in a system context limited to `scope` (null: unrestricted). */
  async function asApp(scope: string[] | null, statements: string[]): Promise<void> {
    await app.query('BEGIN')
    try {
      await app.query(`SELECT set_config('kledg.access', 'system', true), set_config('kledg.reason', 'test', true), set_config('kledg.company_scope', $1, true)`, [
        scope ? `{${scope.join(',')}}` : '',
      ])
      for (const statement of statements) await app.query(statement)
      await app.query('COMMIT')
    } catch (error) {
      await app.query('ROLLBACK')
      throw error
    }
  }

  beforeAll(async () => {
    owner = new Client({ connectionString: await prepareTestDatabase('rls_company_purge') })
    await owner.connect()
    await grantTestAppRole(owner)
    app = new Client({ connectionString: testAppDatabaseUrl('rls_company_purge') })
    await app.connect()
  }, 120_000)

  afterAll(async () => {
    await app?.end()
    await owner?.end()
  })

  it('ignores the bypasses set by the application role', async () => {
    const id = await companyWithBooks()
    await expect(
      asApp(null, [
        `SELECT set_config('kledg.company_purge', 'on', true), set_config('kledg.closed_year_bypass', 'on', true)`,
        'SET CONSTRAINTS ALL DEFERRED',
        `DELETE FROM "companies" WHERE "id" = '${id}'`,
      ]),
    ).rejects.toThrow(/KLEDG_COMPANY_HAS_BOOKS|KLEDG_FISCAL_YEAR_CLOSED/)
    expect(await exists(id)).toBe(true)
  })

  it('purges the companies of the context with their books, and leaves no mark', async () => {
    const a = await companyWithBooks()
    const b = await companyWithBooks()
    const kept = await companyWithBooks()
    await asApp([a, b], [`SELECT kledg_purge_companies(ARRAY['${a}', '${b}'])`])
    expect([await exists(a), await exists(b), await exists(kept)]).toEqual([false, false, true])
    expect((await owner.query(`SELECT count(*)::int AS n FROM "accounting_entries" WHERE "companyId" IN ($1, $2)`, [a, b])).rows[0].n).toBe(0)
    expect((await owner.query(`SELECT count(*)::int AS n FROM "kledg_purge_marks"`)).rows[0].n).toBe(0)
    // The guards are back once the purge returned, in the same transaction too
    await expect(asApp(null, [`SELECT kledg_purge_companies(ARRAY[]::text[])`, `DELETE FROM "companies" WHERE "id" = '${kept}'`])).rejects.toThrow(/KLEDG_COMPANY_HAS_BOOKS/)
  })

  it('refuses a company out of the context, and deletes none', async () => {
    const reached = await companyWithBooks()
    const other = await companyWithBooks()
    await expect(asApp([reached], [`SELECT kledg_purge_companies(ARRAY['${reached}', '${other}'])`])).rejects.toThrow(/KLEDG_PURGE_REFUSED/)
    expect([await exists(reached), await exists(other)]).toEqual([true, true])
  })

  it('gives the application role no right on the purge marks', async () => {
    await expect(asApp(null, ['INSERT INTO "kledg_purge_marks" DEFAULT VALUES'])).rejects.toThrow(/permission denied/)
    const { rows } = await owner.query<{ granted: boolean }>(
      `SELECT bool_or(has_table_privilege('kledg_app_test', 'public.kledg_purge_marks', p)) AS granted FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p`,
    )
    expect(rows[0].granted).toBe(false)
  })
})
