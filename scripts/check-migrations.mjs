#!/usr/bin/env node
/**
 * Migration policy check (docs/self-hosting.md#migrations-de-la-base).
 *
 * Against the latest release tag (v*):
 * - released migrations are immutable: a migration folder that shipped in a
 *   release must not be edited or deleted;
 * - new migrations are additive: DROP TABLE, DROP COLUMN, RENAME and column
 *   type changes are refused unless the file explains itself with a
 *   `-- kledg:allow-destructive <reason>` comment (the "contract" step of an
 *   expand/contract change, once no released version uses the column).
 *
 * Before the first release there is no tag and only the destructive check runs.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'prisma/migrations'
const ALLOW = /--\s*kledg:allow-destructive\s+\S/

const DESTRUCTIVE = [
  [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
  [/\bDROP\s+COLUMN\b/i, 'DROP COLUMN'],
  [/\bRENAME\b/i, 'RENAME'],
  [/\bALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE\b/i, 'column type change'],
  [/\bDROP\s+TYPE\b/i, 'DROP TYPE'],
  [/\bTRUNCATE\b/i, 'TRUNCATE'],
]

function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

const tag = process.env.KLEDG_BASE_REF || git('describe', '--tags', '--abbrev=0', '--match', 'v*')
const released = new Set(
  tag
    ? git('ls-tree', '--name-only', `${tag}:${DIR}`).split('\n').filter((name) => name && name !== 'migration_lock.toml')
    : [],
)

const errors = []
const current = existsSync(DIR)
  ? readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : []

for (const name of released) {
  if (!current.includes(name)) {
    errors.push(`${name}: released in ${tag} but deleted`)
    continue
  }
  const before = git('show', `${tag}:${DIR}/${name}/migration.sql`)
  const now = readFileSync(join(DIR, name, 'migration.sql'), 'utf8').trim()
  if (before !== now) errors.push(`${name}: released in ${tag} but edited; add a new migration instead`)
}

for (const name of current.filter((n) => !released.has(n))) {
  const sql = readFileSync(join(DIR, name, 'migration.sql'), 'utf8')
  if (ALLOW.test(sql)) continue
  const code = sql.replace(/--.*$/gm, '')
  for (const [pattern, label] of DESTRUCTIVE) {
    if (pattern.test(code)) {
      errors.push(`${name}: ${label} in a new migration (add "-- kledg:allow-destructive <reason>" if intended)`)
    }
  }
}

if (errors.length) {
  console.error(`Migration policy violations${tag ? ` (base ${tag})` : ''}:\n- ${errors.join('\n- ')}`)
  process.exit(1)
}
console.log(`Migrations OK: ${current.length} total, ${released.size} released${tag ? ` in ${tag}` : ' (no release yet)'}.`)
