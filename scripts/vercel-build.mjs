#!/usr/bin/env node
/**
 * Vercel build (package.json "vercel-build"): apply the migrations, then
 * build Next.js.
 *
 * The Neon integration gives its connection variables to the production
 * environment. A preview deployment (the pull request of an update, for
 * instance) usually has none: `prisma migrate deploy` then stops on "Connection
 * url is empty" and the update looks broken before it is even merged. Without
 * any database URL, a preview skips the migrations and still builds, so it
 * checks that the update compiles; production keeps failing loudly, since it
 * cannot run without its database. A preview that has its own database (a
 * Neon branch per preview) is migrated as before.
 */

import { spawnSync } from 'node:child_process'

/** Same variables, in the same order, as prisma.config.ts. */
const DATABASE_VARIABLES = [
  'DATABASE_MIGRATION_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRESQL_ADDON_URI',
]

/** @param {Record<string, string | undefined>} env */
export function shouldMigrate(env = process.env) {
  const hasDatabase = DATABASE_VARIABLES.some((name) => env[name]?.trim())
  return hasDatabase || env.VERCEL_ENV === 'production'
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error) console.error(`${command}: ${result.error.message} (run through \`pnpm run vercel-build\`)`)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (shouldMigrate()) {
    run('prisma', ['migrate', 'deploy'])
  } else {
    console.log(
      `No database URL for this ${process.env.VERCEL_ENV ?? 'unknown'} deployment: migrations skipped, building only. ` +
        'The pages that read the database need the production deployment.',
    )
  }
  run('next', ['build'])
}
