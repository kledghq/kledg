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
import { CHILD_TABLES, COMPANY_TABLES, DEFINER_TRIGGER_FUNCTIONS, RLS_EXEMPT_TABLES } from '@/lib/rls/tables'

const available = await testDatabaseAvailable()

const POLICIES = ['kledg_rls_delete', 'kledg_rls_insert', 'kledg_rls_select', 'kledg_rls_update']

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

  it('enables RLS without FORCE: the owner (migrations, single-role installs) is not subject to it', () => {
    expect(tables.filter((t) => t.forced).map((t) => t.name)).toEqual([])
  })

  it('runs the integrity triggers and the access functions as the owner, with a fixed search_path', async () => {
    const functions = [
      ...DEFINER_TRIGGER_FUNCTIONS,
      'kledg_rls_unrestricted',
      'kledg_rls_company_ids',
      'kledg_company_identifier_taken',
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

  it('evaluates the access functions once per statement (InitPlan), not once per row', async () => {
    const { rows } = await db.query<{ qual: string }>(
      `SELECT pg_get_expr(polqual, polrelid) AS qual FROM pg_policy
       WHERE polrelid = 'public.entry_lines'::regclass AND polname = 'kledg_rls_select'`,
    )
    expect(rows[0].qual).toContain('( SELECT kledg_rls_unrestricted()')
    expect(rows[0].qual).toContain('( SELECT kledg_rls_company_ids()')
  })
})
