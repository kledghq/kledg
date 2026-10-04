/**
 * Creates the application role of KLEDG_RLS=enforce and switches the row
 * level security policies on (docs/rls.md#roles). Run with the owner's
 * connection, the one that runs the migrations:
 *
 *   DATABASE_MIGRATION_URL=<owner url> pnpm db:rls-role -- --password <secret>
 *
 * Options:
 *   --role <name>      role to create or update (default kledg_app)
 *   --password <pwd>   its password (or KLEDG_APP_DB_PASSWORD); required to
 *                      create the role, optional to update its grants
 *   --off              switch the policies off again (every role passes),
 *                      for a rollback to a single-role install
 *
 * Idempotent: run it again after restoring a dump, or to change the password.
 * Grants cover the existing tables and, through ALTER DEFAULT PRIVILEGES, the
 * tables later migrations create.
 */

import { Client } from 'pg'
import { DEFAULT_APP_ROLE, appRoleStatements, enforcedStatement } from '../lib/rls/app-role'
import { sslConfig } from '../lib/prisma'

function ownerUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.DATABASE_MIGRATION_URL || env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL
}

async function main() {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const index = args.indexOf(`--${name}`)
    return index >= 0 ? args[index + 1] : undefined
  }
  const url = ownerUrl()
  if (!url) throw new Error('Set DATABASE_MIGRATION_URL (or DATABASE_URL_UNPOOLED) to the owner connection.')
  const connectionString = url.replace(/([?&])(sslmode|channel_binding)=[^&]*/g, '$1').replace(/[?&]+$/, '')
  const client = new Client({ connectionString, ssl: sslConfig(url) })
  await client.connect()
  try {
    if (args.includes('--off')) {
      await client.query(enforcedStatement(false))
      process.stdout.write('Row level security policies switched off: every role passes them.\n')
      return
    }
    const role = flag('role') ?? DEFAULT_APP_ROLE
    const password = flag('password') ?? process.env.KLEDG_APP_DB_PASSWORD
    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])
    if (exists.rowCount === 0 && !password) throw new Error(`The role ${role} does not exist: pass --password to create it.`)
    await client.query('BEGIN')
    for (const statement of appRoleStatements(role, password)) await client.query(statement)
    await client.query('COMMIT')
    const { rows } = await client.query<{ owner: string }>(
      "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = to_regclass('public.companies')",
    )
    process.stdout.write(
      `Role ${role} ready, policies switched on (tables owned by ${rows[0]?.owner ?? 'unknown'}).\n` +
        `Point KLEDG_DATABASE_URL (or DATABASE_URL) at ${role}, keep the owner for migrations, set KLEDG_RLS=enforce.\n`,
    )
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
