/**
 * MCP tool list_detected_subscriptions: the company guard with
 * banking:read, ignored subscriptions left out unless asked for, amounts in
 * euros. The service is mocked (it has its own database tests); the
 * subscriptions it returns are detected by the real pure module.
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
vi.mock('@/lib/subscriptions/detect-subscriptions.service', () => ({ listDetectedSubscriptions: vi.fn() }))

import { registerKledgTools } from '@/lib/mcp/tools'
import { listDetectedSubscriptions, type SubscriptionList } from '@/lib/subscriptions/detect-subscriptions.service'
import { detectSubscriptions, type BankLine } from '@/lib/subscriptions/detect'
import { NotFoundError } from '@/lib/accounting/errors'
import type { ToolResult } from '@/lib/mcp/tool-result'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function tool() {
  const handlers = new Map<string, Handler>()
  registerKledgTools(
    { registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as never,
    { user: { id: 'u1', email: 'a@b.c', name: 'Camille', role: 'user' }, canWrite: false, canAdmin: false, caller: { kind: 'apiKey', apiKeyId: 'k1' }, executionMode: 'validation' },
  )
  return handlers.get('list_detected_subscriptions')!
}

const parse = (result: ToolResult) => JSON.parse(result.content[0].text)

const lines: BankLine[] = [
  ...['2026-01-14', '2026-02-14', '2026-03-14', '2026-04-14', '2026-05-14'].map((day, i) => ({
    id: `p${i}`, day, amountCents: i < 3 ? 3_999 : 4_499, side: 'debit' as const, label: null, counterpartyName: 'Telecom Pro',
  })),
  ...['2025-03-02', '2026-03-03'].map((day, i) => ({ id: `y${i}`, day, amountCents: 12_000, side: 'debit' as const, label: null, counterpartyName: 'Assur Bureau' })),
]
const detected = detectSubscriptions(lines, { today: '2026-05-20' })
const [phone, insurance] = detected.subscriptions
const list: SubscriptionList = {
  today: '2026-05-20',
  observedUntil: detected.observedUntil,
  items: [
    { ...phone, decision: { id: 'd1', status: 'confirmed', budgetLine: { id: 'l1', accountPrefix: '626', label: 'Télécommunications', fiscalYear: 2026 }, decidedAt: '2026-05-01T00:00:00.000Z' }, suggestedAccountCode: '626000', lastTransactionId: 'p4' },
    { ...insurance, decision: { id: 'd2', status: 'ignored', budgetLine: null, decidedAt: '2026-05-01T00:00:00.000Z' }, suggestedAccountCode: null, lastTransactionId: 'y1' },
  ],
  totals: { activeCount: 1, activeAnnualizedCents: phone.annualizedCents },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listDetectedSubscriptions).mockResolvedValue(list)
})

describe('list_detected_subscriptions', () => {
  it('checks banking:read and answers in euros without the ignored subscriptions', async () => {
    const data = parse(await tool()({ companyId: 'c1', includeIgnored: false }))
    expect(guard.require).toHaveBeenCalledWith('c1', { banking: ['read'] })
    expect(listDetectedSubscriptions).toHaveBeenCalledWith('c1')
    expect(data).toMatchObject({ today: '2026-05-20', observedUntil: '2026-05-14', activeCount: 1, activeAnnualizedCost: 539.88 })
    expect(data.subscriptions).toEqual([
      {
        id: 'p0',
        counterparty: 'Telecom Pro',
        cadence: 'monthly',
        amount: 44.99,
        annualizedCost: 539.88,
        firstPayment: '2026-01-14',
        lastPayment: '2026-05-14',
        nextExpectedPayment: '2026-06-14',
        payments: 5,
        missedPayments: 0,
        status: 'price_changed',
        priceChange: { previousAmount: 39.99, newAmount: 44.99, since: '2026-04-14' },
        variableAmount: false,
        decision: 'confirmed',
        budgetLine: { accountPrefix: '626', label: 'Télécommunications', fiscalYear: 2026 },
        suggestedAccount: '626000',
      },
    ])
  })

  it('returns the ignored subscriptions on request', async () => {
    const data = parse(await tool()({ companyId: 'c1', includeIgnored: true }))
    expect(data.subscriptions.map((s: { counterparty: string; cadence: string; decision: string }) => [s.counterparty, s.cadence, s.decision])).toEqual([
      ['Telecom Pro', 'monthly', 'confirmed'],
      ['Assur Bureau', 'yearly', 'ignored'],
    ])
  })

  it('answers without data for a company outside the grant', async () => {
    guard.require.mockRejectedValueOnce(new NotFoundError('Société introuvable'))
    const result = await tool()({ companyId: 'x', includeIgnored: false })
    expect(result.isError).toBe(true)
    expect(listDetectedSubscriptions).not.toHaveBeenCalled()
  })
})
