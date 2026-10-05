/**
 * Rate limit policy (lib/rate-limit.ts): one registry, applied the same way
 * everywhere, and present on every route that calls a third party, parses
 * an upload, generates a document or manages accounts.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ count: 0, keys: [] as string[] }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, _id: string, key: string) => {
      db.keys.push(key)
      return [{ count: ++db.count }]
    }),
  },
}))

import { RateLimitError } from '@/lib/accounting/errors'
import { enforceRateLimit, RATE_LIMIT_RULES, RATE_LIMITS, withinRateLimit } from '@/lib/rate-limit'
import { INSTANCE_RATE_LIMITS } from '@/lib/instance/policy'

const ROOT = path.resolve(__dirname, '../..')

describe('rate limit policy', () => {
  const saved = process.env.RATE_LIMIT_DISABLED

  beforeEach(() => {
    db.count = 0
    db.keys = []
    delete process.env.RATE_LIMIT_DISABLED
  })

  afterEach(() => {
    if (saved === undefined) delete process.env.RATE_LIMIT_DISABLED
    else process.env.RATE_LIMIT_DISABLED = saved
  })

  it('counts per rule and subject, and refuses past the maximum with the French message', async () => {
    const { max, message } = RATE_LIMITS['siren-lookup']
    for (let i = 0; i < max; i++) await enforceRateLimit('siren-lookup', 'u1')
    await expect(enforceRateLimit('siren-lookup', 'u1')).rejects.toEqual(new RateLimitError(message))
    expect(new Set(db.keys)).toEqual(new Set(['siren-lookup|u1']))
  })

  it('is turned off by RATE_LIMIT_DISABLED=true, without touching the table', async () => {
    process.env.RATE_LIMIT_DISABLED = 'true'
    expect(await withinRateLimit('setup', '203.0.113.7')).toBe(true)
    await enforceRateLimit('export', 'u1')
    expect(db.keys).toEqual([])
  })

  it('includes the rules of the instance policy (none in Kledg), never in place of a Kledg rule', () => {
    expect(RATE_LIMIT_RULES).toEqual({ ...INSTANCE_RATE_LIMITS, ...RATE_LIMITS })
  })

  it('has a positive window, a maximum and a French message without dashes for every rule', () => {
    for (const [name, rule] of Object.entries(RATE_LIMIT_RULES)) {
      expect(rule.window, name).toBeGreaterThan(0)
      expect(rule.max, name).toBeGreaterThan(0)
      expect(rule.message, name).toMatch(/^[A-Z]/)
      expect(rule.message, name).not.toMatch(/[–—]/)
    }
  })
})

/**
 * Routes that call a bank or GitHub, parse an uploaded file, generate a
 * document or change accounts, with the guard they must call
 * (docs/conventions.md#security).
 */
const LIMITED_ROUTES: Record<string, RegExp> = {
  'app/api/companies/lookup/route.ts': /enforceRateLimit\('siren-lookup'/,
  'app/api/fec/route.ts': /enforceRateLimit\('export'/,
  'app/api/reports/journal/export-excel/route.ts': /enforceRateLimit\('export'/,
  'app/api/reports/aged-balance/export-excel/route.ts': /enforceRateLimit\('export'/,
  'app/api/reports/financial-indicators/export/route.ts': /enforceRateLimit\('export'/,
  'app/api/cash-forecast/export/route.ts': /enforceRateLimit\('export'/,
  'app/api/companies/[id]/vat-returns/export/route.ts': /enforceRateLimit\('export'/,
  'app/api/companies/[id]/corporate-tax/export/route.ts': /enforceRateLimit\('export'/,
  'app/api/companies/[id]/local-taxes/export/route.ts': /enforceRateLimit\('export'/,
  'app/api/companies/[id]/training-report/export/route.ts': /enforceRateLimit\('export'/,
  'app/api/group/export/route.ts': /enforceRateLimit\('export'/,
  'app/api/reports/auxiliary-balance/export-excel/route.ts': /enforceRateLimit\('export'/,
  'app/api/companies/[id]/balance-sheet/export-excel/route.ts': /enforceRateLimit\('export'/,
  'app/api/companies/[id]/income-statement/export-excel/route.ts': /enforceRateLimit\('export'/,
  'app/api/companies/[id]/balance-sheet/export-pdf/route.ts': /enforceRateLimit\('export'/,
  'app/api/companies/[id]/income-statement/export-pdf/route.ts': /enforceRateLimit\('export'/,
  'app/api/companies/[id]/fiscal-years/[fiscalYearId]/approval/documents/[document]/route.ts': /enforceRateLimit\('export'/,
  'app/api/import/route.ts': /enforceRateLimit\('import'/,
  'app/api/import/preview-fiscal-years/route.ts': /enforceRateLimit\('import'/,
  'app/api/banking/import-statement/route.ts': /enforceRateLimit\('import'/,
  'app/api/banking/connections/[id]/refresh/route.ts': /limitBankCalls\(/,
  'app/api/banking/revolut/route.ts': /guardBankConnect\(/,
  'app/api/banking/revolut/authorize/route.ts': /guardBankConnect\(/,
  'app/api/banking/ponto/route.ts': /guardBankConnect\(/,
  'app/api/banking/attachments/sync/route.ts': /limitBankCalls\(/,
  'app/api/integrations/sync/route.ts': /limitBankCalls\(/,
  'app/api/integrations/[id]/sync/route.ts': /limitBankCalls\(/,
  'app/api/integrations/verify/route.ts': /guardBankConnect\(/,
  'app/api/integrations/route.ts': /guardBankConnect\(/,
  'app/api/tasks/refresh/route.ts': /limitBankCalls\(/,
  'app/api/qonto/accounts/route.ts': /limitBankCalls\(/,
  'app/api/qonto/connect/route.ts': /guardBankConnect\(/,
  'app/api/qonto/statements/route.ts': /limitBankCalls\(/,
  'app/api/qonto/test-connection/route.ts': /limitBankCalls\(/,
  'app/api/qonto/verify/route.ts': /guardBankConnect\(/,
  'lib/invoices/import-qonto-invoices.service.ts': /limitBankCalls\(/,
  'lib/invoices/read-invoice-attachment.service.ts': /limitBankCalls\(/,
  'lib/invoices/create-in-qonto.service.ts': /limitBankCalls\(/,
  'lib/simple/upload-receipt.service.ts': /limitBankCalls\(/,
  'lib/account/change-email.service.ts': /enforceRateLimit\('account-change-email'/,
  'lib/account/change-password.service.ts': /enforceRateLimit\('account-change-password'/,
  'lib/account/delete-account.service.ts': /enforceRateLimit\('account-delete'/,
  'lib/appearance/appearance.service.ts': /enforceRateLimit\('account-appearance'/,
  'lib/appearance/display-mode.service.ts': /enforceRateLimit\('account-appearance'/,
  'lib/users/instance-users.service.ts': /enforceRateLimit\('instance-users'/,
  'lib/updates/guard.ts': /enforceRateLimit\('updates-write'/,
  'lib/mcp/full-control/define.ts': /enforceRateLimit\('mcp-full-control'/,
  'app/api/ai-actions/[id]/route.ts': /enforceRateLimit\('ai-action-approval'/,
  'lib/dashboard/dashboard-layout.service.ts': /enforceRateLimit\('dashboard-layout'/,
  'lib/navigation/sidebar-preferences.service.ts': /enforceRateLimit\('sidebar-preferences'/,
  'app/api/users/route.ts': /createInstanceUser\(/,
  'lib/mcp/api-key.ts': /enforceRateLimit\('mcp-api-key'/,
  'app/(auth)/setup/actions.ts': /withinRateLimit\('setup'/,
}

describe('rate limited routes', () => {
  it.each(Object.entries(LIMITED_ROUTES))('%s calls its rate limit', (file, guard) => {
    expect(readFileSync(path.join(ROOT, file), 'utf8')).toMatch(guard)
  })

  it('never builds a limit by hand outside lib/rate-limit.ts', () => {
    const offenders = Object.keys(LIMITED_ROUTES).filter((file) =>
      /consumeRateLimit\(|RATE_LIMIT_DISABLED/.test(readFileSync(path.join(ROOT, file), 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
