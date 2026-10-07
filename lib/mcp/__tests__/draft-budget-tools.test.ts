/**
 * Draft-level MCP tools of budgets and detected subscriptions
 * (lib/mcp/drafts/budgets.ts): only with kledg:write, the company guard
 * with the rights of the API routes (budgets:manage, banking:reconcile),
 * euros converted to cents for the services, French validation errors,
 * what changed and the link to review it. Services are mocked: they have
 * their own database tests (and lib/mcp/__tests__/draft-tools.db.test.ts
 * calls these tools on PostgreSQL).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const guard = vi.hoisted(() => ({
  require: vi.fn(async () => {}),
  requireFullControl: vi.fn(async () => {}),
  companyWhere: vi.fn(async () => ({})),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('@/lib/mcp/company-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/company-access')>()),
  companyGuard: () => guard,
}))
vi.mock('@/lib/budgets/manage-budgets.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/budgets/manage-budgets.service')>()),
  createBudget: vi.fn(),
  createBudgetLine: vi.fn(),
  updateBudgetLine: vi.fn(),
  findBudgetOfFiscalYear: vi.fn(),
}))
vi.mock('@/lib/subscriptions/decide-subscriptions.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/subscriptions/decide-subscriptions.service')>()),
  decideSubscription: vi.fn(),
  addSubscriptionToBudget: vi.fn(),
}))

import { registerKledgTools } from '@/lib/mcp/tools'
import { createBudget, createBudgetLine, findBudgetOfFiscalYear, updateBudgetLine } from '@/lib/budgets/manage-budgets.service'
import { addSubscriptionToBudget, decideSubscription } from '@/lib/subscriptions/decide-subscriptions.service'
import { writeAuditLog } from '@/lib/audit'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/accounting/errors'
import type { ToolResult } from '@/lib/mcp/tool-result'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function tools(canWrite = true) {
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

const fiscalYear = { id: 'fy-2026', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }
const line = {
  id: 'l1',
  accountPrefix: '6226',
  label: 'Honoraires',
  side: 'charges' as const,
  amounts: [{ month: '2026-01', amountCents: 120_050 }],
  recurringItems: [{ id: 'r1', label: 'Expert-comptable', amountCents: 30_000, frequency: 'QUARTERLY' as const, startMonth: '2026-01', endMonth: null }],
  plannedMonths: [150_050, 0, 0],
  annualCents: 240_050,
}
const subscription = {
  id: 'sub-1',
  name: 'Notion',
  cadence: 'monthly',
  typicalAmountCents: 1_000,
  kind: 'subscription',
  countsAsSubscription: true,
  decision: { id: 'd1', status: 'confirmed', budgetLine: { id: 'l1', accountPrefix: '6226', label: 'Honoraires', fiscalYear: 2026 } },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(findBudgetOfFiscalYear).mockResolvedValue({ id: 'b1' } as never)
  vi.mocked(createBudgetLine).mockResolvedValue(line)
  vi.mocked(updateBudgetLine).mockResolvedValue(line)
})

describe('draft budget tools', () => {
  it('are absent from a read-only connection', () => {
    const readOnly = tools(false)
    for (const name of ['create_budget', 'create_budget_line', 'update_budget_line', 'classify_subscription', 'add_subscription_to_budget']) expect(readOnly.has(name), name).toBe(false)
  })

  it('create_budget checks budgets:manage and answers the lines and the page to review', async () => {
    vi.mocked(createBudget).mockResolvedValue({ id: 'b1', fiscalYear, lines: [{ id: 'l1', accountPrefix: '60', label: 'Achats' }] } as never)
    const data = parse(await tools().get('create_budget')!({ companyId: 'c1', fiscalYearId: 'fy-2026', template: 'posts' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { budgets: ['manage'] })
    expect(createBudget).toHaveBeenCalledWith('c1', { fiscalYearId: 'fy-2026', template: 'posts' })
    expect(data).toMatchObject({ budgetId: 'b1', fiscalYear: 2026, changes: { budgetCreated: 'b1', lines: [{ id: 'l1', accountPrefix: '60' }] } })
    expect(data.reviewUrl).toMatch(/\/c1\/budget$/)
    expect(writeAuditLog).toHaveBeenCalledWith('info', expect.stringContaining('create_budget'), expect.objectContaining({ action: 'MCP_WRITE', metadata: expect.objectContaining({ tool: 'create_budget', budgetId: 'b1', userId: 'u1' }) }))
  })

  it('create_budget_line converts euros to cents for the service and answers euros', async () => {
    const data = parse(
      await tools().get('create_budget_line')!({
        companyId: 'c1',
        fiscalYearId: 'fy-2026',
        accountPrefix: '6226',
        amounts: [{ month: '2026-01', amount: 1200.5 }],
        recurringItems: [{ label: 'Expert-comptable', amount: 300, frequency: 'QUARTERLY', startMonth: '2026-01' }],
      }),
    )
    expect(findBudgetOfFiscalYear).toHaveBeenCalledWith('c1', 'fy-2026')
    expect(createBudgetLine).toHaveBeenCalledWith('c1', 'b1', {
      accountPrefix: '6226',
      amounts: [{ month: '2026-01', amountCents: 120_050 }],
      recurringItems: [{ label: 'Expert-comptable', amountCents: 30_000, frequency: 'QUARTERLY', startMonth: '2026-01' }],
    })
    expect(data.line).toMatchObject({ id: 'l1', annualBudget: 2400.5, amounts: [{ month: '2026-01', amount: 1200.5 }], recurringItems: [{ amount: 300, frequency: 'QUARTERLY' }] })
    expect(data.changes).toEqual({ lineCreated: 'l1', accountPrefix: '6226' })
  })

  it('create_budget_line refuses a third decimal, a class 4 account and a year without budget, in French', async () => {
    const third = await tools().get('create_budget_line')!({ companyId: 'c1', fiscalYearId: 'fy-2026', accountPrefix: '606', amounts: [{ month: '2026-01', amount: 10.005 }] })
    expect(third).toEqual({ content: [{ type: 'text', text: 'Montant de 2026-01 : montant invalide, en euros avec deux décimales au plus.' }], isError: true })
    const account = await tools().get('create_budget_line')!({ companyId: 'c1', fiscalYearId: 'fy-2026', accountPrefix: '411' })
    expect(account.isError).toBe(true)
    expect(account.content[0].text).toMatch(/charges \(classe 6\) ou de produits \(classe 7\)/)
    vi.mocked(findBudgetOfFiscalYear).mockResolvedValueOnce(null)
    const none = await tools().get('create_budget_line')!({ companyId: 'c1', fiscalYearId: 'fy-2026', accountPrefix: '606' })
    expect(none.content[0].text).toBe("Cet exercice n'a pas de budget : créez-le d'abord avec create_budget.")
    const month = await tools().get('create_budget_line')!({ companyId: 'c1', fiscalYearId: 'fy-2026', accountPrefix: '606', amounts: [{ month: '2026/01', amount: 1 }] })
    expect(month.content[0].text).toMatch(/Mois attendu au format AAAA-MM/)
    expect(createBudgetLine).not.toHaveBeenCalled()
  })

  it('update_budget_line replaces only the fields given and says which', async () => {
    const data = parse(await tools().get('update_budget_line')!({ companyId: 'c1', lineId: 'l1', label: null, amounts: [{ month: '2026-02', amount: 50 }] }))
    expect(updateBudgetLine).toHaveBeenCalledWith('c1', 'l1', { label: null, amounts: [{ month: '2026-02', amountCents: 5_000 }] })
    expect(data.changes).toEqual({ lineUpdated: 'l1', fields: ['label', 'amounts'] })
  })

  it('keeps the closed year refusal of the service', async () => {
    vi.mocked(updateBudgetLine).mockRejectedValueOnce(new ConflictError("L'exercice 2025 est clôturé : son budget ne se modifie plus."))
    const result = await tools().get('update_budget_line')!({ companyId: 'c1', lineId: 'l1', label: 'X' })
    expect(result).toEqual({ content: [{ type: 'text', text: "L'exercice 2025 est clôturé : son budget ne se modifie plus." }], isError: true })
    expect(writeAuditLog).not.toHaveBeenCalled()
  })

  it('classify_subscription maps each decision and checks banking:reconcile', async () => {
    vi.mocked(decideSubscription).mockResolvedValue(subscription as never)
    for (const [decision, status] of [
      ['confirm', 'confirmed'],
      ['ignore', 'ignored'],
      ['count_as_subscription', 'confirmed'],
      ['reset', 'pending'],
    ]) {
      const data = parse(await tools().get('classify_subscription')!({ companyId: 'c1', subscriptionId: 'sub-1', decision }))
      expect(decideSubscription).toHaveBeenLastCalledWith('c1', { subscriptionId: 'sub-1', status })
      expect(data.subscription).toMatchObject({ id: 'sub-1', counterparty: 'Notion', amount: 10, decision: 'confirmed' })
      expect(data.reviewUrl).toMatch(/\/c1\/subscriptions$/)
    }
    expect(guard.require).toHaveBeenCalledWith('c1', { banking: ['reconcile'] })
    const unknown = await tools().get('classify_subscription')!({ companyId: 'c1', subscriptionId: 'sub-1', decision: 'approve' })
    expect(unknown.isError).toBe(true)
    expect(unknown.content[0].text).toContain('decision')
  })

  it('add_subscription_to_budget needs both budgets:manage and banking:reconcile, like its route', async () => {
    vi.mocked(addSubscriptionToBudget).mockResolvedValue(subscription as never)
    const data = parse(await tools().get('add_subscription_to_budget')!({ companyId: 'c1', subscriptionId: 'sub-1', budgetLineId: 'l1', startMonth: '2026-03' }))
    expect(guard.require).toHaveBeenNthCalledWith(1, 'c1', { budgets: ['manage'] })
    expect(guard.require).toHaveBeenNthCalledWith(2, 'c1', { banking: ['reconcile'] })
    expect(addSubscriptionToBudget).toHaveBeenCalledWith('c1', { subscriptionId: 'sub-1', budgetLineId: 'l1', startMonth: '2026-03' })
    expect(data.changes).toEqual({ recurringItemAdded: { budgetLineId: 'l1', amount: 10, cadence: 'monthly' }, decision: 'confirmed' })

    guard.require.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ForbiddenError('Accès refusé'))
    const refused = await tools().get('add_subscription_to_budget')!({ companyId: 'c1', subscriptionId: 'sub-1', budgetLineId: 'l1' })
    expect(refused).toEqual({ content: [{ type: 'text', text: 'Accès refusé' }], isError: true })
    expect(addSubscriptionToBudget).toHaveBeenCalledTimes(1)
  })

  it('answers "Société introuvable" for a company outside the grant, before any service', async () => {
    guard.require.mockRejectedValueOnce(new NotFoundError('Société introuvable'))
    const result = await tools().get('create_budget_line')!({ companyId: 'other', fiscalYearId: 'fy', accountPrefix: '606' })
    expect(result).toEqual({ content: [{ type: 'text', text: 'Société introuvable' }], isError: true })
    expect(findBudgetOfFiscalYear).not.toHaveBeenCalled()
  })
})
