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
 *
 * KLEDG_RLS=enforce runs the suite under row level security (docs/rls.md):
 * the application connects as the role `kledg_app_test` (created here, not
 * the owner, no BYPASSRLS), with the policies switched on. Rows that a test
 * writes or reads directly, outside a request, go through the `system`
 * context (KLEDG_RLS_TEST_CONTEXT); route handlers, MCP tools and crons use
 * their real contexts. Raw `pg` clients of the tests keep the owner's URL
 * (returned by useTestDatabase and prepareTestDatabase).
 */

import { createHash } from 'crypto'
import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import { Client } from 'pg'
import { appRoleStatements } from '../../rls/app-role'
import { rlsMode } from '../../rls/mode'

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

/** URL of the test database `name` (see testDatabaseName), as the owner. */
export function testDatabaseUrl(name: string, env: Env = process.env): string {
  return urlFor(testDatabaseName(name, env), env)
}

/** The application role of KLEDG_RLS=enforce runs (password = name: a local test server only). */
export const TEST_APP_ROLE = 'kledg_app_test'

function rlsEnforced(env: Env = process.env): boolean {
  return rlsMode(env) === 'enforce'
}

/** URL of the test database `name` as the application role (KLEDG_RLS=enforce). */
export function testAppDatabaseUrl(name: string, env: Env = process.env): string {
  const url = new URL(testDatabaseUrl(name, env))
  url.username = TEST_APP_ROLE
  url.password = TEST_APP_ROLE
  return url.toString()
}

/** The URL the application (lib/prisma) uses for `name`: the application role under KLEDG_RLS=enforce. */
function applicationUrl(name: string, env: Env = process.env): string {
  return rlsEnforced(env) ? testAppDatabaseUrl(name, env) : testDatabaseUrl(name, env)
}

/**
 * Points DATABASE_URL at the test database `name` and returns its URL (the
 * owner's, for raw clients). Call it in vi.hoisted, before lib/prisma is
 * imported (Prisma reads DATABASE_URL when the module loads):
 *
 *   await vi.hoisted(async () => {
 *     const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
 *     useTestDatabase('closing')
 *   })
 */
export function useTestDatabase(name: string): string {
  delete process.env.KLEDG_DATABASE_URL
  process.env.DATABASE_URL = applicationUrl(name)
  if (rlsEnforced()) process.env.KLEDG_RLS_TEST_CONTEXT = 'system'
  return testDatabaseUrl(name)
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
    if (rlsEnforced()) await grantTestAppRole(client)
    const tables = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    )
    if (tables.rows.length > 0) {
      await client.query(`TRUNCATE ${tables.rows.map((r) => `"${r.tablename}"`).join(', ')} CASCADE`)
    }
  } finally {
    await client.end()
  }

  if (process.env.DATABASE_URL !== applicationUrl(name)) {
    throw new Error(`DATABASE_URL must be ${applicationUrl(name)} (call useTestDatabase('${name}') in vi.hoisted)`)
  }
  return url
}

/**
 * Creates the application role (once per server: roles are shared by the
 * databases) and grants it this database, with the policies switched on.
 * Skipped when already done. Serialized across the server: grants to one
 * role from several databases at once update the shared catalogs and fail
 * ("tuple concurrently updated").
 */
export async function grantTestAppRole(client: Client): Promise<void> {
  const ready = await client.query<{ ready: boolean }>(
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)
       THEN has_table_privilege($1, 'public.companies', 'SELECT') AND kledg_rls_enforced()
       ELSE false END AS ready`,
    [TEST_APP_ROLE],
  )
  if (ready.rows[0]?.ready) return
  const gate = await connect(urlFor('postgres'))
  try {
    await gate.query('SELECT pg_advisory_lock(hashtext($1))', ['kledg:test-db-app-role'])
    // The password is set at creation only.
    const [create] = appRoleStatements(TEST_APP_ROLE, TEST_APP_ROLE)
    const [, ...grants] = appRoleStatements(TEST_APP_ROLE)
    await client.query(create)
    for (const statement of grants) await client.query(statement)
  } finally {
    await gate.end()
  }
}

/**
 * Runs `sql` as the owner of the test database `name`: the role of the
 * migrations, as `prisma migrate deploy` would. Migration tests replay their
 * migration with it (DDL, data migrations, catalog reads that only show the
 * owner's tables); the application role cannot (KLEDG_RLS=enforce).
 */
export async function queryAsOwner<T extends Record<string, unknown> = Record<string, unknown>>(
  name: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await connect(testDatabaseUrl(name))
  try {
    return (await client.query<T>(sql, params)).rows
  } finally {
    await client.end()
  }
}
