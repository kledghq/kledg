/**
 * Every table of the migrated schema has row level security with its four
 * policies, or is exempt with a reason (lib/rls/tables.ts, docs/rls.md). A
 * new table fails here until it gets its policies in a migration or an
 * exemption entry. Also checks that the integrity triggers and the access
 * functions read as the owner (SECURITY DEFINER), and that RLS is enabled
 * without FORCE (the owner, which runs the migrations, must see every row).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('rls_coverage')
})

import { Client } from 'pg'
import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { grantTestAppRole, TEST_APP_ROLE } from '@/lib/__tests__/helpers/test-db'
import { APP_CALLABLE_DEFINER_FUNCTIONS } from '@/lib/rls/app-role'
import { CHILD_TABLES, COMPANY_TABLES, DEFINER_TRIGGER_FUNCTIONS, RLS_EXEMPT_TABLES } from '@/lib/rls/tables'

const available = await testDatabaseAvailable()

const POLICIES = ['kledg_rls_delete', 'kledg_rls_insert', 'kledg_rls_select', 'kledg_rls_update']

/**
 * Tables with a companyId column that are not company scoped, with their
 * class in docs/rls.md: their policies differ on purpose (a row may have no
 * company, or also belongs to a user).
 */
const OPTIONAL_COMPANY_TABLES: Readonly<Record<string, string>> = {
  audit_logs: 'optional company (instance events)',
  persons: 'optional company (shareholders of a reachable company)',
  balance_sheet_config_templates: 'optional company (Kledg templates)',
  income_statement_config_templates: 'optional company (Kledg templates)',
  dashboard_layouts: 'company and user',
  sidebar_preferences: 'company and user',
  mcp_confirmations: 'company and user',
  mcp_pending_actions: 'company and user',
  ai_access_grant_companies: 'grant companies',
  organization: 'membership',
}

/** The rule of a company scoped table, as PostgreSQL prints it (whitespace normalized). */
const COMPANY_RULE = normalize(
  '(( SELECT kledg_rls_unrestricted() AS kledg_rls_unrestricted) OR ("companyId" = ANY (( SELECT kledg_rls_company_ids() AS kledg_rls_company_ids)::text[])))',
)

function normalize(expression: string | null): string | null {
  return expression === null ? null : expression.replace(/\s+/g, ' ').trim()
}

describe.skipIf(!available)('row level security: policy coverage', () => {
  let db: Client
  let tables: { name: string; rls: boolean; forced: boolean; policies: string[] }[]

  beforeAll(async () => {
    db = new Client({ connectionString: await prepareTestDatabase('rls_coverage') })
    await db.connect()
    // The migration history table exists in real databases (prisma migrate deploy).
    await db.query('CREATE TABLE IF NOT EXISTS "_prisma_migrations" ("id" VARCHAR(36) PRIMARY KEY)')
    const { rows } = await db.query<{ name: string; rls: boolean; forced: boolean; policies: string[] | null }>(`
      SELECT c.relname::text AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             array_agg(p.polname::text ORDER BY p.polname) FILTER (WHERE p.polname IS NOT NULL) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_policy p ON p.polrelid = c.oid
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
      ORDER BY c.relname`)
    tables = rows.map((row) => ({ ...row, policies: row.policies ?? [] }))
  })

  afterAll(async () => {
    await db?.end()
  })

  it('covers every table with RLS and its four policies, or exempts it with a reason', () => {
    const uncovered = tables
      .filter((t) => !(t.name in RLS_EXEMPT_TABLES))
      .filter((t) => !t.rls || POLICIES.some((policy) => !t.policies.includes(policy)))
      .map((t) => `${t.name} (rls ${t.rls}, policies ${t.policies.join(', ') || 'none'})`)
    expect(uncovered).toEqual([])
  })

  it('keeps the exemption list honest: each exempt table exists, has no RLS and a reason', () => {
    const names = new Set(tables.map((t) => t.name))
    for (const [table, reason] of Object.entries(RLS_EXEMPT_TABLES)) {
      expect(names.has(table), `${table} is exempt but does not exist`).toBe(true)
      expect(reason.length).toBeGreaterThan(20)
      expect(tables.find((t) => t.name === table)?.rls, `${table} is exempt but has RLS`).toBe(false)
    }
  })

  it('lists every company and child table of lib/rls/tables.ts as covered', () => {
    for (const table of [...COMPANY_TABLES, ...Object.keys(CHILD_TABLES)]) {
      expect(tables.find((t) => t.name === table)?.policies, table).toEqual(POLICIES)
    }
  })

  // KLEDG-R3-AUTHZ-05: the registry cannot miss a table, and a policy is checked for what it says.
  it('classes every table with a companyId column in lib/rls/tables.ts', async () => {
    const { rows } = await db.query<{ name: string }>(
      `SELECT DISTINCT c.table_name::text AS name FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.column_name = 'companyId' ORDER BY 1`,
    )
    const classed = new Set([...COMPANY_TABLES, ...Object.keys(CHILD_TABLES), ...Object.keys(OPTIONAL_COMPANY_TABLES)])
    expect(rows.map((r) => r.name).filter((name) => !classed.has(name))).toEqual([])
    // The other classes say why the table is not company scoped; each still exists with a companyId.
    for (const table of Object.keys(OPTIONAL_COMPANY_TABLES)) expect(rows.map((r) => r.name), table).toContain(table)
  })

  it('gives every company scoped table the canonical companyId policies', async () => {
    const { rows } = await db.query<{ table: string; policy: string; qual: string | null; check: string | null }>(
      `SELECT c.relname::text AS table, p.polname::text AS policy,
              pg_get_expr(p.polqual, p.polrelid) AS qual, pg_get_expr(p.polwithcheck, p.polrelid) AS check
       FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1)`,
      [COMPANY_TABLES.filter((t) => t !== 'companies')],
    )
    const expected: Record<string, { qual: string | null; check: string | null }> = {
      kledg_rls_select: { qual: COMPANY_RULE, check: null },
      kledg_rls_insert: { qual: null, check: COMPANY_RULE },
      kledg_rls_update: { qual: COMPANY_RULE, check: COMPANY_RULE },
      kledg_rls_delete: { qual: COMPANY_RULE, check: null },
    }
    const deviations = rows
      .filter((row) => normalize(row.qual) !== expected[row.policy]?.qual || normalize(row.check) !== expected[row.policy]?.check)
      .map((row) => `${row.table}.${row.policy}: USING ${row.qual} WITH CHECK ${row.check}`)
    expect(deviations).toEqual([])
    expect(rows.length).toBe(4 * (COMPANY_TABLES.length - 1))
  })

  it('[KLEDG-R3-AUTHZ-01] lets only an unrestricted context write a template without company', async () => {
    for (const table of ['balance_sheet_config_templates', 'income_statement_config_templates']) {
      const { rows } = await db.query<{ policy: string; qual: string | null; check: string | null }>(
        `SELECT polname::text AS policy, pg_get_expr(polqual, polrelid) AS qual, pg_get_expr(polwithcheck, polrelid) AS check
         FROM pg_policy WHERE polrelid = $1::regclass ORDER BY polname`,
        [`public.${table}`],
      )
      for (const row of rows) {
        const writes = row.policy === 'kledg_rls_select' ? [] : [row.check, row.policy === 'kledg_rls_insert' ? null : row.qual]
        for (const expression of writes.filter((e): e is string => e !== null)) {
          expect(normalize(expression), `${table}.${row.policy}`).toBe(COMPANY_RULE)
        }
      }
    }
  })

  it('enables RLS without FORCE: the owner (migrations, single-role installs) is not subject to it', () => {
    expect(tables.filter((t) => t.forced).map((t) => t.name)).toEqual([])
  })

  it('runs the integrity triggers and the access functions as the owner, with a fixed search_path', async () => {
    const functions = [
      ...DEFINER_TRIGGER_FUNCTIONS,
      'kledg_rls_unrestricted',
      'kledg_rls_company_ids',
      'kledg_company_identifier_taken',
      'kledg_group_subsidiary_ids',
    ]
    const { rows } = await db.query<{ name: string; definer: boolean; config: string[] | null }>(
      `SELECT proname AS name, prosecdef AS definer, proconfig AS config FROM pg_proc WHERE proname = ANY($1)`,
      [functions],
    )
    expect(rows.map((r) => r.name).sort()).toEqual([...functions].sort())
    for (const row of rows) {
      expect(row.definer, `${row.name} is not SECURITY DEFINER`).toBe(true)
      expect(row.config, row.name).toContain('search_path=public, pg_temp')
    }
  })

  it('[KLEDG-SEC-013] pins the search_path of every SECURITY DEFINER function to public, then pg_temp', async () => {
    // A definer function runs with the owner's rights: without pg_temp last,
    // a temporary object of the caller could shadow what it resolves.
    const { rows } = await db.query<{ name: string; config: string[] | null }>(
      `SELECT p.proname AS name, p.proconfig AS config FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prosecdef ORDER BY p.proname`,
    )
    expect(rows.length).toBeGreaterThan(DEFINER_TRIGGER_FUNCTIONS.length)
    const unsafe = rows.filter((row) => !(row.config ?? []).includes('search_path=public, pg_temp')).map((row) => row.name)
    expect(unsafe).toEqual([])
  })

  it('[KLEDG-SEC-013] lets the application role and PUBLIC execute only the SECURITY DEFINER functions the application calls', async () => {
    await grantTestAppRole(db)
    // Trigger functions cannot be called directly; the others run as the owner when called.
    const { rows } = await db.query<{ name: string; app: boolean; public: boolean }>(
      `SELECT p.proname AS name,
              has_function_privilege($1, p.oid, 'EXECUTE') AS app,
              (p.proacl IS NULL OR EXISTS (
                SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS public
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
       ORDER BY p.proname`,
      [TEST_APP_ROLE],
    )
    expect(rows.map((r) => r.name)).toContain('kledg_purge_audit_logs')
    expect(rows.filter((r) => r.app).map((r) => r.name)).toEqual([...APP_CALLABLE_DEFINER_FUNCTIONS].sort())
    expect(rows.filter((r) => r.public && !APP_CALLABLE_DEFINER_FUNCTIONS.includes(r.name)).map((r) => r.name)).toEqual([])
  })

  it('evaluates the access functions once per statement (InitPlan), not once per row', async () => {
    const { rows } = await db.query<{ qual: string }>(
      `SELECT pg_get_expr(polqual, polrelid) AS qual FROM pg_policy
       WHERE polrelid = 'public.entry_lines'::regclass AND polname = 'kledg_rls_select'`,
    )
    expect(rows[0].qual).toContain('( SELECT kledg_rls_unrestricted()')
    expect(rows[0].qual).toContain('( SELECT kledg_rls_company_ids()')
  })
})
