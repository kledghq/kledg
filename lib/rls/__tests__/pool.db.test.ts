/**
 * The database layer of row level security (lib/rls/pool.ts) on a real
 * PostgreSQL, as the application role: each statement carries its caller's
 * context in a transaction, a transaction sends its BEGIN with the context
 * of the caller that opened it, nothing remains on the connection afterwards,
 * writes without a context are refused before they are sent, and a role that
 * bypasses the policies is refused.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const previous = await vi.hoisted(async () => {
  const before = process.env.KLEDG_RLS
  process.env.KLEDG_RLS = 'enforce'
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('rls_pool')
  return before
})

import { Pool, type PoolClient } from 'pg'
import { prepareTestDatabase, testAppDatabaseUrl, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { verifyAppRole } from '@/lib/rls/app-role'
import { currentRlsContext, withAnonymousContext, withUserContext, type RlsContext } from '@/lib/rls/context'
import { RlsConfigurationError } from '@/lib/rls/mode'
import { RlsContextMissingError, enforceRlsOnPool } from '@/lib/rls/pool'

const available = await testDatabaseAvailable()

/** Reads the context settings in a statement that touches a covered table (so it is wrapped). */
const READ_CONTEXT = `SELECT current_setting('kledg.access', true) AS access, current_setting('kledg.user_id', true) AS "userId",
  current_setting('transaction_isolation') AS isolation, (SELECT count(*)::int FROM "companies") AS companies`

type ContextRow = { access: string; userId: string; isolation: string; companies: number }

describe.skipIf(!available)('row level security: database layer', () => {
  let pool: Pool
  let ownerUrl: string

  beforeAll(async () => {
    ownerUrl = await prepareTestDatabase('rls_pool')
    pool = new Pool({ connectionString: testAppDatabaseUrl('rls_pool'), max: 1 })
    enforceRlsOnPool(pool, { capture: currentRlsContext, derive: async () => undefined, verify: verifyAppRole })
  })

  afterAll(async () => {
    await pool?.end()
    process.env.KLEDG_RLS = previous
  })

  const read = async () => (await pool.query<ContextRow>(READ_CONTEXT)).rows[0]

  it('sends the context of the caller with a statement outside a transaction, and nothing stays afterwards', async () => {
    expect(await withUserContext('u-1', read)).toMatchObject({ access: 'user', userId: 'u-1' })
    expect(await withAnonymousContext(read)).toMatchObject({ access: 'anonymous', userId: '' })
    expect(await read()).toMatchObject({ access: '', userId: '' })
    // A statement on no covered table runs as it is: nothing of the previous transactions remains.
    const plain = await pool.query<{ access: string }>(`SELECT current_setting('kledg.access', true) AS access`)
    expect(plain.rows[0].access ?? '').toBe('')
  })

  it('keeps the context captured when the statement was issued, even if the connection comes later', async () => {
    // The pool has one connection: the user's statement waits for it while another context holds it.
    const holder = await withUserContext('u-holder', () => pool.connect())
    const waiting = withUserContext('u-waiting', read)
    await new Promise((resolve) => setTimeout(resolve, 50))
    holder.release()
    expect(await waiting).toMatchObject({ access: 'user', userId: 'u-waiting' })
  })

  it('sends the BEGIN of a transaction with the context of the caller that opened it', async () => {
    const client: PoolClient = await withUserContext('u-tx', () => pool.connect())
    try {
      await client.query('BEGIN')
      const inside = await withUserContext('u-other', () => client.query<ContextRow>(READ_CONTEXT))
      expect(inside.rows[0]).toMatchObject({ access: 'user', userId: 'u-tx', isolation: 'read committed' })
      await client.query('COMMIT')
    } finally {
      client.release()
    }
  })

  it('turns SET TRANSACTION ISOLATION LEVEL into BEGIN ISOLATION LEVEL', async () => {
    const client = await withUserContext('u-iso', () => pool.connect())
    try {
      await client.query('BEGIN')
      await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
      const inside = await client.query<ContextRow>(READ_CONTEXT)
      expect(inside.rows[0]).toMatchObject({ access: 'user', userId: 'u-iso', isolation: 'serializable' })
      await client.query('COMMIT')
    } finally {
      client.release()
    }
  })

  it('sends nothing for an empty transaction', async () => {
    const client = await withUserContext('u-empty', () => pool.connect())
    try {
      await expect(client.query('BEGIN')).resolves.toMatchObject({ command: 'BEGIN' })
      await expect(client.query('COMMIT')).resolves.toMatchObject({ command: 'COMMIT' })
    } finally {
      client.release()
    }
    expect(await read()).toMatchObject({ access: '' })
  })

  it('refuses writes without a context before sending them, in and outside transactions', async () => {
    await expect(pool.query(`INSERT INTO "journals" ("id", "code", "label", "companyId") VALUES ('j', 'OD', 'x', 'c')`)).rejects.toThrow(
      RlsContextMissingError,
    )
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await expect(client.query(`DELETE FROM "journals"`)).rejects.toThrow(RlsContextMissingError)
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
    // Reads without a context run, and see no row through the policies.
    expect(await read()).toMatchObject({ companies: 0 })
  })

  it('refuses every statement when the role bypasses the policies (the owner)', async () => {
    const owner = new Pool({ connectionString: ownerUrl, max: 1 })
    enforceRlsOnPool(owner, { capture: currentRlsContext, derive: async () => undefined, verify: verifyAppRole })
    try {
      const attempt = withUserContext('u-1', () => owner.query('SELECT 1 FROM "companies"'))
      await expect(attempt).rejects.toThrow(RlsConfigurationError)
      await expect(attempt).rejects.toThrow(/owns the tables/)
      // Refused again without asking the database a second time.
      await expect(withUserContext('u-1', () => owner.query('SELECT 1'))).rejects.toThrow(RlsConfigurationError)
    } finally {
      await owner.end()
    }
  })

  it('cannot create objects in the public schema (no shadowing of the SECURITY DEFINER functions)', async () => {
    const raw = new Pool({ connectionString: testAppDatabaseUrl('rls_pool'), max: 1 })
    try {
      await expect(raw.query('CREATE TABLE public.kledg_shadow (id int)')).rejects.toThrow(/permission denied/)
      await expect(
        raw.query("CREATE FUNCTION public.kledg_rls_scope() RETURNS text[] LANGUAGE sql AS 'SELECT NULL::text[]'"),
      ).rejects.toThrow(/permission denied|must be owner|already exists/)
    } finally {
      await raw.end()
    }
  })

  it('applies the context to the callback form of pool.query too', async () => {
    const context: RlsContext = { access: 'user', userId: 'u-callback' }
    const row = await withUserContext(context.userId, () =>
      new Promise<ContextRow>((resolve, reject) =>
        pool.query<ContextRow>(READ_CONTEXT, (error: Error | undefined, result) => (error ? reject(error) : resolve(result.rows[0]))),
      ),
    )
    expect(row).toMatchObject({ access: 'user', userId: 'u-callback' })
  })
})
