/**
 * The system context (every company, no user) is used only in the places
 * documented in docs/rls.md, each with its reason. A new use needs an entry
 * here and in the documentation: a request acting for a user must never run
 * as the system.
 */

import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../../..')
const SCANNED = ['app', 'lib', 'components', 'hooks', 'scripts', 'prisma', 'proxy.ts']

/** File -> the reasons it may use. */
const ALLOWED: Record<string, string[]> = {
  // Definition.
  'lib/rls/context.ts': [],
  // The daily bank sync (CRON_SECRET): lists the integrations, then syncs each company narrowed to it.
  'lib/banking/sync-banks.service.ts': ['cron:bank-sync'],
  // The daily automatic period closing (CRON_SECRET): lists the companies in monthly mode, then locks each one narrowed to it.
  'lib/accounting/period-lock/auto-lock.service.ts': ['cron:period-lock'],
  // A company created by a user the instance policy allows: it has no member yet, and its organization and membership are system writes.
  'lib/companies/create-company.service.ts': ['company-creation'],
  // Re-encryption after a rotation of the auth secret: every company's sealed credentials, at server start.
  'lib/crypto/reencrypt.ts': ['secret-rotation'],
  // Update history at server start: reads the instance's UPDATES_MERGE audit rows (no company) to attribute a new version.
  'lib/updates/history.ts': ['version-history'],
  // Invitation page: finds the invitation by the hash of its token (the invitee is not a member yet), then creates the membership.
  'lib/rbac/company-invitations.service.ts': ['invitation-acceptance'],
}

function files(entry: string): string[] {
  const full = path.join(ROOT, entry)
  if (statSync(full).isFile()) return [entry]
  return readdirSync(full).flatMap((name) => {
    if (name === 'node_modules' || name === '__tests__' || name === 'generated' || name.startsWith('.')) return []
    const child = path.join(entry, name)
    if (statSync(path.join(ROOT, child)).isDirectory()) return files(child)
    return /\.(ts|tsx|mts|mjs)$/.test(name) && !/\.(test|perf)\.tsx?$/.test(name) ? [child] : []
  })
}

describe('system context usage', () => {
  const uses = SCANNED.flatMap(files)
    .map((file) => ({ file, source: readFileSync(path.join(ROOT, file), 'utf8') }))
    .filter(({ source }) => /withSystemContext\s*\(/.test(source) || /access:\s*'system'/.test(source))

  it('is limited to the documented files', () => {
    expect(uses.map((u) => u.file).sort()).toEqual(
      [...Object.keys(ALLOWED), 'lib/rls/request-context.ts'].sort(),
    )
  })

  it('uses only the reasons documented for each file', () => {
    for (const { file, source } of uses) {
      const reasons = [...source.matchAll(/withSystemContext\(\s*'([^']+)'/g)].map((m) => m[1])
      for (const reason of reasons) expect(ALLOWED[file], `${file} uses ${reason}`).toContain(reason)
    }
  })

  it('documents every allowed use in docs/rls.md', () => {
    const doc = readFileSync(path.join(ROOT, 'docs/rls.md'), 'utf8')
    for (const [file, reasons] of Object.entries(ALLOWED)) {
      if (reasons.length === 0) continue
      expect(doc, file).toContain(file)
      for (const reason of reasons) expect(doc, reason).toContain(reason)
    }
  })
})
