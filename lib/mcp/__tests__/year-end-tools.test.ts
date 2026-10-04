/**
 * MCP tools get_year_end_inventory and get_capital_composition: the company
 * guard with reports:read, amounts in euros, items outside the fiscal year
 * left out unless asked for, no personal data. The services are mocked
 * (they have their own database tests); the capital composition is built by
 * the real pure module.
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
vi.mock('@/lib/year-end/get-year-end-inventory.service', () => ({ getYearEndInventory: vi.fn() }))
vi.mock('@/lib/reports/capital-composition/get-capital-composition.service', () => ({ getCapitalComposition: vi.fn() }))

import { registerKledgTools } from '@/lib/mcp/tools'
import { getYearEndInventory, type YearEndInventory } from '@/lib/year-end/get-year-end-inventory.service'
import { getCapitalComposition } from '@/lib/reports/capital-composition/get-capital-composition.service'
import { buildCapitalComposition } from '@/lib/reports/capital-composition/compute'
import { provisionYear, grantYear, type YearRef } from '@/lib/year-end/inventory'
import { ForbiddenError } from '@/lib/accounting/errors'
import type { ToolResult } from '@/lib/mcp/tool-result'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function tool(name: string) {
  const handlers = new Map<string, Handler>()
  registerKledgTools(
    { registerTool: (toolName: string, _config: unknown, handler: Handler) => handlers.set(toolName, handler) } as never,
    { user: { id: 'u1', email: 'a@b.c', name: 'Camille', role: 'user' }, canWrite: false, canAdmin: false, caller: { kind: 'apiKey', apiKeyId: 'k1' }, executionMode: 'validation' },
  )
  return handlers.get(name)!
}

const parse = (result: ToolResult) => JSON.parse(result.content[0].text)

const year: YearRef = { id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }
const provisionInput = {
  id: 'p1', category: 'RISK_CHARGE' as const, label: 'Litige', accountCode: '1511', nature: 'OPERATING' as const, reversible: true,
  openedOn: '2026-02-01', closedOn: null, carriedCents: 0,
  assessments: [{ fiscalYearId: 'fy26', amountCents: 1_234_567, currentValueCents: null, basis: null, entry: null }],
}
const later = { ...provisionInput, id: 'p2', label: 'Futur', openedOn: '2027-03-01', assessments: [] }
const grantInput = { id: 'g1', label: 'Aide', amountCents: 500_000, spreading: 'TENTHS' as const, grantedOn: '2026-04-01', durationYears: null, transferAccountCode: '139', carriedCents: 0, transfers: [] }
const common = { justification: 'x', accountLabel: 'Provisions pour litiges', taxDeductible: true, fixedAsset: null, tiersCode: null, carriedCents: 0 }
const inventory: YearEndInventory = {
  fiscalYear: year,
  provisions: [
    { ...provisionYear(provisionInput, year, [year]), ...common, id: 'p1', category: 'RISK_CHARGE', label: 'Litige', accountCode: '1511', nature: 'OPERATING', reversible: true, openedOn: '2026-02-01', closedOn: null },
    { ...provisionYear(later, year, [year]), ...common, id: 'p2', category: 'RISK_CHARGE', label: 'Futur', accountCode: '1511', nature: 'OPERATING', reversible: true, openedOn: '2027-03-01', closedOn: null },
  ],
  grants: [
    {
      ...grantYear(grantInput, year, [year], null),
      id: 'g1', label: 'Aide', grantor: 'Région', amountCents: 500_000, grantedOn: '2026-04-01', spreading: 'TENTHS', durationYears: null,
      fixedAsset: null, accountCode: '131', transferAccountCode: '139', incomeAccountCode: '747', carriedCents: 0, notes: null,
    },
  ],
  totals: { dotationsCents: 1_234_567, reprisesCents: 0, transfersCents: 50_000, toAssess: 0, toCorrect: 0 },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getYearEndInventory).mockResolvedValue(inventory)
})

describe('get_year_end_inventory', () => {
  it('checks reports:read and answers in euros, without the items outside the year', async () => {
    const data = parse(await tool('get_year_end_inventory')({ companyId: 'c1', fiscalYearId: 'fy26', includeOutOfYear: false }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(getYearEndInventory).toHaveBeenCalledWith('c1', 'fy26')
    expect(data.totals).toEqual({ dotationsToBook: 12_345.67, reprisesToBook: 0, grantTransfersToBook: 500, itemsToAssess: 0, entriesToCorrect: 0 })
    expect(data.provisions).toEqual([
      expect.objectContaining({ id: 'p1', account: '1511', dotationAccount: '6815', repriseAccount: '7815', openingBalance: 0, requiredBalance: 12_345.67, toBook: 12_345.67, status: 'to_post', entry: null }),
    ])
    expect(data.grants).toEqual([expect.objectContaining({ id: 'g1', amount: 5_000, toBook: 500, remainingInEquity: 4_500, status: 'to_post' })])
    const all = parse(await tool('get_year_end_inventory')({ companyId: 'c1', fiscalYearId: 'fy26', includeOutOfYear: true }))
    expect(all.provisions.map((p: { id: string; status: string }) => [p.id, p.status])).toEqual([
      ['p1', 'to_post'],
      ['p2', 'not_in_year'],
    ])
  })

  it('stops at the guard', async () => {
    guard.require.mockRejectedValueOnce(new ForbiddenError('Action non autorisée'))
    const result = await tool('get_year_end_inventory')({ companyId: 'c1', fiscalYearId: 'fy26', includeOutOfYear: false })
    expect(result.isError).toBe(true)
    expect(getYearEndInventory).not.toHaveBeenCalled()
  })
})

describe('get_capital_composition', () => {
  it('checks reports:read and lists the shareholders with the 10 % flag', async () => {
    const composition = buildCapitalComposition({ legalType: 'SARL', shareCapitalCents: 500_000, totalShares: 500, nominalCents: 1_000 }, [
      { id: 's1', kind: 'PHYSICAL', name: 'Camille Martin', siren: null, shares: 475, percentHundredths: 9_500, capitalCents: null },
      { id: 's2', kind: 'PHYSICAL', name: 'Louis Bernard', siren: null, shares: 25, percentHundredths: 500, capitalCents: null },
    ])
    vi.mocked(getCapitalComposition).mockResolvedValue({
      ...composition,
      company: { name: 'Atelier', siren: '123456789', legalType: 'SARL' },
      fiscalYear: { id: 'fy26', year: 2026, endDate: '2026-12-31' },
      bookedCapitalCents: 500_000,
    })
    const data = parse(await tool('get_capital_composition')({ companyId: 'c1' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(getCapitalComposition).toHaveBeenCalledWith('c1', { fiscalYearId: undefined })
    expect(data).toMatchObject({ shareKind: 'parts', shareCapital: 5_000, totalShares: 500, nominalValue: 10, bookedCapital: { fiscalYear: 2026, amount: 5_000 }, checks: [] })
    expect(data.shareholders).toEqual([
      { name: 'Camille Martin', kind: 'PHYSICAL', siren: null, shares: 475, percent: 95, percentFromShares: 95, nominalAmount: 4_750, listedOnForm2033F: true, majority: true },
      { name: 'Louis Bernard', kind: 'PHYSICAL', siren: null, shares: 25, percent: 5, percentFromShares: 5, nominalAmount: 250, listedOnForm2033F: false, majority: false },
    ])
    expect(data.totals).toEqual({ holders: 2, naturalPersons: { holders: 2, shares: 500 }, legalPersons: { holders: 0, shares: 0 }, shares: 500, percent: 100, nominalAmount: 5_000 })
  })
})
