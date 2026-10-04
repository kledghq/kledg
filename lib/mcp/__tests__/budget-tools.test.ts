/**
 * MCP read tools of budgets: list_budgets and get_budget (lines with their
 * ids, monthly amounts and recurring items, in euros), and get_budget_report: the company guard with reports:read, the
 * fiscal year of the company (the current one by default, another
 * company's id refused), amounts in euros, monthly detail on request. The
 * report service is mocked (it has its own database tests); the comparison
 * it returns is computed by the real pure module.
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
vi.mock('@/lib/accounting/fiscal-year-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounting/fiscal-year-utils')>()),
  getActiveFiscalYear: vi.fn(async () => ({ id: 'fy-2026' })),
}))
vi.mock('@/lib/budgets/get-budget-report.service', () => ({ getBudgetReportOfFiscalYear: vi.fn() }))
vi.mock('@/lib/budgets/manage-budgets.service', () => ({ listBudgets: vi.fn(), findBudgetOfFiscalYear: vi.fn() }))

import { registerKledgTools } from '@/lib/mcp/tools'
import { getBudgetReportOfFiscalYear } from '@/lib/budgets/get-budget-report.service'
import { findBudgetOfFiscalYear, listBudgets } from '@/lib/budgets/manage-budgets.service'
import { buildBudgetComparison } from '@/lib/budgets/report'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import type { ToolResult } from '@/lib/mcp/tool-result'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function tools(name = 'get_budget_report') {
  const handlers = new Map<string, Handler>()
  registerKledgTools(
    { registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as never,
    { user: { id: 'u1', email: 'a@b.c', name: 'Camille', role: 'user' }, canWrite: false, canAdmin: false, caller: { kind: 'apiKey', apiKeyId: 'k1' }, executionMode: 'validation' },
  )
  return handlers.get(name)!
}

const parse = (result: ToolResult) => JSON.parse(result.content[0].text)
const db = asPrismaMock(prisma)

const fiscalYear = { id: 'fy-2026', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }
const report = {
  budgetId: 'b1',
  fiscalYear,
  ...buildBudgetComparison({
    months: ['2026-01', '2026-02'],
    lines: [
      { id: 'l1', accountPrefix: '6226', label: 'Honoraires', months: [100_000, 0] },
      { id: 'l2', accountPrefix: '706', label: 'Prestations de services', months: [500_000, 500_000] },
    ],
    accounts: [
      { code: '622600', label: 'Honoraires', debitBalances: [120_000, 0] },
      { code: '606400', label: 'Fournitures administratives', debitBalances: [0, 4_550] },
      { code: '706000', label: 'Prestations de services', debitBalances: [-450_000, -600_000] },
    ],
  }),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getBudgetReportOfFiscalYear).mockResolvedValue(report)
})

describe('get_budget_report', () => {
  it('checks reports:read, reads the current fiscal year and answers in euros', async () => {
    const data = parse(await tools()({ companyId: 'c1', monthly: false }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(getBudgetReportOfFiscalYear).toHaveBeenCalledWith('c1', 'fy-2026', { throughMonth: undefined })
    expect(data.charges.lines).toEqual([
      { accountPrefix: '6226', label: 'Honoraires', budget: 1000, actual: 1200, variance: 200, variancePercent: 20, favorable: false, annualBudget: 1000, accounts: ['622600'] },
    ])
    expect(data.charges.unbudgeted[0]).toMatchObject({ accountPrefix: '606400', budget: 0, actual: 45.5, variancePercent: null })
    expect(data.produits.total).toMatchObject({ budget: 10_000, actual: 10_500, variance: 500, variancePercent: 5, favorable: true })
    expect(data.resultat).toMatchObject({ budget: 9_000, actual: 10_500 - 1_245.5, favorable: true })
    expect(data.charges.lines[0].months).toBeUndefined()
  })

  it('reads a fiscal year of the company only, with the monthly detail on request', async () => {
    db.fiscalYear.findFirst.mockResolvedValue({ id: 'fy-2025' } as never)
    const data = parse(await tools()({ companyId: 'c1', fiscalYearId: 'fy-2025', throughMonth: '2026-01', monthly: true }))
    expect(db.fiscalYear.findFirst).toHaveBeenCalledWith({ where: { id: 'fy-2025', companyId: 'c1' }, select: { id: true } })
    expect(getBudgetReportOfFiscalYear).toHaveBeenCalledWith('c1', 'fy-2025', { throughMonth: '2026-01' })
    expect(data.produits.lines[0].months).toEqual([
      { month: '2026-01', budget: 5_000, actual: 4_500 },
      { month: '2026-02', budget: 5_000, actual: 6_000 },
    ])

    db.fiscalYear.findFirst.mockResolvedValue(null)
    const other = await tools()({ companyId: 'c1', fiscalYearId: 'fy-of-another-company', monthly: false })
    expect(other).toEqual({ content: [{ type: 'text', text: 'Exercice introuvable pour cette société.' }], isError: true })
  })

  it('answers without data for a company outside the grant or a year without budget', async () => {
    guard.require.mockRejectedValueOnce(new NotFoundError('Société introuvable'))
    expect((await tools()({ companyId: 'x', monthly: false })).isError).toBe(true)
    expect(getBudgetReportOfFiscalYear).not.toHaveBeenCalled()

    vi.mocked(getBudgetReportOfFiscalYear).mockRejectedValueOnce(new NotFoundError("Budget introuvable : cet exercice n'a pas de budget."))
    expect(await tools()({ companyId: 'c1', monthly: false })).toEqual({
      content: [{ type: 'text', text: "Budget introuvable : cet exercice n'a pas de budget." }],
      isError: true,
    })
  })
})

describe('list_budgets and get_budget', () => {
  it('lists the budgets of the company in euros', async () => {
    vi.mocked(listBudgets).mockResolvedValue({ items: [{ id: 'b1', fiscalYear, lineCount: 2, chargesCents: 1_000_050, produitsCents: 2_000_000, resultatCents: 999_950 }] })
    const data = parse(await tools('list_budgets')({ companyId: 'c1' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(data.budgets).toEqual([{ id: 'b1', fiscalYear, lines: 2, charges: 10_000.5, produits: 20_000, resultat: 9_999.5 }])
  })

  it('returns every line with its id, months and recurring items in euros', async () => {
    vi.mocked(findBudgetOfFiscalYear).mockResolvedValue({
      id: 'b1',
      fiscalYear,
      lineCount: 1,
      chargesCents: 360_000,
      produitsCents: 0,
      resultatCents: -360_000,
      months: ['2026-01', '2026-02'],
      editable: true,
      lines: [
        {
          id: 'l1',
          accountPrefix: '613',
          label: 'Loyers',
          side: 'charges',
          amounts: [],
          recurringItems: [{ id: 'r1', label: 'Bail', amountCents: 180_000, frequency: 'MONTHLY', startMonth: '2026-01', endMonth: null }],
          plannedMonths: [180_000, 180_000],
          annualCents: 360_000,
        },
      ],
    })
    const data = parse(await tools('get_budget')({ companyId: 'c1' }))
    expect(findBudgetOfFiscalYear).toHaveBeenCalledWith('c1', 'fy-2026')
    expect(data.lines).toEqual([
      {
        id: 'l1',
        accountPrefix: '613',
        label: 'Loyers',
        side: 'charges',
        annualBudget: 3_600,
        amounts: [],
        recurringItems: [{ id: 'r1', label: 'Bail', amount: 1_800, frequency: 'MONTHLY', startMonth: '2026-01', endMonth: null }],
        plannedByMonth: [1_800, 1_800],
      },
    ])
    expect(data).toMatchObject({ id: 'b1', charges: 3_600, resultat: -3_600, editable: true })

    vi.mocked(findBudgetOfFiscalYear).mockResolvedValue(null)
    expect(await tools('get_budget')({ companyId: 'c1' })).toEqual({
      content: [{ type: 'text', text: "Cet exercice n'a pas de budget\u00a0: créez-le avec create_budget, ou dans Kledg." }],
      isError: true,
    })
  })
})
