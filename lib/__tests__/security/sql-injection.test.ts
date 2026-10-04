/**
 * SQL injection guard.
 *
 * Kledg reaches raw SQL only through Prisma tagged templates ($queryRaw /
 * $executeRaw) and Prisma.sql fragments, where every interpolated value is a
 * bind parameter. The *Unsafe variants and Prisma.raw concatenate strings and
 * must never appear in production code. This static scan fails the build if a
 * future change introduces one, which is the durable defence: a parameterised
 * query cannot be injected regardless of the input probed.
 *
 * The runtime proof that user input stays parameterised (metacharacters in
 * search/filter params never alter scoping) is in the authorization matrix and
 * the list/report DB tests, which run these queries against real PostgreSQL.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const SCANNED = ['lib', 'app']
const SKIP_DIRS = new Set(['__tests__', 'node_modules', '.next', 'dist'])

/** Raw-SQL escape hatches that bypass parameterisation. */
const FORBIDDEN = [/\$queryRawUnsafe\b/, /\$executeRawUnsafe\b/, /\bPrisma\.raw\s*\(/]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const s = statSync(full)
    if (s.isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...walk(full))
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) {
      out.push(full)
    }
  }
  return out
}

const files = SCANNED.flatMap((d) => walk(join(ROOT, d)))

describe('SQL injection: no unparameterised raw SQL in production code', () => {
  it('scans a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(300)
  })

  it.each(FORBIDDEN.map((re) => [re.source, re] as const))('no production file uses %s', (_src, re) => {
    const offenders = files.filter((f) => re.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f))
    expect(offenders, `raw-SQL escape hatch found in:\n${offenders.join('\n')}`).toEqual([])
  })
})
