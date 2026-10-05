/**
 * MCP tools of the third-party features: get_aged_balance and
 * list_missing_receipts (read tools, kledg:read, through the company
 * guard with the permission of their screen), and the lettering tools of
 * full control (letter_entry_lines, unletter_entry_lines follow the
 * execution mode; list_unlettered_lines reads). Services are mocked: they
 * have their own database tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const guard = vi.hoisted(() => ({
  require: vi.fn(async () => {}),
  requireFullControl: vi.fn(async () => {}),
  companyWhere: vi.fn(async () => ({})),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }))
vi.mock('@/lib/mcp/company-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/company-access')>()),
  companyGuard: () => guard,
}))
vi.mock('@/lib/reports/third-parties/get-third-party-reports.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reports/third-parties/get-third-party-reports.service')>()),
  getAgedBalance: vi.fn(),
}))
vi.mock('@/lib/banking/missing-receipts.service', () => ({ listMissingReceipts: vi.fn() }))
vi.mock('@/lib/lettering/lettering.service', () => ({
  letterLines: vi.fn(),
  unletterCode: vi.fn(),
  previewLettering: vi.fn(),
  listLetteringLines: vi.fn(),
  getLetteringSuggestions: vi.fn(),
}))
vi.mock('@/lib/mcp/full-control/resolve', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/full-control/resolve')>()),
  accountIdsByCode: vi.fn(async () => new Map([['411000', 'acc-411']])),
  ownedFiscalYear: vi.fn(async () => ({ id: 'fy-1', year: 2026 })),
}))
vi.mock('@/lib/accounting/fiscal-year-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounting/fiscal-year-utils')>()),
  getActiveFiscalYear: vi.fn(async () => ({ id: 'fy-1', year: 2026 })),
}))

import { registerKledgTools } from '@/lib/mcp/tools'
import { getAgedBalance } from '@/lib/reports/third-parties/get-third-party-reports.service'
import { listMissingReceipts } from '@/lib/banking/missing-receipts.service'
import { letterLines, previewLettering, unletterCode } from '@/lib/lettering/lettering.service'
import { NotFoundError } from '@/lib/accounting/errors'
import type { ToolResult } from '@/lib/mcp/tool-result'
import type { ExecutionMode } from '@/lib/ai-access/access'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function server(options: { canAdmin?: boolean; executionMode?: ExecutionMode } = {}) {
  const handlers = new Map<string, Handler>()
  registerKledgTools(
    { registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as never,
    {
      user: { id: 'u1', email: 'a@b.c', name: null, role: 'user' },
      canWrite: true,
      canAdmin: options.canAdmin ?? false,
      caller: { kind: 'apiKey', apiKeyId: 'k1' },
      executionMode: options.executionMode ?? 'validation',
    },
  )
  return handlers
}

const parse = (result: ToolResult) => JSON.parse(result.content[0].text)
const buckets = (total: number) => ({ notDue: 0, days0to30: total, days31to60: 0, days61to90: 0, over90: 0, totalCents: total })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('get_aged_balance', () => {
  beforeEach(() => {
    vi.mocked(getAgedBalance).mockResolvedValue({
      fiscalYear: { id: 'fy-1', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false },
      asOf: '2026-06-30',
      terms: { days: 30, endOfMonth: false },
      customers: { kind: 'customers', tiers: [{ code: 'C001', label: 'Martin SA', accountCodes: ['411000'], buckets: buckets(12_345), lineCount: 1, oldestDueDate: '2026-06-01' }], totals: buckets(12_345) },
      suppliers: { kind: 'suppliers', tiers: [], totals: buckets(0) },
    })
  })

  it('checks reports:read on the company, then answers in euros', async () => {
    const result = await server().get('get_aged_balance')!({ companyId: 'c1', asOf: '2026-06-30', kind: 'all' })
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(getAgedBalance).toHaveBeenCalledWith('c1', { fiscalYearId: undefined, asOf: '2026-06-30' })
    const data = parse(result)
    expect(data.customers.totals).toEqual({ notDue: 0, overdue0to30: 123.45, overdue31to60: 0, overdue61to90: 0, overdueOver90: 0, total: 123.45 })
    expect(data.customers.tiers[0]).toMatchObject({ tiers: 'C001', label: 'Martin SA', oldestDueDate: '2026-06-01', total: 123.45 })
    expect(data.suppliers).toBeDefined()
  })

  it('returns one side when asked', async () => {
    const data = parse(await server().get('get_aged_balance')!({ companyId: 'c1', kind: 'suppliers' }))
    expect(data.customers).toBeUndefined()
    expect(data.suppliers.tiers).toEqual([])
  })

  it('refuses a company outside the grant with the guard message', async () => {
    guard.require.mockRejectedValueOnce(new NotFoundError('Société introuvable'))
    const result = await server().get('get_aged_balance')!({ companyId: 'other', kind: 'all' })
    expect(result).toEqual({ content: [{ type: 'text', text: 'Société introuvable' }], isError: true })
    expect(getAgedBalance).not.toHaveBeenCalled()
  })
})

describe('list_missing_receipts', () => {
  it('checks banking:read and passes the threshold in cents', async () => {
    vi.mocked(listMissingReceipts).mockResolvedValue({
      period: { startDate: '2026-01-01', endDate: '2026-12-31' },
      thresholdCents: 5_000,
      transactions: [
        { id: 't1', date: '2026-02-01', label: 'PRLV', counterpartyName: 'SCI', reference: null, amountCents: -120_000, reconciled: false, entryId: null, bankAccount: { id: 'b1', name: 'Courant', displayName: null } },
      ],
      count: 1,
      totalCents: 120_000,
      truncated: false,
    })
    const result = await server().get('list_missing_receipts')!({ companyId: 'c1', fiscalYearId: 'fy-1', minAmount: 50, side: 'debit', limit: 50 })
    expect(guard.require).toHaveBeenCalledWith('c1', { banking: ['read'] })
    expect(listMissingReceipts).toHaveBeenCalledWith('c1', expect.objectContaining({ fiscalYearId: 'fy-1', minAmount: 5_000, side: 'debit', limit: 50 }))
    expect(parse(result)).toMatchObject({ threshold: 50, count: 1, total: 1200, transactions: [{ id: 't1', amount: -1200, counterparty: 'SCI', bankAccount: 'Courant' }] })
  })
})

describe('lettering tools (full control)', () => {
  it('are absent without full control', () => {
    const tools = server()
    for (const name of ['list_unlettered_lines', 'letter_entry_lines', 'unletter_entry_lines']) expect(tools.has(name), name).toBe(false)
  })

  it('letter at once in automatic mode, with entries:update checked through the full control guard', async () => {
    vi.mocked(letterLines).mockResolvedValue({ code: 'AB', letteringDate: '2026-06-30', lineIds: ['l1', 'l2'], amountCents: 10_000 })
    const tools = server({ canAdmin: true, executionMode: 'automatic' })
    const result = parse(await tools.get('letter_entry_lines')!({ companyId: 'c1', accountCode: '411000', lineIds: ['l1', 'l2'] }))
    expect(guard.requireFullControl).toHaveBeenCalledWith('c1', { entries: ['update'] })
    expect(letterLines).toHaveBeenCalledWith('c1', { accountId: 'acc-411', lineIds: ['l1', 'l2'] }, { source: 'mcp' })
    expect(result).toEqual({ executed: true, result: { code: 'AB', letteringDate: '2026-06-30', lineIds: ['l1', 'l2'], amount: 100 } })
  })

  it('only previews with dryRun', async () => {
    vi.mocked(previewLettering).mockResolvedValue({
      account: { id: 'acc-411', code: '411000', label: 'Clients' },
      code: 'AC',
      lines: [],
      debitCents: 500,
      creditCents: 400,
      problems: ['écart'],
    })
    const tools = server({ canAdmin: true, executionMode: 'automatic' })
    const result = parse(await tools.get('letter_entry_lines')!({ companyId: 'c1', accountCode: '411000', lineIds: ['l1', 'l2'], dryRun: true }))
    expect(result).toMatchObject({ dryRun: true, preview: { code: 'AC', totalDebit: 5, totalCredit: 4, problems: ['écart'] } })
    expect(letterLines).not.toHaveBeenCalled()
  })

  it('unletter at once in automatic mode', async () => {
    vi.mocked(unletterCode).mockResolvedValue({ code: 'AA', lineCount: 2 })
    const tools = server({ canAdmin: true, executionMode: 'automatic' })
    const result = parse(await tools.get('unletter_entry_lines')!({ companyId: 'c1', accountCode: '411000', code: 'AA' }))
    expect(unletterCode).toHaveBeenCalledWith('c1', { accountId: 'acc-411', code: 'AA' }, { source: 'mcp' })
    expect(result).toEqual({ executed: true, result: { code: 'AA', lineCount: 2 } })
  })
})
