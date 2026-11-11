/**
 * Every foreign key of the schema has an index that starts with its
 * column, so deleting a parent row (an account whose children are set to
 * null, a company and its cascades, a user) never scans the whole
 * referencing table once per deleted row. Without them, deleting one demo
 * sandbox took over a minute (kledghq/kledg#27, migration
 * 20261204090000_index_foreign_keys). Skipped when the test database server
 * is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'

const url = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  return useTestDatabase('foreign_key_indexes')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

describe.skipIf(!available)('foreign key indexes', () => {
  let db: Client

  beforeAll(async () => {
    await prepareTestDatabase('foreign_key_indexes')
    db = new Client({ connectionString: url })
    await db.connect()
  }, 60_000)

  afterAll(async () => {
    await db?.end()
  })

  it('indexes the first column of every foreign key', async () => {
    const { rows } = await db.query<{ fk: string }>(`
      SELECT c.conrelid::regclass || '.' || a.attname AS fk
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_namespace n ON n.oid = (SELECT relnamespace FROM pg_class WHERE oid = c.conrelid)
      WHERE c.contype = 'f' AND n.nspname = 'public'
        AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])
      ORDER BY 1`)
    expect(rows.map((r) => r.fk)).toEqual([])
  })
})
