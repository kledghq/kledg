/**
 * MCP tools of the "Rémunération et dividendes" simulator
 * (lib/mcp/remuneration-tools.ts, lib/mcp/drafts/remuneration.ts):
 * simulate_remuneration reads with reports:read, turns euros and percents
 * into the service's cents and basis points, answers euros and the
 * disclaimer; save_remuneration_scenario exists only with kledg:write and
 * checks closing:execute. The loader and the write services are mocked
 * (lib/remuneration/__tests__/remuneration.db.test.ts runs them on
 * PostgreSQL); the simulation itself is the real pure module.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const guard = vi.hoisted(() => ({
  require: vi.fn(async () => {}),
  requireFullControl: vi.fn(async () => {}),
  companyWhere: vi.fn(async () => ({})),
  companyIds: vi.fn(async () => null),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('@/lib/mcp/company-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/company-access')>()),
  companyGuard: () => guard,
}))
vi.mock('@/lib/remuneration/load-remuneration.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/remuneration/load-remuneration.service')>()),
  loadRemuneration: vi.fn(),
}))
vi.mock('@/lib/remuneration/save-remuneration-scenario.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/remuneration/save-remuneration-scenario.service')>()),
  saveRemunerationScenario: vi.fn(),
  deleteRemunerationScenario: vi.fn(),
  proposeScenarioDividends: vi.fn(),
}))

import { registerKledgTools } from '@/lib/mcp/tools'
import { loadRemuneration, type RemunerationView } from '@/lib/remuneration/load-remuneration.service'
import { deleteRemunerationScenario, proposeScenarioDividends, saveRemunerationScenario } from '@/lib/remuneration/save-remuneration-scenario.service'
import { simulate } from '@/lib/remuneration/simulate'
import type { RemunerationInputs } from '@/lib/remuneration/schemas'
import { writeAuditLog } from '@/lib/audit'
import type { ToolResult } from '@/lib/mcp/tool-result'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function tools(canWrite: boolean) {
  const handlers = new Map<string, Handler>()
  registerKledgTools(
    { registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as never,
    { user: { id: 'u1', email: 'a@b.c', name: 'Camille', role: 'user' }, canWrite, canAdmin: false, caller: { kind: 'apiKey', apiKeyId: 'k1' }, executionMode: 'validation' },
  )
  return handlers
}

const parse = (result: ToolResult) => {
  expect(result.isError, result.content[0].text).toBeFalsy()
  return JSON.parse(result.content[0].text)
}

const INPUTS: RemunerationInputs = {
  resultBeforePayCents: 10_000_000,
  status: 'assimile',
  reducedRate: true,
  reducedRateCeilingCents: 4_250_000,
  legalReserveRequired: true,
  capitalCents: 100_000,
  legalReserveCents: 10_000,
  priorLossesCents: 0,
  shareBp: 10_000,
  premiumsCents: 0,
  currentAccountCents: 0,
  householdParts: 1,
  otherIncomeCents: 0,
  dividendTaxation: 'best',
  distributionBp: 10_000,
  mixBp: 5_000,
}

const FY = { id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }
const VIEW = {
  today: '2026-10-05',
  status: 'ready',
  rulesYear: 2026,
  passCents: 4_806_000,
  legalType: 'SASU',
  fiscalYears: [FY],
  fiscalYear: FY,
  bases: [{ basis: 'current', label: 'Exercice 2026 à ce jour', fiscalYear: FY, resultBeforeTaxCents: 10_000_000, directorPayBookedCents: 0, resultBeforePayCents: 10_000_000, daysElapsed: 278, daysInYear: 365 }],
  basis: 'current',
  shareholders: [],
  statusReason: 'SASU : le président est assimilé salarié.',
  reducedRateEligible: true,
  defaults: INPUTS,
  inputs: INPUTS,
  scenario: null,
  simulation: simulate(INPUTS),
  scenarios: [{ id: 's1', fiscalYearId: 'fy26', name: 'Optimum', inputs: INPUTS, rulesYear: 2026, remunerationCostCents: 86_000, dividendsCents: 7_860_500, netIncomeCents: 5_882_558, updatedAt: '2026-10-05T10:00:00.000Z' }],
  approval: { proposedDividendsCents: null },
  currentAccountsCents: 0,
  checks: ['Une vérification.'],
  sources: [{ label: 'CGI, art. 219, I', url: 'https://www.legifrance.gouv.fr' }],
} as unknown as RemunerationView

beforeEach(() => vi.clearAllMocks())

describe('simulate_remuneration', () => {
  it('checks reports:read, passes the changes in cents and basis points, answers euros with the disclaimer', async () => {
    vi.mocked(loadRemuneration).mockResolvedValue(VIEW)
    const data = parse(await tools(false).get('simulate_remuneration')!({ companyId: 'c1', resultBeforePay: 100_000, sharePercent: 60, householdParts: 2, dividendTaxation: 'pfu' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    const query = vi.mocked(loadRemuneration).mock.calls[0][1]
    expect(JSON.parse(query.inputs as string)).toEqual({ resultBeforePayCents: 10_000_000, shareBp: 6_000, householdParts: 2, dividendTaxation: 'pfu' })
    expect(data.disclaimer).toContain('pas un conseil')
    const allDividends = data.scenarios.find((s: { id: string }) => s.id === 'allDividends')
    expect(allDividends).toMatchObject({ remunerationPercent: 0, company: { corporateTax: 20_750, dividends: 79_250 }, netIncome: 58_757.21 })
    expect(data.inputs).toMatchObject({ resultBeforePay: 100_000, sharePercent: 100, householdParts: 1 })
    expect(data.savedScenarios).toEqual([{ id: 's1', name: 'Optimum', rulesYear: 2026, remunerationCost: 860, dividends: 78_605, netIncome: 58_825.58 }])
    expect(data.reviewUrl).toMatch(/\/c1\/remuneration\?exercice=fy26$/)
  })

  it('refuses a share above 100 % in French', async () => {
    const result = await tools(false).get('simulate_remuneration')!({ companyId: 'c1', sharePercent: 120 })
    expect(result.isError).toBe(true)
    expect(loadRemuneration).not.toHaveBeenCalled()
  })
})

describe('save_remuneration_scenario', () => {
  it('is absent from a read-only connection', () => {
    expect(tools(false).has('save_remuneration_scenario')).toBe(false)
  })

  it('checks closing:execute and saves the scenario with the inputs read from the books', async () => {
    vi.mocked(loadRemuneration).mockResolvedValue(VIEW)
    vi.mocked(saveRemunerationScenario).mockResolvedValue(VIEW.scenarios[0])
    const data = parse(await tools(true).get('save_remuneration_scenario')!({ companyId: 'c1', action: 'save', name: 'Optimum', mixPercent: 30 }))
    expect(guard.require).toHaveBeenCalledWith('c1', { closing: ['execute'] })
    expect(saveRemunerationScenario).toHaveBeenCalledWith('c1', { fiscalYearId: 'fy26', name: 'Optimum', inputs: INPUTS, pick: 'optimum' }, 'u1')
    expect(JSON.parse(vi.mocked(loadRemuneration).mock.calls[0][1].inputs as string)).toEqual({ mixBp: 3_000 })
    expect(data.scenario).toEqual({ remunerationCost: 860, dividends: 78_605, netIncome: 58_825.58, rulesYear: 2026 })
    expect(writeAuditLog).toHaveBeenCalledWith('info', expect.stringContaining('save_remuneration_scenario'), expect.objectContaining({ action: 'MCP_WRITE' }))
  })

  it('proposes the dividends in the approval and deletes a scenario', async () => {
    vi.mocked(proposeScenarioDividends).mockResolvedValue({ fiscalYearId: 'fy26', dividendsCents: 7_860_500 })
    const proposed = parse(await tools(true).get('save_remuneration_scenario')!({ companyId: 'c1', action: 'propose', scenarioId: 's1' }))
    expect(proposeScenarioDividends).toHaveBeenCalledWith('c1', 's1', 'u1')
    expect(proposed.changes).toEqual({ proposedDividends: 78_605, fiscalYearId: 'fy26' })
    expect(proposed.reviewUrl).toMatch(/\/c1\/approval$/)
    parse(await tools(true).get('save_remuneration_scenario')!({ companyId: 'c1', action: 'delete', scenarioId: 's1' }))
    expect(deleteRemunerationScenario).toHaveBeenCalledWith('c1', 's1')
    const missing = await tools(true).get('save_remuneration_scenario')!({ companyId: 'c1', action: 'delete' })
    expect(missing.isError).toBe(true)
    expect(missing.content[0].text).toContain('scenarioId')
  })
})
