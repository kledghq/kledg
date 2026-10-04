/**
 * MCP read tools added for the closing workflows: list_tax_deadlines
 * (reports:read, dates and sources only), get_bank_sync_status
 * (banking:read, state only, no IBAN or provider data), get_auxiliary_balance
 * and list_doubtful_receivables (reports:read, amounts in euros). Present
 * at every level, read only; services mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const guard = vi.hoisted(() => ({
  require: vi.fn(async () => {}),
  requireFullControl: vi.fn(async () => {}),
  companyWhere: vi.fn(async () => ({})),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('@/lib/mcp/company-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/company-access')>()),
  companyGuard: () => guard,
}))
vi.mock('@/lib/deadlines/load-deadlines.service', () => ({ loadDeadlinesView: vi.fn() }))
vi.mock('@/lib/banking/list-bank-connections.service', () => ({ listBankConnections: vi.fn() }))
vi.mock('@/lib/reports/third-parties/get-third-party-reports.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reports/third-parties/get-third-party-reports.service')>()),
  getAuxiliaryBalance: vi.fn(),
}))
vi.mock('@/lib/provisions/doubtful-receivables.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/provisions/doubtful-receivables.service')>()),
  listDoubtfulReceivables: vi.fn(),
}))

import { registerKledgTools } from '@/lib/mcp/tools'
import { loadDeadlinesView } from '@/lib/deadlines/load-deadlines.service'
import { listBankConnections } from '@/lib/banking/list-bank-connections.service'
import { getAuxiliaryBalance } from '@/lib/reports/third-parties/get-third-party-reports.service'
import { listDoubtfulReceivables } from '@/lib/provisions/doubtful-receivables.service'
import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import type { ToolResult } from '@/lib/mcp/tool-result'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function tool(name: string) {
  const handlers = new Map<string, Handler>()
  registerKledgTools(
    { registerTool: (n: string, _config: unknown, handler: Handler) => handlers.set(n, handler) } as never,
    { user: { id: 'u1', email: 'a@b.c', name: 'Camille', role: 'user' }, canWrite: false, canAdmin: false, caller: { kind: 'apiKey', apiKeyId: 'k1' }, executionMode: 'validation' },
  )
  return handlers.get(name)!
}

const parse = (result: ToolResult) => {
  expect(result.isError, result.content[0].text).toBeFalsy()
  return JSON.parse(result.content[0].text)
}
const db = asPrismaMock(prisma)

beforeEach(() => vi.clearAllMocks())

describe('list_tax_deadlines', () => {
  const view = {
    today: '2026-10-04',
    fiscalYear: { id: 'fy', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false },
    deadlines: [
      { id: 'tva-09', date: '2026-10-24', legalDate: '2026-10-24', label: 'Déclaration de TVA de septembre 2026', form: 'CA3', category: 'tva', ruleId: 'ca3', estimated: true, projected: false },
      { id: 'is-3', date: '2026-09-15', legalDate: '2026-09-15', label: "Acompte d'IS", form: '2571', category: 'is', ruleId: 'is-acomptes', estimated: false, projected: false, condition: "Si l'IS dépasse 3 000 €" },
    ],
    rules: [
      { id: 'ca3', category: 'tva', form: 'CA3', summary: 'Mensuelle.', sources: [{ label: 'CGI, art. 287', url: 'https://www.legifrance.gouv.fr' }] },
      { id: 'is-acomptes', category: 'is', form: '2571', summary: 'Quatre acomptes.', sources: [] },
    ],
    settings: { ca3Day: null },
    missingRegimes: false,
  }

  it('checks reports:read and answers the days left and the rule of each deadline', async () => {
    vi.mocked(loadDeadlinesView).mockResolvedValue(view as never)
    const data = parse(await tool('list_tax_deadlines')({ companyId: 'c1', upcomingOnly: false }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(loadDeadlinesView).toHaveBeenCalledWith('c1', { fiscalYearId: undefined })
    expect(data.deadlines.map((d: { daysLeft: number }) => d.daysLeft)).toEqual([20, -19])
    expect(data.deadlines[1]).toMatchObject({ form: '2571', condition: "Si l'IS dépasse 3 000 €", estimated: false })
    expect(data).not.toHaveProperty('settings')

    const upcomingVat = parse(await tool('list_tax_deadlines')({ companyId: 'c1', category: 'tva', upcomingOnly: true }))
    expect(upcomingVat.deadlines).toHaveLength(1)
    expect(upcomingVat.rules.map((r: { id: string }) => r.id)).toEqual(['ca3'])
  })
})

describe('get_bank_sync_status', () => {
  it('checks banking:read, counts the unreconciled lines per account and returns no IBAN nor provider data', async () => {
    vi.mocked(listBankConnections).mockResolvedValue([
      {
        id: 'conn-1',
        provider: 'QONTO',
        status: 'ACTIVE',
        lastSyncAt: new Date('2026-10-03T06:00:00Z'),
        lastSyncAttemptAt: new Date('2026-10-04T06:00:00Z'),
        lastSyncError: 'La banque ne répond pas, réessayez plus tard.',
        consentExpiresAt: null,
        providerData: { secret: 'x' },
        bankAccounts: [
          { id: 'ba-1', name: 'Compte courant', displayName: null, iban: 'FR7630001007941234567890185', balance: { toString: () => '1234.50' }, currency: 'EUR', shouldSync: true, ledgerAccountCode: '512000', consentExpiresAt: null, lastSyncedAt: new Date('2026-10-03T06:00:00Z'), lastSyncError: null, supersededById: null, providerData: {}, externalAccountId: 'ext' },
          { id: 'ba-old', name: 'Ancien', displayName: null, iban: null, balance: { toString: () => '0' }, currency: 'EUR', shouldSync: false, ledgerAccountCode: null, consentExpiresAt: null, lastSyncedAt: null, lastSyncError: null, supersededById: 'ba-1', providerData: {}, externalAccountId: 'ext2' },
        ],
      },
    ] as never)
    db.bankTransaction.groupBy.mockResolvedValue([{ bankAccountId: 'ba-1', _count: { _all: 4 }, _min: { date: new Date('2026-09-02T00:00:00Z') } }] as never)
    const result = await tool('get_bank_sync_status')({ companyId: 'c1' })
    const data = parse(result)
    expect(guard.require).toHaveBeenCalledWith('c1', { banking: ['read'] })
    expect(data.connections[0]).toMatchObject({ provider: 'QONTO', lastSyncAt: '2026-10-03T06:00:00.000Z', lastSyncError: 'La banque ne répond pas, réessayez plus tard.' })
    expect(data.connections[0].accounts).toEqual([
      {
        id: 'ba-1',
        name: 'Compte courant',
        currency: 'EUR',
        synced: true,
        ledgerAccount: '512000',
        lastSyncedAt: '2026-10-03T06:00:00.000Z',
        lastSyncError: null,
        consentExpiresAt: null,
        balance: 1234.5,
        unreconciledTransactions: 4,
        oldestUnreconciled: '2026-09-02',
      },
    ])
    expect(result.content[0].text).not.toMatch(/FR76|providerData|secret|externalAccountId/)
  })
})

describe('get_auxiliary_balance', () => {
  it('checks reports:read and answers each tiers in euros, signed debit minus credit', async () => {
    const row = { openingCents: 10_000, debitCents: 120_000, creditCents: 50_000, closingCents: 80_000, unletteredCents: 70_000 }
    vi.mocked(getAuxiliaryBalance).mockResolvedValue({
      fiscalYear: { id: 'fy', year: 2026 },
      period: { startDate: '2026-01-01', endDate: '2026-06-30' },
      customers: { kind: 'customers', tiers: [{ code: 'C0001', label: 'Dupont', accountCodes: ['411000'], ...row }], totals: row },
      suppliers: { kind: 'suppliers', tiers: [], totals: { openingCents: 0, debitCents: 0, creditCents: 0, closingCents: 0, unletteredCents: 0 } },
    } as never)
    const data = parse(await tool('get_auxiliary_balance')({ companyId: 'c1', endDate: '2026-06-30', kind: 'customers' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(getAuxiliaryBalance).toHaveBeenCalledWith('c1', { endDate: '2026-06-30' })
    expect(data.customers.tiers).toEqual([{ tiers: 'C0001', label: 'Dupont', accounts: ['411000'], opening: 100, debit: 1200, credit: 500, closing: 800, unlettered: 700 }])
    expect(data).not.toHaveProperty('suppliers')
    const bad = await tool('get_auxiliary_balance')({ companyId: 'c1', startDate: '01/01/2026', kind: 'all' })
    expect(bad.isError).toBe(true)
    expect(bad.content[0].text).toMatch(/Date de début invalide/)
  })
})

describe('list_doubtful_receivables', () => {
  it('checks reports:read and answers the overdue customers in euros', async () => {
    vi.mocked(listDoubtfulReceivables).mockResolvedValue({
      asOf: '2025-12-31',
      minDaysOverdue: 60,
      items: [{ tiersCode: 'C0002', label: 'Martin', accountCodes: ['411000'], openInclTaxCents: 360_000, overdueInclTaxCents: 240_000, oldestDueDate: '2025-08-31', provision: null }],
    })
    const data = parse(await tool('list_doubtful_receivables')({ companyId: 'c1', fiscalYearId: 'fy-2025', minDaysOverdue: '60' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(listDoubtfulReceivables).toHaveBeenCalledWith('c1', { fiscalYearId: 'fy-2025', minDaysOverdue: '60' })
    expect(data.customers).toEqual([{ customer: 'C0002', label: 'Martin', accounts: ['411000'], openInclTax: 3600, overdueInclTax: 2400, oldestDueDate: '2025-08-31', impairment: null }])
  })
})
