/**
 * PostgreSQL databases for integration tests (`*.db.test.ts`, authorization
 * matrix, setup race). They run against a local server, by default the
 * kledg-verify-db container (port 55432): KLEDG_TEST_DATABASE_URL points to
 * its base URL. Tests are skipped when the server is unreachable.
 *
 * Each test file gets its own database, `<prefix>_<name>`, created and
 * migrated from prisma/migrations on first use, then emptied before the
 * tests. The prefix is KLEDG_TEST_DB_PREFIX, `kledg_test` by default: give
 * each parallel run (CI job, agent, second checkout) its own prefix so two
 * runs never empty each other's database.
 *
 * KLEDG_REQUIRE_TEST_DB=true (set in CI) turns the skip into a failure: a
 * run that expects the database never passes silently without it.
 */

import { createHash } from 'crypto'
import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import { Client } from 'pg'

const DEFAULT_BASE_URL = 'postgresql://kledg:kledg@localhost:55432/kledg_test'
export const DEFAULT_TEST_DB_PREFIX = 'kledg_test'

/** PostgreSQL identifiers stop at 63 bytes; longer names are silently truncated and could collide. */
const MAX_IDENTIFIER_LENGTH = 63
const IDENTIFIER = /^[a-z][a-z0-9_]*$/

type Env = Record<string, string | undefined>

/** Prefix of the test databases of this run: KLEDG_TEST_DB_PREFIX or `kledg_test`. */
export function testDatabasePrefix(env: Env = process.env): string {
  const prefix = env.KLEDG_TEST_DB_PREFIX?.trim() || DEFAULT_TEST_DB_PREFIX
  if (!IDENTIFIER.test(prefix)) {
    throw new Error(`Invalid KLEDG_TEST_DB_PREFIX "${prefix}": lowercase letters, digits and _, starting with a letter`)
  }
  return prefix
}

/** Database name of a test file: `<prefix>_<name>` (`kledg_test_closing` by default). */
export function testDatabaseName(name: string, env: Env = process.env): string {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Invalid test database name: ${name}`)
  const database = `${testDatabasePrefix(env)}_${name}`
  if (database.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`Test database name too long (${database.length} > ${MAX_IDENTIFIER_LENGTH}): ${database}`)
  }
  return database
}

function urlFor(database: string, env: Env = process.env): string {
  const url = new URL(env.KLEDG_TEST_DATABASE_URL ?? DEFAULT_BASE_URL)
  url.pathname = `/${database}`
  return url.toString()
}

/** URL of the test database `name` (see testDatabaseName). */
export function testDatabaseUrl(name: string, env: Env = process.env): string {
  return urlFor(testDatabaseName(name, env), env)
}

/**
 * Points DATABASE_URL at the test database `name` and returns its URL. Call
 * it in vi.hoisted, before lib/prisma is imported (Prisma reads DATABASE_URL
 * when the module loads):
 *
 *   await vi.hoisted(async () => {
 *     const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
 *     useTestDatabase('closing')
 *   })
 */
export function useTestDatabase(name: string): string {
  const url = testDatabaseUrl(name)
  process.env.DATABASE_URL = url
  return url
}

async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 })
  await client.connect()
  return client
}

/** Whether this run must reach the test database (KLEDG_REQUIRE_TEST_DB=true or 1, set in CI). */
export function testDatabaseRequired(env: Env = process.env): boolean {
  return ['true', '1'].includes(env.KLEDG_REQUIRE_TEST_DB?.trim().toLowerCase() ?? '')
}

/**
 * Whether the test PostgreSQL server answers. Database tests are skipped when
 * it does not, unless KLEDG_REQUIRE_TEST_DB=true: then the test file fails.
 */
export async function testDatabaseAvailable(env: Env = process.env): Promise<boolean> {
  try {
    const client = await connect(urlFor('postgres', env))
    await client.end()
    return true
  } catch (error) {
    if (!testDatabaseRequired(env)) return false
    const url = new URL(env.KLEDG_TEST_DATABASE_URL ?? DEFAULT_BASE_URL)
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `KLEDG_REQUIRE_TEST_DB is set but the test PostgreSQL server at ${url.hostname}:${url.port || '5432'} does not answer (${reason}). ` +
        'Start it or set KLEDG_TEST_DATABASE_URL; database tests are not skipped in this run.',
    )
  }
}

function migrationsSql(): string[] {
  const dir = path.resolve(__dirname, '../../../prisma/migrations')
  return readdirSync(dir)
    .filter((name) => /^\d+_/.test(name))
    .sort()
    .map((name) => readFileSync(path.join(dir, name, 'migration.sql'), 'utf8'))
}

/**
 * Creates (if needed), migrates and empties the test database `name`. Call in
 * beforeAll, before the first Prisma query; DATABASE_URL must already point
 * at it (useTestDatabase in vi.hoisted: Prisma reads it when lib/prisma loads).
 */
export async function prepareTestDatabase(name: string): Promise<string> {
  const database = testDatabaseName(name)

  const admin = await connect(urlFor('postgres'))
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${database}"`)
  } finally {
    await admin.end()
  }

  const url = urlFor(database)
  const client = await connect(url)
  try {
    // The schema comment holds a hash of the migrations it was built from:
    // a new or changed migration rebuilds the test database.
    const migrations = migrationsSql()
    const hash = createHash('sha256').update(migrations.join('\n-- next migration --\n')).digest('hex')
    const built = await client.query<{ hash: string | null }>("SELECT obj_description('public'::regnamespace, 'pg_namespace') AS hash")
    if (built.rows[0]?.hash !== hash) {
      // One rebuild at a time across the whole server: after a new migration
      // every test file rebuilds its database at once, and that many
      // DROP SCHEMA ... CASCADE in parallel exhaust the lock table ("out of
      // shared memory"). Advisory locks are per database, so the lock is
      // taken in the shared `postgres` database.
      const gate = await connect(urlFor('postgres'))
      try {
        await gate.query('SELECT pg_advisory_lock(hashtext($1))', ['kledg:test-db-rebuild'])
        await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
        for (const sql of migrations) await client.query(sql)
        await client.query(`COMMENT ON SCHEMA public IS '${hash}'`)
      } finally {
        await gate.end()
      }
    }
    const tables = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    )
    if (tables.rows.length > 0) {
      await client.query(`TRUNCATE ${tables.rows.map((r) => `"${r.tablename}"`).join(', ')} CASCADE`)
    }
  } finally {
    await client.end()
  }

  if (process.env.DATABASE_URL !== url) {
    throw new Error(`DATABASE_URL must be ${url} (call useTestDatabase('${name}') in vi.hoisted)`)
  }
  return url
}
