/**
 * MCP tool get_cash_forecast: the company guard with reports:read and
 * banking:read, the parameters passed to the service as the route parses
 * them, amounts in euros, the alert and the notice that it is a projection.
 * The service is mocked (it has its own database tests); the projection
 * is the real pure module.
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
vi.mock('@/lib/cash-forecast/load-cash-forecast.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cash-forecast/load-cash-forecast.service')>()),
  getCashForecast: vi.fn(),
}))

import { registerKledgTools } from '@/lib/mcp/tools'
import { getCashForecast, type CashForecastView } from '@/lib/cash-forecast/load-cash-forecast.service'
import { projectCashForecast, type CashFlowItem } from '@/lib/cash-forecast/projection'
import { CASH_FORECAST_COMPONENTS } from '@/lib/cash-forecast/components'
import type { ToolResult } from '@/lib/mcp/tool-result'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function tool() {
  const handlers = new Map<string, Handler>()
  registerKledgTools(
    { registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as never,
    { user: { id: 'u1', email: 'a@b.c', name: 'Camille', role: 'user' }, canWrite: false, canAdmin: false, caller: { kind: 'apiKey', apiKeyId: 'k1' }, executionMode: 'validation' },
  )
  return handlers.get('get_cash_forecast')!
}

const parse = (result: ToolResult) => JSON.parse(result.content[0].text)

const items: CashFlowItem[] = [
  { component: 'receivables', label: 'Studio Nord', day: '2026-09-30', amountCents: 120_000, overdue: true },
  { component: 'taxes', label: 'Paiement de la CFE 2026', day: '2026-12-15', amountCents: -1_000_000, ruleId: 'cfe' },
]

function view(components = ['receivables', 'taxes'] as const): CashForecastView {
  return {
    today: '2026-10-05',
    start: '2026-10-06',
    end: '2027-01-05',
    horizonMonths: 3,
    granularity: 'month',
    settings: { thresholdCents: 500_000, horizonMonths: 3, components: [...components] },
    opening: { cents: 1_000_000, source: 'bank', bankAccounts: 1, otherCurrencies: 0, ledgerCents: 950_000 },
    items,
    truncated: 0,
    unknownTaxes: [{ day: '2026-12-15', label: "4e acompte d'IS", ruleId: 'is-acompte' }],
    trend: null,
    availability: Object.fromEntries(CASH_FORECAST_COMPONENTS.map((c) => [c, { available: c === 'receivables' || c === 'taxes', reason: null }])) as CashForecastView['availability'],
    projection: projectCashForecast({ today: '2026-10-05', horizonMonths: 3, granularity: 'month', openingCents: 1_000_000, items, components: [...components], thresholdCents: 500_000 }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCashForecast).mockResolvedValue(view())
})

describe('get_cash_forecast', () => {
  it('checks reports:read and banking:read, then answers in euros with the alert', async () => {
    const data = parse(await tool()({ companyId: 'c1', granularity: 'month', includeFlows: true }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'], banking: ['read'] })
    expect(getCashForecast).toHaveBeenCalledWith('c1', { granularity: 'month' })
    expect(data).toMatchObject({
      today: '2026-10-05',
      from: '2026-10-06',
      to: '2027-01-05',
      opening: { balance: 10_000, source: 'bank', bankAccounts: 1, ledgerBalance512: 9_500 },
      closing: 1_200,
      lowest: { day: '2026-12-15', balance: 1_200 },
      threshold: 5_000,
      alert: { firstDayBelow: '2026-12-15', balance: 1_200, alreadyBelowToday: false },
      unknownTaxes: [{ day: '2026-12-15', label: "4e acompte d'IS", ruleId: 'is-acompte' }],
    })
    expect(data.notice).toMatch(/sans garantie/)
    expect(data.periods[0]).toMatchObject({ period: '2026-10', opening: 10_000, inflows: 1_200, closing: 11_200, byComponent: { receivables: 1_200 } })
    expect(data.components.find((c: { id: string }) => c.id === 'taxes')).toMatchObject({ counted: true, outflows: -10_000, assumption: false })
    expect(data.components.find((c: { id: string }) => c.id === 'trend')).toMatchObject({ counted: false, assumption: true })
    expect(data.flows).toEqual([
      { day: '2026-09-30', until: null, component: 'receivables', label: 'Studio Nord', amount: 1_200, late: true },
      { day: '2026-12-15', until: null, component: 'taxes', label: 'Paiement de la CFE 2026', amount: -10_000, late: false },
    ])
  })

  it('passes the horizon and the components as the route parses them, and leaves the flows out by default', async () => {
    const data = parse(await tool()({ companyId: 'c1', horizonMonths: 12, granularity: 'week', components: ['taxes', 'receivables'], includeFlows: false }))
    expect(getCashForecast).toHaveBeenCalledWith('c1', { horizon: 12, granularity: 'week', components: ['receivables', 'taxes'] })
    expect(data.flows).toBeUndefined()
  })
})
