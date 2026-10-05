/**
 * MCP tools get_sig and get_financial_ratios: the company guard with
 * reports:read, the fiscal year asked (the current one by default), amounts
 * in euros, N-1 when there is one, errors as tool errors. The report service
 * is mocked (its database test is lib/reports/financial-indicators/__tests__/
 * financial-indicators.db.test.ts); the indicators it returns are computed by
 * the real pure modules on the worked example.
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
vi.mock('@/lib/reports/financial-indicators/get-financial-indicators.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reports/financial-indicators/get-financial-indicators.service')>()),
  getFinancialIndicators: vi.fn(),
}))

import { registerKledgTools } from '@/lib/mcp/tools'
import { getFinancialIndicators } from '@/lib/reports/financial-indicators/get-financial-indicators.service'
import { computeFinancialIndicators } from '@/lib/reports/financial-indicators/indicators'
import { NotFoundError } from '@/lib/accounting/errors'
import type { ToolResult } from '@/lib/mcp/tool-result'
import { WORKED_EXAMPLE_ACCOUNTS, WORKED_EXAMPLE_VAT } from '@/lib/reports/financial-indicators/__tests__/worked-example'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function tools() {
  const handlers = new Map<string, Handler>()
  registerKledgTools(
    { registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as never,
    { user: { id: 'u1', email: 'a@b.c', name: 'Camille', role: 'user' }, canWrite: false, canAdmin: false, caller: { kind: 'apiKey', apiKeyId: 'k1' }, executionMode: 'validation' },
  )
  return { sig: handlers.get('get_sig')!, ratios: handlers.get('get_financial_ratios')! }
}

const parse = (result: ToolResult) => JSON.parse(result.content[0].text)

const fiscalYear = { id: 'fy-2026', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false, asOf: '2026-12-31' }
const indicators = computeFinancialIndicators({ accounts: WORKED_EXAMPLE_ACCOUNTS, vat: WORKED_EXAMPLE_VAT, days: 365 })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getFinancialIndicators).mockResolvedValue({ fiscalYear, current: indicators, previous: null })
})

describe('get_sig', () => {
  it('checks reports:read, reads the fiscal year asked and answers in euros', async () => {
    const data = parse(await tools().sig({ companyId: 'c1' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(getFinancialIndicators).toHaveBeenCalledWith('c1', { fiscalYearId: undefined })
    expect(data.fiscalYear).toEqual(fiscalYear)
    expect(data.current.sig).toMatchObject({
      margeCommerciale: 74_000,
      valeurAjoutee: 145_000,
      ebe: 61_500,
      resultatExploitation: 56_000,
      resultatCourant: 54_500,
      resultatExceptionnel: -500,
      resultatExercice: 44_000,
      plusValuesCession: 1_800,
      hasMarchandises: true,
    })
    expect(data.current.caf).toMatchObject({ caf: 50_000, cafFromEbe: 50_000 })
    expect(data.previous).toBeNull()
  })

  it('returns the previous fiscal year when there is one', async () => {
    vi.mocked(getFinancialIndicators).mockResolvedValueOnce({
      fiscalYear,
      current: indicators,
      previous: { fiscalYear: { ...fiscalYear, id: 'fy-2025', year: 2025 }, indicators },
    })
    const data = parse(await tools().sig({ companyId: 'c1', fiscalYearId: 'fy-2026' }))
    expect(getFinancialIndicators).toHaveBeenCalledWith('c1', { fiscalYearId: 'fy-2026' })
    expect(data.previous.fiscalYear.year).toBe(2025)
    expect(data.previous.sig.ebe).toBe(61_500)
  })
})

describe('get_financial_ratios', () => {
  it('returns the BFR, net cash, delays and ratios', async () => {
    const data = parse(await tools().ratios({ companyId: 'c1' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(data.current.balanceSheet).toMatchObject({ bfr: 60_800, tresorerieNette: 32_500, dettesFinancieres: 30_000, capitauxPropres: 114_000 })
    expect(data.current.paymentDelays).toMatchObject({ days: 365, dsoDays: 61, dpoDays: 42, chiffreAffairesTtc: 358_800 })
    expect(data.current.ratios).toEqual({ tauxMarge: 0.5968, tauxMarque: 0.3737, margeEbe: 0.2057, margeNette: 0.1472, endettement: 0.2632 })
  })

  it('answers without data for a company outside the grant or a fiscal year of another company', async () => {
    guard.require.mockRejectedValueOnce(new NotFoundError('Société introuvable'))
    expect((await tools().ratios({ companyId: 'x' })).isError).toBe(true)
    expect(getFinancialIndicators).not.toHaveBeenCalled()

    vi.mocked(getFinancialIndicators).mockRejectedValueOnce(new NotFoundError('Exercice introuvable pour cette société.'))
    expect(await tools().sig({ companyId: 'c1', fiscalYearId: 'fy-other' })).toEqual({
      content: [{ type: 'text', text: 'Exercice introuvable pour cette société.' }],
      isError: true,
    })
  })
})
