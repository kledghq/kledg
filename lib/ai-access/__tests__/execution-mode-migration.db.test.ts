/**
 * Migration 20261012090000_ai_execution_mode: the grants that existed before
 * it (assistants and API keys) become 'automatic' (owner decision,
 * 2026-10-04), new grants default to it, and only the two modes are stored.
 * The column is removed first to stand for a database before the migration,
 * then the migration is run (twice: it is idempotent).
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { Client } from 'pg'

const url = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  return useTestDatabase('execution_mode_migration')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

const SQL = readFileSync(
  path.resolve(__dirname, '../../../prisma/migrations/20261012090000_ai_execution_mode/migration.sql'),
  'utf8',
)

describe.skipIf(!available)('AI execution mode migration', () => {
  let db: Client

  beforeAll(async () => {
    await prepareTestDatabase('execution_mode_migration')
    db = new Client({ connectionString: url })
    await db.connect()
  }, 60_000)

  afterAll(async () => {
    // Leave the schema as the migrations make it for the next run of this file.
    await db?.query(SQL).catch(() => undefined)
    await db?.end()
  })

  it('makes existing assistant and API key grants automatic, and new ones too', async () => {
    // The database as it was before the migration.
    await db.query(`ALTER TABLE "ai_access_grants" DROP CONSTRAINT IF EXISTS "ai_access_grants_execution_mode_check"`)
    await db.query(`ALTER TABLE "ai_access_grants" DROP COLUMN IF EXISTS "executionMode"`)

    await db.query(`INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES ('u1', 'U', 'u1@test.local', true, now(), now())`)
    await db.query(`INSERT INTO "oauthClient" ("id", "clientId", "redirectUris") VALUES ('oc1', 'client-1', ARRAY['https://a.example/cb'])`)
    await db.query(`INSERT INTO "apikey" ("id", "referenceId", "key", "createdAt", "updatedAt", "permissions") VALUES ('k1', 'u1', 'k1', now(), now(), '{"kledg":["read","write","admin"]}')`)
    await db.query(`INSERT INTO "ai_access_grants" ("id", "userId", "clientId", "allCompanies", "updatedAt") VALUES ('g-oauth', 'u1', 'client-1', true, now())`)
    await db.query(`INSERT INTO "ai_access_grants" ("id", "userId", "apiKeyId", "allCompanies", "updatedAt") VALUES ('g-key', 'u1', 'k1', false, now())`)

    await db.query(SQL)
    await db.query(SQL) // idempotent

    const rows = await db.query<{ id: string; executionMode: string }>(`SELECT "id", "executionMode" FROM "ai_access_grants" ORDER BY "id"`)
    expect(rows.rows).toEqual([
      { id: 'g-key', executionMode: 'automatic' },
      { id: 'g-oauth', executionMode: 'automatic' },
    ])

    await db.query(`DELETE FROM "ai_access_grants"`)
    await db.query(`INSERT INTO "ai_access_grants" ("id", "userId", "apiKeyId", "updatedAt") VALUES ('g-new', 'u1', 'k1', now())`)
    expect((await db.query(`SELECT "executionMode" FROM "ai_access_grants" WHERE "id" = 'g-new'`)).rows[0]).toEqual({ executionMode: 'automatic' })
    await db.query(`UPDATE "ai_access_grants" SET "executionMode" = 'validation' WHERE "id" = 'g-new'`)
    await expect(db.query(`UPDATE "ai_access_grants" SET "executionMode" = 'yolo' WHERE "id" = 'g-new'`)).rejects.toThrow(/execution_mode_check/)
  })
})
