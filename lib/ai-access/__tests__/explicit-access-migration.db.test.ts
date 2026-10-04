/**
 * Migration 20261011120000_explicit_ai_access: connections made before the
 * code failed closed keep exactly what they had, written down. Legacy rows
 * are inserted, then the migration is run again (it is idempotent).
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { Client } from 'pg'

const url = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  return useTestDatabase('explicit_access_migration')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { apiKeyLevelOf } from '@/lib/ai-access/access'

const available = await testDatabaseAvailable()

const SQL = readFileSync(
  path.resolve(__dirname, '../../../prisma/migrations/20261011120000_explicit_ai_access/migration.sql'),
  'utf8',
)

describe.skipIf(!available)('explicit AI access migration', () => {
  let db: Client

  beforeAll(async () => {
    await prepareTestDatabase('explicit_access_migration')
    db = new Client({ connectionString: url })
    await db.connect()
  }, 60_000)

  afterAll(async () => {
    await db?.end()
  })

  it('gives legacy consents and keys an explicit every-company grant and their write level', async () => {
    await db.query(`INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES ('u1', 'U', 'u1@test.local', true, now(), now())`)
    await db.query(`INSERT INTO "oauthClient" ("id", "clientId", "redirectUris") VALUES ('oc1', 'client-1', ARRAY['https://a.example/cb'])`)
    await db.query(`INSERT INTO "oauthConsent" ("id", "clientId", "userId", "scopes", "createdAt", "updatedAt") VALUES ('c1', 'client-1', 'u1', ARRAY['kledg:read'], now(), now())`)
    const key = (id: string, permissions: string | null) =>
      db.query(`INSERT INTO "apikey" ("id", "referenceId", "key", "createdAt", "updatedAt", "permissions") VALUES ($1, 'u1', $1, now(), now(), $2)`, [id, permissions])
    await key('k-none', null)
    await key('k-garbage', 'not json')
    await key('k-read', '{"kledg":["read"]}')
    await key('k-other', '{"other":["x"]}')

    await db.query(SQL)
    await db.query(SQL) // idempotent

    const grants = await db.query<{ clientId: string | null; apiKeyId: string | null; allCompanies: boolean }>(
      `SELECT "clientId", "apiKeyId", "allCompanies" FROM "ai_access_grants" ORDER BY "clientId", "apiKeyId"`,
    )
    expect(grants.rows).toHaveLength(5)
    expect(grants.rows.every((g) => g.allCompanies)).toBe(true)
    expect(grants.rows.filter((g) => g.clientId === 'client-1')).toHaveLength(1)

    const levels = await db.query<{ id: string; permissions: string }>(`SELECT "id", "permissions" FROM "apikey" ORDER BY "id"`)
    const level = Object.fromEntries(levels.rows.map((r) => [r.id, apiKeyLevelOf(JSON.parse(r.permissions))]))
    expect(level).toEqual({ 'k-garbage': 'write', 'k-none': 'write', 'k-other': 'write', 'k-read': 'read' })
    expect(JSON.parse(levels.rows.find((r) => r.id === 'k-other')!.permissions)).toMatchObject({ other: ['x'] })
  })
})
