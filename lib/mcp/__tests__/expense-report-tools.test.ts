/**
 * MCP tools of expense reports: list_expense_reports and get_expense_report
 * (read tools through the company guard with entries:read, then scoped by
 * the user's role: a validator sees every report, another member their own),
 * and create_draft_expense_report (full control, expenses:submit, following
 * the execution mode, with a dry run of the recoverable VAT per line).
 * Services are mocked: they have their own database tests.
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
vi.mock('@/lib/expense-reports/actor', () => ({ expenseActorOf: vi.fn(async () => ({ userId: 'u1', canManage: false })) }))
vi.mock('@/lib/expense-reports/manage-expense-reports.service', () => ({ listExpenseReports: vi.fn(), getExpenseReport: vi.fn(), createExpenseReport: vi.fn() }))
vi.mock('@/lib/expense-reports/manage-category-rules.service', () => ({
  listCategoryRules: vi.fn(async () => ({ rules: [{ id: 'r1', keyword: 'sncf', category: 'TRANSPORT', accountCode: null, priority: 0 }] })),
}))
vi.mock('@/lib/mcp/full-control/pending-actions', () => ({
  createPendingAction: vi.fn(async () => ({ id: 'action-1', approvalUrl: 'http://kledg.test/ai-actions/action-1', expiresAt: new Date('2026-10-05T00:00:00Z') })),
  claimApprovedAction: vi.fn(),
  finishAction: vi.fn(),
}))

import { registerKledgTools } from '@/lib/mcp/tools'
import { expenseActorOf } from '@/lib/expense-reports/actor'
import { createExpenseReport, getExpenseReport, listExpenseReports } from '@/lib/expense-reports/manage-expense-reports.service'
import { createPendingAction } from '@/lib/mcp/full-control/pending-actions'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import type { ToolResult } from '@/lib/mcp/tool-result'
import type { ExecutionMode } from '@/lib/ai-access/access'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function server(options: { canAdmin?: boolean; executionMode?: ExecutionMode } = {}) {
  const handlers = new Map<string, Handler>()
  registerKledgTools(
    { registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as never,
    {
      user: { id: 'u1', email: 'a@b.c', name: 'Camille', role: 'user' },
      canWrite: true,
      canAdmin: options.canAdmin ?? false,
      caller: { kind: 'apiKey', apiKeyId: 'k1' },
      executionMode: options.executionMode ?? 'validation',
    },
  )
  return handlers
}

const parse = (result: ToolResult) => JSON.parse(result.content[0].text)
const db = asPrismaMock(prisma)

const summary = {
  id: 'ndf-1',
  number: 'NDF-0001',
  label: 'Mars',
  periodStart: '2026-03-01',
  periodEnd: '2026-03-31',
  status: 'posted',
  claimant: { id: 'c1', name: 'Camille Martin', kind: 'EMPLOYEE', auxiliaryAccountNumber: 'S00001' },
  own: true,
  totalInclTaxCents: 26_160,
  recoverableVatCents: 1_000,
  totalExpenseCents: 25_160,
  lineCount: 3,
  letteringCode: null,
  entry: { id: 'e1', entryNumber: 'BR-4', status: 'draft' },
  submittedAt: null,
  validatedAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('list_expense_reports and get_expense_report', () => {
  it('checks entries:read, scopes by the user’s role and returns euros', async () => {
    vi.mocked(listExpenseReports).mockResolvedValue({ items: [summary as never], nextCursor: null })
    const data = parse(await server().get('list_expense_reports')!({ companyId: 'c1', status: 'all', mine: false, limit: 50 }))
    expect(guard.require).toHaveBeenCalledWith('c1', { entries: ['read'] })
    expect(expenseActorOf).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), 'c1')
    expect(listExpenseReports).toHaveBeenCalledWith('c1', { userId: 'u1', canManage: false }, { status: 'all', mine: false, search: undefined, limit: 50 })
    expect(data).toEqual({
      truncated: false,
      reports: [expect.objectContaining({ number: 'NDF-0001', claimant: 'Camille Martin', totalOwed: 261.6, recoverableVat: 10, charges: 251.6, status: 'posted', entryNumber: 'BR-4' })],
    })
  })

  it('reads one report with the recoverable VAT of each line and the reason', async () => {
    vi.mocked(getExpenseReport).mockResolvedValue({
      ...summary,
      returnNote: null,
      lines: [
        { kind: 'EXPENSE', date: '2026-03-10', supplierName: 'SNCF', label: 'Paris, Lyon', category: 'TRANSPORT', accountCode: null, amountInclTaxCents: 8_800, vatRateBp: 1000, vatCents: 800, recoverableVatCents: 0, recovery: 'Transport de personnes : TVA non récupérable (CGI ann. II art. 206, IV, 2, 5°)', receiptKind: 'INVOICE', receiptAttachmentId: null },
        { kind: 'MILEAGE', date: '2026-03-12', supplierName: null, label: 'Lyon, Grenoble', category: 'MILEAGE', accountCode: null, amountInclTaxCents: 6_360, vatRateBp: 0, vatCents: 0, recoverableVatCents: 0, recovery: 'Sans TVA', receiptKind: 'NONE', receiptAttachmentId: null, distanceKm: 100, vehicleType: 'CAR', fiscalPower: 5, electric: false, scaleYear: 2026, priorDistanceKm: 0 },
      ],
    } as never)
    const data = parse(await server().get('get_expense_report')!({ companyId: 'c1', reportId: 'ndf-1' }))
    expect(getExpenseReport).toHaveBeenCalledWith('c1', 'ndf-1', { userId: 'u1', canManage: false })
    expect(data.lines[0]).toMatchObject({ accountCode: '6251', amountPaid: 88, vat: 8, recoverableVat: 0, recovery: expect.stringMatching(/206, IV, 2, 5°/) })
    expect(data.lines[1]).toMatchObject({ amountPaid: 63.6, mileage: { distanceKm: 100, scaleYear: 2026 } })
  })

  it('answers "introuvable" for another person’s report or a company outside the grant', async () => {
    vi.mocked(getExpenseReport).mockRejectedValue(new NotFoundError('Note de frais introuvable'))
    expect(await server().get('get_expense_report')!({ companyId: 'c1', reportId: 'other' })).toEqual({ content: [{ type: 'text', text: 'Note de frais introuvable' }], isError: true })
    guard.require.mockRejectedValueOnce(new NotFoundError('Société introuvable'))
    expect((await server().get('list_expense_reports')!({ companyId: 'x', status: 'all', mine: false, limit: 5 })).isError).toBe(true)
    expect(listExpenseReports).not.toHaveBeenCalled()
  })
})

describe('create_draft_expense_report (full control)', () => {
  const args = {
    companyId: 'c1',
    periodStart: '2026-03-01',
    periodEnd: '2026-03-31',
    expenses: [
      { date: '2026-03-10', supplier: 'Brasserie', label: 'Déjeuner client', category: 'RECEPTION', amountPaid: 110, vatRate: 10, receipt: 'INVOICE' },
      { date: '2026-03-11', supplier: 'SNCF', label: 'Paris, Lyon', amountPaid: 88, vatRate: 10, receipt: 'INVOICE' },
    ],
    trips: [{ date: '2026-03-12', label: 'Lyon, Grenoble', distanceKm: 100, vehicle: 'CAR', fiscalPower: 5 }],
  }

  beforeEach(() => {
    db.company.findUniqueOrThrow.mockResolvedValue({ isVatExempt: false } as never)
  })

  it('is absent without full control', () => {
    expect(server().has('create_draft_expense_report')).toBe(false)
  })

  it('in validation mode, returns the recoverable VAT per line as a dry run and records a pending action, writing nothing', async () => {
    const data = parse(await server({ canAdmin: true }).get('create_draft_expense_report')!(args))
    expect(guard.requireFullControl).toHaveBeenCalledWith('c1', { expenses: ['submit'] })
    expect(data).toMatchObject({
      dryRun: true,
      actionId: 'action-1',
      preview: {
        totalOwed: 261.6,
        recoverableVat: 10,
        lines: [
          { category: 'RECEPTION', amount: 110, recoverableVat: 10 },
          // No category: the company's keyword rule "sncf" gives Transport, VAT not recoverable
          { category: 'TRANSPORT', amount: 88, recoverableVat: 0, recovery: expect.stringMatching(/Transport de personnes/) },
          { category: 'MILEAGE', amount: 63.6, recoverableVat: 0 },
        ],
      },
    })
    expect(createPendingAction).toHaveBeenCalled()
    expect(createExpenseReport).not.toHaveBeenCalled()
  })

  it('in automatic mode, records the report in cents for the user’s own claimant', async () => {
    vi.mocked(createExpenseReport).mockResolvedValue({ id: 'ndf-9', number: 'NDF-0009', status: 'draft', totalInclTaxCents: 26_160, recoverableVatCents: 1_000 } as never)
    const data = parse(await server({ canAdmin: true, executionMode: 'automatic' }).get('create_draft_expense_report')!(args))
    expect(createExpenseReport).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        claimantId: undefined,
        periodEnd: '2026-03-31',
        lines: [
          expect.objectContaining({ kind: 'EXPENSE', amountInclTaxCents: 11_000, vatRateBp: 1000, vatCents: null, category: 'RECEPTION', receiptKind: 'INVOICE' }),
          expect.objectContaining({ kind: 'EXPENSE', amountInclTaxCents: 8_800, category: undefined }),
          expect.objectContaining({ kind: 'MILEAGE', distanceKm: 100, vehicleType: 'CAR', fiscalPower: 5 }),
        ],
      }),
      { userId: 'u1', canManage: false },
      { source: 'mcp' },
    )
    expect(data).toMatchObject({ executed: true, result: { reportId: 'ndf-9', number: 'NDF-0009', status: 'draft', totalOwed: 261.6 } })
  })

  it('resolves a claimant by its auxiliary number and refuses an unknown one, and a report without lines', async () => {
    db.expenseClaimant.findFirst.mockResolvedValueOnce({ id: 'c-a' } as never)
    vi.mocked(createExpenseReport).mockResolvedValue({ id: 'ndf-10', number: 'NDF-0010', status: 'draft', totalInclTaxCents: 0, recoverableVatCents: 0 } as never)
    await server({ canAdmin: true, executionMode: 'automatic' }).get('create_draft_expense_report')!({ ...args, claimant: 'a00001' })
    expect(db.expenseClaimant.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 'c1', OR: [{ id: 'a00001' }, { auxiliaryAccountNumber: 'A00001' }] } }))
    expect(vi.mocked(createExpenseReport).mock.calls[0][1]).toMatchObject({ claimantId: 'c-a' })
    db.expenseClaimant.findFirst.mockResolvedValueOnce(null as never)
    expect((await server({ canAdmin: true, executionMode: 'automatic' }).get('create_draft_expense_report')!({ ...args, claimant: 'X1' })).isError).toBe(true)
    const empty = await server({ canAdmin: true, executionMode: 'automatic' }).get('create_draft_expense_report')!({ ...args, expenses: [], trips: [] })
    expect(empty.content[0].text).toMatch(/au moins une dépense/)
  })
})
