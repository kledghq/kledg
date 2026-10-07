/**
 * MCP tools of the local taxes and of the declarations tracker
 * (lib/mcp/local-tax-tools.ts, lib/mcp/drafts/declarations.ts):
 * get_local_taxes and list_declarations_status read with reports:read at
 * every level, amounts in euros; mark_declaration exists only with
 * kledg:write, checks entries:create, sends the amount in cents to the
 * service and is audited. Services are mocked (the PostgreSQL tests of
 * lib/declarations and lib/local-taxes run them). Kledg never files nor pays.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const guard = vi.hoisted(() => ({
  require: vi.fn(async () => {}),
  requireFullControl: vi.fn(async () => {}),
  companyWhere: vi.fn(async () => ({})),
  companyIds: vi.fn(async () => null),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('@/lib/mcp/company-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/company-access')>()),
  companyGuard: () => guard,
}))
vi.mock('@/lib/local-taxes/load-local-taxes.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/local-taxes/load-local-taxes.service')>()),
  loadLocalTaxes: vi.fn(),
}))
vi.mock('@/lib/deadlines/load-deadlines.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/deadlines/load-deadlines.service')>()),
  loadDeadlinesView: vi.fn(),
}))
vi.mock('@/lib/declarations/mark-declaration.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/declarations/mark-declaration.service')>()),
  markDeclaration: vi.fn(),
  clearDeclaration: vi.fn(),
}))

import { registerKledgTools } from '@/lib/mcp/tools'
import { loadLocalTaxes, type LocalTaxesView } from '@/lib/local-taxes/load-local-taxes.service'
import { loadDeadlinesView, type DeadlinesView } from '@/lib/deadlines/load-deadlines.service'
import { clearDeclaration, markDeclaration } from '@/lib/declarations/mark-declaration.service'
import { deriveStatus, type TrackedDeadline } from '@/lib/declarations/status'
import type { Deadline } from '@/lib/deadlines/types'
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

const TODAY = '2026-10-05'
const tracked = (d: Partial<Deadline>, paidOn: string | null = null): TrackedDeadline => {
  const deadline: Deadline = { id: 'cfe:2026', date: '2026-12-15', legalDate: '2026-12-15', label: 'Paiement de la CFE 2026', form: 'CFE', category: 'cfe', ruleId: 'cfe', estimated: false, projected: false, ...d }
  const record = paidOn
    ? { filedOn: null, paidOn, amountCents: 175_000, notDue: false, attachmentId: null, attachmentName: null, attachmentReference: 'Télépaiement 4321', note: null, updatedAt: null }
    : null
  return { ...deadline, status: deriveStatus(deadline, null, record, TODAY) }
}

const ACOMPTE = tracked({ id: 'cfe-acompte:2026', ruleId: 'cfe-acompte', date: '2026-06-15', label: 'Acompte de CFE 2026' }, '2026-06-12')
const CFE = tracked({})
const LATE = tracked({ id: 'is-solde:2025-12-31', ruleId: 'is-solde', category: 'is', date: '2026-05-15', label: 'Solde de l’IS', form: '2572' })

const VIEW = {
  today: TODAY,
  year: 2026,
  years: [2027, 2026, 2025],
  foundationYear: 2020,
  settings: { cfeAcompte: false, cfeChanges: false, cvae: true, cvaeDue: true, cvaeAcomptes: false },
  cfe: {
    situation: 'normal',
    avis: { totalCents: 400_000, acompteCents: null, noticeOn: '2026-09-20', note: null },
    previous: { year: 2025, totalCents: 350_000 },
    schedule: { acompteCents: 175_000, acompteFrom: 'previous-year', balanceCents: 225_000 },
    expected: { year: 2026, cents: 400_000, source: 'avis', account: { code: '63511', label: 'Contribution économique territoriale' }, months: [{ month: '2026-06', cents: 175_000 }, { month: '2026-12', cents: 225_000 }] },
    minimum: { referenceYear: 2024, turnoverCents: null, exempt: null },
    drafts: { acompte: { reference: 'CFE-2026-AC', status: 'none', entryId: null, entryNumber: null }, solde: { reference: 'CFE-2026-SOLDE', status: 'none', entryId: null, entryNumber: null } },
  },
  cvae: {
    year: 2026,
    status: 'in-force',
    maxRate: '0,28 %',
    period: { fiscalYears: [], months: 12, days: 365, estimate: true },
    books: { turnoverCents: 270_000_000, sigValueAddedCents: 120_000_000, subsidiesCents: 0, otherProductsCents: 0, chargeTransfersCents: 0, otherChargesCents: 0, valueAddedCents: 120_000_000 },
    adjustments: [{ id: 'cb', label: 'Loyers de crédit-bail', amountCents: 30_000_000 }],
    adjustmentsCents: 30_000_000,
    turnoverAnnualCents: 270_000_000,
    computation: {
      year: 2026,
      status: 'in-force',
      declarationRequired: true,
      taxable: true,
      valueAdded: { beforeCapCents: 150_000_000, capCents: 216_000_000, capped: false, cents: 150_000_000 },
      rateHundredths: 8,
      rateLabel: '0,08 %',
      grossCents: 120_000,
      degrevementCents: 0,
      cvaeCents: 120_000,
      franchise: false,
      complementaryCents: 0,
      totalCents: 120_000,
    },
    previous: { year: 2025, cvaeCents: 0 },
    acomptes: { due: false, eachCents: null },
    hints: [],
  },
  plafonnement: { rate: 1531, ceilingCents: 2_296_500, excessCents: 0 },
  deadlines: [ACOMPTE, CFE],
  sources: [{ label: 'CGI, art. 1586 quater', url: 'https://www.legifrance.gouv.fr/' }],
} as unknown as LocalTaxesView

const CALENDAR = {
  today: TODAY,
  fiscalYear: { id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false },
  deadlines: [LATE, ACOMPTE, CFE],
  rules: [],
  settings: {},
  missingRegimes: false,
} as unknown as DeadlinesView

beforeEach(() => vi.clearAllMocks())

describe('get_local_taxes', () => {
  it('reads the CFE and the CVAE of a year in euros, with reports:read, at every access level', async () => {
    vi.mocked(loadLocalTaxes).mockResolvedValue(VIEW)
    const data = parse(await tools(false).get('get_local_taxes')!({ companyId: 'c1', year: 2026 }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(loadLocalTaxes).toHaveBeenCalledWith('c1', { year: 2026 })
    expect(data.cfe).toMatchObject({ acompte: 1_750, balance: 2_250, acompteFrom: 'previous-year', expectedCharge: { amount: 4_000, account: '63511', months: [{ month: '2026-06', amount: 1_750 }, { month: '2026-12', amount: 2_250 }] } })
    expect(data.cvae).toMatchObject({ status: 'in-force', maxRate: '0,28 %', rate: '0,08 %', cvae: 1_200, valueAdded: { retained: 1_500_000, adjustments: [{ label: 'Loyers de crédit-bail', amount: 300_000 }] } })
    expect(data.cvae.summary).toMatch(/0,08 %/)
    expect(data.plafonnement).toMatchObject({ rate: '1,531 %', ceiling: 22_965, possibleRelief: 0 })
    expect(data.deadlines[0]).toMatchObject({ deadlineId: 'cfe-acompte:2026', status: 'paid', paidOn: '2026-06-12', amount: 1_750, attachmentReference: 'Télépaiement 4321' })
    expect(data.reviewUrl).toMatch(/impots-locaux\?annee=2026$/)
  })

  it('refuses a company outside the connection’s grant', async () => {
    guard.require.mockRejectedValueOnce(Object.assign(new Error('Société introuvable'), { name: 'NotFoundError' }))
    const result = await tools(false).get('get_local_taxes')!({ companyId: 'other' })
    expect(result.isError).toBe(true)
    expect(loadLocalTaxes).not.toHaveBeenCalled()
  })
})

describe('list_declarations_status', () => {
  it('lists the deadlines with their status, filtered, with the counts', async () => {
    vi.mocked(loadDeadlinesView).mockResolvedValue(CALENDAR)
    const all = parse(await tools(false).get('list_declarations_status')!({ companyId: 'c1' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(all.counts).toEqual({ todo: 1, filed: 0, paid: 1, overdue: 1, 'not-due': 0 })
    expect(all.deadlines.map((d: { deadlineId: string }) => d.deadlineId)).toEqual(['is-solde:2025-12-31', 'cfe-acompte:2026', 'cfe:2026'])
    const late = parse(await tools(false).get('list_declarations_status')!({ companyId: 'c1', status: 'overdue' }))
    expect(late.deadlines).toEqual([expect.objectContaining({ deadlineId: 'is-solde:2025-12-31', statusLabel: 'En retard', kind: 'pay', settled: false })])
    const open = parse(await tools(false).get('list_declarations_status')!({ companyId: 'c1', category: 'cfe', unsettledOnly: true }))
    expect(open.deadlines.map((d: { deadlineId: string }) => d.deadlineId)).toEqual(['cfe:2026'])
  })
})

describe('mark_declaration', () => {
  it('exists only with kledg:write', () => {
    expect(tools(false).has('mark_declaration')).toBe(false)
    expect(tools(true).has('mark_declaration')).toBe(true)
  })

  it('records a payment with entries:create, the amount in cents, and audits the call', async () => {
    vi.mocked(markDeclaration).mockResolvedValue(ACOMPTE)
    const data = parse(await tools(true).get('mark_declaration')!({ companyId: 'c1', deadlineId: 'cfe-acompte:2026', paidOn: '2026-06-12', amount: 1750, attachmentReference: ' Télépaiement 4321 ' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { entries: ['create'] })
    expect(markDeclaration).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ deadlineId: 'cfe-acompte:2026', paidOn: '2026-06-12', amountCents: 175_000, attachmentReference: 'Télépaiement 4321' }),
      { userId: 'u1', source: 'mcp' },
    )
    expect(data).toMatchObject({ changes: { deadlineId: 'cfe-acompte:2026', status: 'paid' }, deadline: { status: 'paid' } })
    expect(data.message).toMatch(/Payée/)
    expect(writeAuditLog).toHaveBeenCalledWith('info', expect.stringContaining('mark_declaration'), expect.objectContaining({ action: 'MCP_WRITE', companyId: 'c1' }))
  })

  it('clears a record, and asks for something to record', async () => {
    vi.mocked(clearDeclaration).mockResolvedValue(CFE)
    const cleared = parse(await tools(true).get('mark_declaration')!({ companyId: 'c1', deadlineId: 'cfe:2026', clear: true }))
    expect(clearDeclaration).toHaveBeenCalledWith('c1', 'cfe:2026', { source: 'mcp' })
    expect(cleared.changes).toMatchObject({ cleared: true, status: 'todo' })
    const empty = await tools(true).get('mark_declaration')!({ companyId: 'c1', deadlineId: 'cfe:2026' })
    expect(empty.isError).toBe(true)
    expect(markDeclaration).not.toHaveBeenCalled()
  })
})
