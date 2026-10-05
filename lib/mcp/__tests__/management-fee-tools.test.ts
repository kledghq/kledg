/**
 * MCP tools of management fees: list_management_fee_conventions and
 * preview_management_fees. The holding goes through the company guard with
 * reports:read; every subsidiary is reached through the same guard (the
 * GroupAccess handed to the services delegates to it), so the connection's
 * company grant applies to subsidiaries too. Amounts in euros. Services are
 * mocked: they have their own database tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const guard = vi.hoisted(() => ({
  require: vi.fn<(companyId: string, permission: unknown) => Promise<void>>(async () => {}),
  requireFullControl: vi.fn(async () => {}),
  companyWhere: vi.fn(async () => ({})),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('@/lib/mcp/company-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/company-access')>()),
  companyGuard: () => guard,
}))
vi.mock('@/lib/management-fees/manage-conventions.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/management-fees/manage-conventions.service')>()), listConventions: vi.fn() }))
vi.mock('@/lib/management-fees/compute-management-fees.service', () => ({ computeConventionFees: vi.fn() }))

import { registerKledgTools } from '@/lib/mcp/tools'
import { listConventions } from '@/lib/management-fees/manage-conventions.service'
import { computeConventionFees } from '@/lib/management-fees/compute-management-fees.service'
import type { GroupAccess } from '@/lib/management-fees/access'
import { NotFoundError } from '@/lib/accounting/errors'
import type { ToolResult } from '@/lib/mcp/tool-result'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function server() {
  const handlers = new Map<string, Handler>()
  registerKledgTools({ registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as never, {
    user: { id: 'u1', email: 'a@b.c', name: 'Camille', role: 'user' },
    canWrite: false,
    canAdmin: false,
    caller: { kind: 'apiKey', apiKeyId: 'k1' },
    executionMode: 'validation',
  })
  return handlers
}

const parse = (result: ToolResult) => JSON.parse(result.content[0].text)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('list_management_fee_conventions', () => {
  it('reads the holding through the guard and reports rates in percent, amounts in euros', async () => {
    vi.mocked(listConventions).mockResolvedValue([
      {
        id: 'conv-1',
        label: 'Convention 2026',
        pricing: 'FIXED',
        markupBp: 0,
        costShareBp: 10000,
        costAccountPrefixes: ['6'],
        excludedAccountPrefixes: ['695'],
        fixedAmountCents: 1_200_050,
        allocationKey: 'CUSTOM',
        vatRateBp: 2000,
        revenueAccountCode: '706',
        expenseAccountCode: '6226',
        invoicePrefix: 'FG',
        startDate: '2026-01-01',
        endDate: null,
        notes: null,
        billingCount: 2,
        subsidiaries: [
          { subsidiaryId: 's1', sharePercentBp: 7500, startDate: null, endDate: null, name: 'Filiale Nord', accessible: true },
          { subsidiaryId: 's2', sharePercentBp: 2500, startDate: '2026-02-01', endDate: null, name: null, accessible: false },
        ],
      },
    ])
    const data = parse(await server().get('list_management_fee_conventions')!({ companyId: 'h1' }))
    expect(guard.require).toHaveBeenCalledWith('h1', { reports: ['read'] })
    expect(data.conventions[0]).toMatchObject({ fixedAmount: 12000.5, vatRatePercent: 20, invoicedPeriods: 2 })
    expect(data.conventions[0].subsidiaries).toEqual([
      { id: 's1', name: 'Filiale Nord', accessible: true, sharePercent: 75, startDate: null, endDate: null },
      { id: 's2', name: null, accessible: false, sharePercent: 25, startDate: '2026-02-01', endDate: null },
    ])
  })

  it('answers an error when the holding is outside the grant, without calling the service', async () => {
    guard.require.mockRejectedValueOnce(new NotFoundError('Société introuvable'))
    const result = await server().get('list_management_fee_conventions')!({ companyId: 'other' })
    expect(result.isError).toBe(true)
    expect(listConventions).not.toHaveBeenCalled()
  })
})

describe('preview_management_fees', () => {
  it('computes through the engine and checks every subsidiary with the same guard', async () => {
    vi.mocked(computeConventionFees).mockImplementation(async (_holding, _id, _period, access: GroupAccess) => {
      await access.require('s1', { reports: ['read'] })
      return {
        convention: { id: 'conv-1', label: 'Convention 2026' },
        period: { start: '2026-01-01', end: '2026-03-31', days: 90 },
        costPool: { accounts: [{ code: '6226', label: 'Honoraires', cents: 1_000_000 }], excluded: [{ code: '695', label: 'IS', cents: 300_000 }], totalCents: 1_000_000, coveredDays: 90 },
        result: {
          pricing: 'COST_PLUS',
          allocationKey: 'EQUAL',
          costPoolCents: 1_000_000,
          costShareBp: 10000,
          markupBp: 500,
          vatRateBp: 2000,
          baseCents: 1_000_000,
          markupCents: 50_000,
          totalExclTaxCents: 1_050_000,
          totalVatCents: 210_000,
          totalInclTaxCents: 1_260_000,
          parts: [{ subsidiaryId: 's1', name: 'Filiale Nord', eligibleDays: 90, revenueCents: null, sharePercentBp: null, weight: '90', amountExclTaxCents: 1_050_000, vatCents: 210_000, amountInclTaxCents: 1_260_000 }],
        },
        subsidiaries: [],
        warnings: [],
        billed: [],
      } as unknown as Awaited<ReturnType<typeof computeConventionFees>>
    })
    const data = parse(await server().get('preview_management_fees')!({ companyId: 'h1', conventionId: 'conv-1', periodStart: '2026-01-01', periodEnd: '2026-03-31' }))
    expect(guard.require).toHaveBeenCalledWith('h1', { reports: ['read'] })
    expect(guard.require).toHaveBeenCalledWith('s1', { reports: ['read'] })
    expect(data).toMatchObject({ totalExclTax: 10500, markup: 500, totalInclTax: 12600, markupPercent: 5 })
    expect(data.costPool.excludedAccounts).toEqual([{ code: '695', label: 'IS', amount: 3000 }])
    expect(data.subsidiaries[0]).toMatchObject({ name: 'Filiale Nord', amountExclTax: 10500, vat: 2100, amountInclTax: 12600 })
  })

  it('reports a subsidiary outside the grant as an error', async () => {
    vi.mocked(computeConventionFees).mockImplementation(async (_h, _id, _p, access: GroupAccess) => {
      await access.require('s-hidden', { reports: ['read'] })
      throw new Error('unreachable')
    })
    guard.require.mockImplementation(async (id: string) => {
      if (id === 's-hidden') throw new NotFoundError('Société introuvable')
    })
    const result = await server().get('preview_management_fees')!({ companyId: 'h1', conventionId: 'conv-1', periodStart: '2026-01-01', periodEnd: '2026-03-31' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/introuvable/)
  })
})
