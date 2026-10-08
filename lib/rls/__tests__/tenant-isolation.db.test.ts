/**
 * Attack tests of row level security (docs/rls.md): with only user A's
 * context, raw SQL and Prisma calls cannot read, insert, update or delete the
 * rows of company B, in every table that carries policies. A missing context
 * reads nothing and writes nothing; the anonymous context reaches nothing; a
 * scope narrows; administrators and system contexts reach everything.
 *
 * Always runs with KLEDG_RLS=enforce and the application role, whatever the
 * mode of the rest of the suite, and without the tests' system fallback: a
 * statement here has exactly the context the test gives it.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const previous = await vi.hoisted(async () => {
  const before = { rls: process.env.KLEDG_RLS, fallback: process.env.KLEDG_RLS_TEST_CONTEXT }
  process.env.KLEDG_RLS = 'enforce'
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('rls_isolation')
  delete process.env.KLEDG_RLS_TEST_CONTEXT
  return before
})

import { readFileSync } from 'fs'
import { join } from 'path'
import { Client } from 'pg'
import {
  TEST_APP_ROLE,
  prepareTestDatabase,
  testAppDatabaseUrl,
  testDatabaseAvailable,
} from '@/lib/__tests__/helpers/test-db'
import { prisma } from '@/lib/prisma'
import { enforcedStatement } from '@/lib/rls/app-role'
import {
  runWithRlsContext,
  withAnonymousContext,
  withSystemContext,
  withUserContext,
  type RlsContext,
} from '@/lib/rls/context'
import { RlsContextMissingError } from '@/lib/rls/pool'
import { setContextSql } from '@/lib/rls/sql'
import { CHILD_TABLES, COMPANY_TABLES } from '@/lib/rls/tables'
import { ADMIN, BANNED, COMPANY, USER_A, USER_AC, USER_B, rowKey, seedTenants, type SeededKeys } from './fixtures'

const available = await testDatabaseAvailable()

/** Every table with policies, with the rows seeded for each company. */
const OTHER_TABLES = [
  'organization',
  'member',
  'invitation',
  'persons',
  'audit_logs',
  'balance_sheet_config_templates',
  'income_statement_config_templates',
  'dashboard_layouts',
  'sidebar_preferences',
  'mcp_confirmations',
  'mcp_pending_actions',
  'ai_access_grants',
  'ai_access_grant_companies',
  'user_preferences',
]
const ALL_TABLES = [...COMPANY_TABLES, ...Object.keys(CHILD_TABLES), ...OTHER_TABLES]

/** Tables whose row moves to another company by its companyId column. */
const MOVABLE_TABLES = COMPANY_TABLES.filter(
  (table) => !['companies', 'entry_lines', 'bank_transactions', 'company_onboarding'].includes(table),
)

describe.skipIf(!available)('row level security: tenant isolation', () => {
  let owner: Client
  let app: Client
  let keys: SeededKeys

  beforeAll(async () => {
    const ownerUrl = await prepareTestDatabase('rls_isolation')
    owner = new Client({ connectionString: ownerUrl })
    await owner.connect()
    app = new Client({ connectionString: testAppDatabaseUrl('rls_isolation') })
    await app.connect()
    keys = await seedTenants(prisma)
  })

  afterAll(async () => {
    await app?.end()
    await owner?.end()
    await prisma.$disconnect()
    process.env.KLEDG_RLS = previous.rls
    if (previous.fallback) process.env.KLEDG_RLS_TEST_CONTEXT = previous.fallback
  })

  /** Runs `fn` on the application role's raw connection inside a transaction with `context`, then rolls back. */
  async function asRaw<T>(context: RlsContext | undefined, fn: (client: Client) => Promise<T>): Promise<T> {
    await app.query('BEGIN')
    try {
      await app.query(setContextSql(context, (value) => app.escapeLiteral(value)))
      return await fn(app)
    } finally {
      await app.query('ROLLBACK')
    }
  }

  const userA: RlsContext = { access: 'user', userId: USER_A }

  async function visibleKeys(context: RlsContext | undefined, table: string): Promise<string[]> {
    return asRaw(context, async (client) => {
      const { rows } = await client.query<{ key: string }>(`SELECT ${rowKey(table)} AS key FROM "${table}"`)
      return rows.map((row) => row.key)
    })
  }

  it('connects as a role that is not the owner and has no BYPASSRLS', async () => {
    const { rows } = await app.query<{ role: string; super: boolean; bypass: boolean }>(
      'SELECT current_user AS role, rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user',
    )
    expect(rows[0]).toEqual({ role: TEST_APP_ROLE, super: false, bypass: false })
    const seeded = await owner.query('SELECT count(*)::int AS n FROM "accounting_entries"')
    expect(seeded.rows[0].n).toBe(2)
  })

  describe.each(ALL_TABLES)('%s', (table) => {
    it('user A sees company A and never company B', async () => {
      const visible = await visibleKeys(userA, table)
      expect(keys[table]?.a, `no row seeded in ${table}`).toBeTruthy()
      expect(visible).toContain(keys[table].a)
      expect(visible).not.toContain(keys[table].b)
    })

    it('user A updates and deletes nothing of company B', async () => {
      await asRaw(userA, async (client) => {
        const where = `${rowKey(table)} = $1`
        const updated = await client.query(`UPDATE "${table}" SET ${firstColumnNoop(table)} WHERE ${where}`, [keys[table].b])
        expect(updated.rowCount).toBe(0)
        const deleted = await client.query(`DELETE FROM "${table}" WHERE ${where}`, [keys[table].b])
        expect(deleted.rowCount).toBe(0)
      })
      // Still there for the owner.
      const { rowCount } = await owner.query(`SELECT 1 FROM "${table}" WHERE ${rowKey(table)} = $1`, [keys[table].b])
      expect(rowCount).toBe(1)
    })

    it('user A cannot insert a row into company B', async () => {
      // A copy of B's row (read as the owner) with a new key: the policy refuses it before any constraint.
      const { rows } = await owner.query(`SELECT to_jsonb(t) AS row FROM "${table}" t WHERE ${rowKey(table)} = $1`, [keys[table].b])
      const copy = { ...(rows[0].row as Record<string, unknown>) }
      if ('id' in copy) copy.id = `${String(copy.id)}-copy`
      if (table === 'company_onboarding' || table === 'ai_access_grant_companies') {
        // Keyed by the company: reuse B's company, A's own grant for the grant link.
        if (table === 'ai_access_grant_companies') copy.grantId = keys.ai_access_grants.a
      }
      if (table === 'companies') {
        copy.slug = 'copie'
        copy.siren = '999999999'
      }
      const attempt = asRaw(userA, (client) =>
        client.query(`INSERT INTO "${table}" SELECT * FROM jsonb_populate_record(NULL::"${table}", $1::jsonb)`, [JSON.stringify(copy)]),
      )
      await expect(attempt).rejects.toMatchObject({ code: '42501' })
    })

    it('reads nothing without a context, and nothing as anonymous', async () => {
      expect(await visibleKeys(undefined, table)).toEqual([])
      expect(await visibleKeys({ access: 'anonymous' }, table)).toEqual([])
    })

    it('reads everything as an administrator and as the system', async () => {
      for (const context of [{ access: 'user', userId: ADMIN }, { access: 'system', reason: 'test' }] as RlsContext[]) {
        const visible = await visibleKeys(context, table)
        expect(visible).toEqual(expect.arrayContaining([keys[table].a, keys[table].b]))
      }
    })
  })

  describe.each(MOVABLE_TABLES)('%s', (table) => {
    it('user A cannot move a row of company A into company B', async () => {
      const attempt = asRaw(userA, (client) =>
        client.query(`UPDATE "${table}" SET "companyId" = $1 WHERE ${rowKey(table)} = $2`, [COMPANY.b, keys[table].a]),
      )
      await expect(attempt).rejects.toMatchObject({ code: '42501' })
    })
  })

  it('sets the denormalized companyId of lines and bank transactions from their parent, whatever is sent', async () => {
    await asRaw(userA, async (client) => {
      await client.query(`UPDATE "entry_lines" SET "companyId" = $1 WHERE "id" = $2`, [COMPANY.b, keys.entry_lines.a])
      await client.query(`UPDATE "bank_transactions" SET "companyId" = $1 WHERE "id" = $2`, [COMPANY.b, keys.bank_transactions.a])
      const line = await client.query(`SELECT "companyId" FROM "entry_lines" WHERE "id" = $1`, [keys.entry_lines.a])
      const transaction = await client.query(`SELECT "companyId" FROM "bank_transactions" WHERE "id" = $1`, [keys.bank_transactions.a])
      expect(line.rows[0].companyId).toBe(COMPANY.a)
      expect(transaction.rows[0].companyId).toBe(COMPANY.a)
    })
    // A line pointed at company B's entry: refused (the trigger sets B, the policy refuses B).
    const attempt = asRaw(userA, (client) =>
      client.query(`UPDATE "entry_lines" SET "accountingEntryId" = $1 WHERE "id" = $2`, [keys.accounting_entries.b, keys.entry_lines.a]),
    )
    await expect(attempt).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|23503)$/) })
  })

  it.each(['dashboard_layouts', 'sidebar_preferences'])('%s: another member of the same company never reads nor changes the row', async (table) => {
    // u-ac is a member of company a, like u-a who owns the row.
    const other: RlsContext = { access: 'user', userId: USER_AC }
    expect(await visibleKeys(other, table)).not.toContain(keys[table].a)
    await asRaw(other, async (client) => {
      const updated = await client.query(`UPDATE "${table}" SET "updatedAt" = now() WHERE "id" = $1`, [keys[table].a])
      expect(updated.rowCount).toBe(0)
    })
    // Nor create a row in another user's name.
    const attempt = asRaw(other, (client) =>
      client.query(`INSERT INTO "${table}" ("id", "userId", "companyId", "updatedAt") VALUES ('forged', $1, $2, now())`, [USER_A, COMPANY.a]),
    )
    await expect(attempt).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|23502)$/) })
  })

  it.each(['balance_sheet_config_templates', 'income_statement_config_templates'])(
    '[KLEDG-R3-AUTHZ-01] %s: a user publishes, changes nor deletes a template shared with every company',
    async (table) => {
      const columns = `("id", "name", "reportVariant", "isPublic", "companyId", "createdBy", "configData", "updatedAt")`
      const published = asRaw(userA, (client) =>
        client.query(`INSERT INTO "${table}" ${columns} VALUES ('pirate', 'Officiel', 'complete', true, NULL, $1, '{}', now())`, [USER_A]),
      )
      await expect(published).rejects.toMatchObject({ code: '42501' })
      // A template of Kledg (written by the owner here, a migration in real life) is read, never written.
      await owner.query(`INSERT INTO "${table}" ${columns} VALUES ('kledg-shared', 'Kledg', 'complete', true, NULL, NULL, '{}', now())`)
      try {
        expect(await visibleKeys(userA, table)).toContain('kledg-shared')
        await asRaw(userA, async (client) => {
          expect((await client.query(`UPDATE "${table}" SET "name" = 'Pirate' WHERE "id" = 'kledg-shared'`)).rowCount).toBe(0)
          expect((await client.query(`DELETE FROM "${table}" WHERE "id" = 'kledg-shared'`)).rowCount).toBe(0)
        })
        // Nor turns its own company's template into a shared one.
        const moved = asRaw(userA, (client) => client.query(`UPDATE "${table}" SET "companyId" = NULL, "isPublic" = true WHERE "id" = $1`, [keys[table].a]))
        await expect(moved).rejects.toMatchObject({ code: '42501' })
      } finally {
        await owner.query(`DELETE FROM "${table}" WHERE "id" = 'kledg-shared'`)
      }
    },
  )

  it('[KLEDG-R3-AUTHZ-01] migration 20261121090000 gives the templates companies published back to them, private', async () => {
    const table = 'balance_sheet_config_templates'
    const columns = `("id", "name", "reportVariant", "isPublic", "companyId", "createdBy", "configData", "updatedAt")`
    await owner.query(
      `INSERT INTO "${table}" ${columns} VALUES
         ('published-a', 'Publié par A', 'complete', true, NULL, $1, $2::jsonb, now()),
         ('published-gone', 'Société disparue', 'complete', true, NULL, $1, '{"companyId": "company-gone"}', now()),
         ('kledg-own', 'Modèle Kledg', 'complete', true, NULL, NULL, '{}', now())`,
      [USER_A, JSON.stringify({ companyId: COMPANY.a })],
    )
    try {
      const sql = readFileSync(join(process.cwd(), 'prisma/migrations/20261121090000_statement_templates_private/migration.sql'), 'utf8')
      await owner.query(sql)
      const { rows } = await owner.query<{ id: string; companyId: string | null; isPublic: boolean }>(
        `SELECT "id", "companyId", "isPublic" FROM "${table}" WHERE "id" IN ('published-a', 'published-gone', 'kledg-own') ORDER BY "id"`,
      )
      expect(rows).toEqual([
        { id: 'kledg-own', companyId: null, isPublic: true },
        { id: 'published-a', companyId: COMPANY.a, isPublic: false },
        { id: 'published-gone', companyId: null, isPublic: false },
      ])
      // Company B no longer sees what A had published.
      expect(await visibleKeys({ access: 'user', userId: USER_B }, table)).not.toContain('published-a')
      expect(await visibleKeys({ access: 'user', userId: USER_B }, table)).not.toContain('published-gone')
    } finally {
      await owner.query(`DELETE FROM "${table}" WHERE "id" IN ('published-a', 'published-gone', 'kledg-own')`)
    }
  })

  it('narrows a user to the scope, never beyond their memberships', async () => {
    const all = await visibleKeys({ access: 'user', userId: USER_AC }, 'companies')
    expect(all.sort()).toEqual([COMPANY.a, COMPANY.c])
    const scoped = await visibleKeys({ access: 'user', userId: USER_AC, companyIds: [COMPANY.a] }, 'companies')
    expect(scoped).toEqual([COMPANY.a])
    const widened = await visibleKeys({ access: 'user', userId: USER_AC, companyIds: [COMPANY.a, COMPANY.b] }, 'companies')
    expect(widened).toEqual([COMPANY.a])
    expect(await visibleKeys({ access: 'user', userId: USER_AC, companyIds: [] }, 'companies')).toEqual([])
  })

  it('narrows administrators and system contexts to their scope', async () => {
    expect(await visibleKeys({ access: 'user', userId: ADMIN, companyIds: [COMPANY.b] }, 'accounting_entries')).toEqual([
      keys.accounting_entries.b,
    ])
    expect(await visibleKeys({ access: 'system', reason: 'test', companyIds: [COMPANY.a] }, 'entry_lines')).toEqual(
      expect.not.arrayContaining([keys.entry_lines.b]),
    )
  })

  it('gives a banned user and an unknown user nothing', async () => {
    expect(await visibleKeys({ access: 'user', userId: BANNED }, 'companies')).toEqual([])
    expect(await visibleKeys({ access: 'user', userId: 'nobody' }, 'companies')).toEqual([])
  })

  it('takes administrator status from the database, not from the context', async () => {
    // A user id with role admin in the context settings is not enough: u-a is not an administrator.
    expect(await visibleKeys({ access: 'user', userId: USER_A }, 'companies')).toEqual([COMPANY.a])
  })

  it('fails closed on a malformed scope', async () => {
    const attempt = asRaw(undefined, async (client) => {
      await client.query(`SELECT set_config('kledg.access', 'system', true), set_config('kledg.company_scope', 'not an array', true)`)
      return client.query('SELECT 1 FROM "companies"')
    })
    await expect(attempt).rejects.toMatchObject({ code: '22P02' })
  })

  it('lets every role through while the policies are switched off (existing installs)', async () => {
    await owner.query(enforcedStatement(false))
    try {
      expect((await visibleKeys(undefined, 'companies')).length).toBe(3)
    } finally {
      await owner.query(enforcedStatement(true))
    }
    expect(await visibleKeys(undefined, 'companies')).toEqual([])
  })

  describe('through Prisma', () => {
    it('reads only company A as user A, with model calls, raw SQL and transactions', async () => {
      await withUserContext(USER_A, async () => {
        const entries = await prisma.accountingEntry.findMany({ select: { companyId: true } })
        expect(entries.map((e) => e.companyId)).toEqual([COMPANY.a])
        expect(await prisma.accountingEntry.findUnique({ where: { id: keys.accounting_entries.b } })).toBeNull()
        const raw = await prisma.$queryRaw<{ id: string }[]>`SELECT "id" FROM "entry_lines"`
        expect(raw.map((r) => r.id).sort()).toEqual(['a-entry-line-2', keys.entry_lines.a])
        const inTransaction = await prisma.$transaction(async (tx) => tx.bankTransaction.count())
        expect(inTransaction).toBe(2)
        const batch = await prisma.$transaction([prisma.journal.count(), prisma.company.count()])
        expect(batch).toEqual([1, 1])
      })
    })

    it('writes nothing into company B as user A', async () => {
      await withUserContext(USER_A, async () => {
        const updated = await prisma.journal.updateMany({ where: { id: keys.journals.b }, data: { label: 'Pirate' } })
        expect(updated.count).toBe(0)
        const deleted = await prisma.transactionRule.deleteMany({ where: { companyId: COMPANY.b } })
        expect(deleted.count).toBe(0)
        await expect(
          prisma.journal.create({ data: { companyId: COMPANY.b, code: 'XX', label: 'Pirate' } }),
        ).rejects.toThrow(/row-level security|42501/)
        await expect(
          prisma.$executeRaw`UPDATE "accounts" SET "label" = 'Pirate' WHERE "companyId" = ${COMPANY.b}`,
        ).resolves.toBe(0)
      })
      const journal = await withSystemContext('test', () => prisma.journal.findUnique({ where: { id: keys.journals.b } }))
      expect(journal?.label).toBe('Operations diverses')
    })

    it('reads nothing and refuses writes without a context', async () => {
      expect(await prisma.accountingEntry.findMany()).toEqual([])
      expect(await prisma.$queryRaw`SELECT "id" FROM "companies"`).toEqual([])
      await expect(prisma.journal.create({ data: { companyId: COMPANY.a, code: 'NC', label: 'Sans contexte' } })).rejects.toThrow(
        RlsContextMissingError.name === 'RlsContextMissingError' ? /without a row level security context/ : /./,
      )
      await expect(prisma.$executeRaw`DELETE FROM "journals"`).rejects.toThrow(/without a row level security context/)
      await expect(
        prisma.$transaction(async (tx) => tx.journal.create({ data: { companyId: COMPANY.a, code: 'NC', label: 'x' } })),
      ).rejects.toThrow(/without a row level security context/)
    })

    it('reads nothing as anonymous and still reaches Better Auth tables', async () => {
      await withAnonymousContext(async () => {
        expect(await prisma.company.findMany()).toEqual([])
        expect(await prisma.user.count()).toBe(5)
      })
    })

    it('keeps the context of a transaction for its whole life', async () => {
      const seen = await withUserContext(USER_A, () =>
        prisma.$transaction(async (tx) => {
          // A context entered inside the callback does not change the transaction's.
          return runWithRlsContext({ access: 'system', reason: 'test' }, () => tx.company.findMany({ select: { id: true } }))
        }),
      )
      expect(seen.map((c) => c.id)).toEqual([COMPANY.a])
    })

    it('never batches lookups of two contexts together', async () => {
      const [a, b] = await Promise.all([
        withUserContext(USER_A, () => prisma.company.findUnique({ where: { id: COMPANY.a }, select: { id: true } })),
        withUserContext(USER_B, () => prisma.company.findUnique({ where: { id: COMPANY.a }, select: { id: true } })),
      ])
      expect(a?.id).toBe(COMPANY.a)
      expect(b).toBeNull()
      const [b2, a2] = await Promise.all([
        withUserContext(USER_B, () => prisma.company.findUnique({ where: { id: COMPANY.b }, select: { id: true } })),
        withUserContext(USER_A, () => prisma.company.findUnique({ where: { id: COMPANY.b }, select: { id: true } })),
      ])
      expect(b2?.id).toBe(COMPANY.b)
      expect(a2).toBeNull()
    })
  })

  /** A no-op assignment for an UPDATE (the first column set to itself). */
  function firstColumnNoop(table: string): string {
    if (table === 'ai_access_grant_companies') return `"companyId" = "companyId"`
    if (table === 'company_onboarding') return `"dismissedAt" = "dismissedAt"`
    return `"id" = "id"`
  }
})
