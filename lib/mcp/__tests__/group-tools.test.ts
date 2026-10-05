/**
 * MCP tools of the group view: get_group_view, get_participations, the
 * group space tools, get_group_structure and simulate_tax_integration. The
 * holding goes through the company guard with reports:read; every
 * subsidiary is reached through the same guard (the GroupAccess handed to
 * the services delegates to it), so the connection's company grant applies
 * to the subsidiaries too. Amounts in euros, percentages in percent.
 * Services are mocked: the database tests (app/api/__tests__/group-routes,
 * lib/__tests__/security/mcp-authorization) run them for real.
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
vi.mock('@/lib/group/get-group-view.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/group/get-group-view.service')>()), getGroupView: vi.fn() }))
vi.mock('@/lib/group/get-participations.service', () => ({ getParticipations: vi.fn() }))
vi.mock('@/lib/group/get-group-companies.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/group/get-group-companies.service')>()), getGroupCompanies: vi.fn() }))
vi.mock('@/lib/group/get-group-indicators.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/group/get-group-indicators.service')>()), getGroupIndicators: vi.fn() }))
vi.mock('@/lib/group/get-group-evolution.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/group/get-group-evolution.service')>()), getGroupEvolution: vi.fn() }))
vi.mock('@/lib/group/get-group-treasury.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/group/get-group-treasury.service')>()), getGroupTreasury: vi.fn() }))
vi.mock('@/lib/group/get-group-persons.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/group/get-group-persons.service')>()), getGroupPersons: vi.fn() }))
vi.mock('@/lib/group/get-group-deadlines.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/group/get-group-deadlines.service')>()), getGroupDeadlines: vi.fn() }))
vi.mock('@/lib/group/get-group-alerts.service', () => ({ getGroupAlerts: vi.fn() }))
vi.mock('@/lib/group/list-group-transactions.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/group/list-group-transactions.service')>()), listGroupTransactions: vi.fn() }))
vi.mock('@/lib/group/get-group-structure.service', () => ({ getGroupStructure: vi.fn() }))
vi.mock('@/lib/group/get-group-tax.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/group/get-group-tax.service')>()), getGroupTax: vi.fn() }))
vi.mock('@/lib/group/get-group-ledger.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/group/get-group-ledger.service')>()), getGroupLedger: vi.fn() }))

import { registerKledgTools } from '@/lib/mcp/tools'
import { getGroupView, type GroupView } from '@/lib/group/get-group-view.service'
import { getParticipations, type ParticipationsReport } from '@/lib/group/get-participations.service'
import { ZERO_FIGURES } from '@/lib/group/combine'
import type { GroupAccess } from '@/lib/management-fees/access'
import { NotFoundError } from '@/lib/accounting/errors'
import type { ToolResult } from '@/lib/mcp/tool-result'
import { getGroupCompanies } from '@/lib/group/get-group-companies.service'
import { getGroupIndicators } from '@/lib/group/get-group-indicators.service'
import { getGroupEvolution } from '@/lib/group/get-group-evolution.service'
import { getGroupTreasury } from '@/lib/group/get-group-treasury.service'
import { getGroupPersons } from '@/lib/group/get-group-persons.service'
import { getGroupDeadlines } from '@/lib/group/get-group-deadlines.service'
import { getGroupAlerts } from '@/lib/group/get-group-alerts.service'
import { listGroupTransactions } from '@/lib/group/list-group-transactions.service'
import { getGroupLedger } from '@/lib/group/get-group-ledger.service'
import { summarizeDeadlines } from '@/lib/group/deadline-summary'
import { getGroupStructure } from '@/lib/group/get-group-structure.service'
import { getGroupTax } from '@/lib/group/get-group-tax.service'
import { buildGroupStructure } from '@/lib/group/structure'
import { simulateTaxIntegration, type IntegrationInput } from '@/lib/group/tax-integration'
import { computeFinancialIndicators } from '@/lib/reports/financial-indicators/indicators'

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
const fy = { id: 'fy', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' }

beforeEach(() => {
  vi.clearAllMocks()
  guard.require.mockImplementation(async () => {})
})

describe('get_group_view', () => {
  it('reads the holding through the guard, every subsidiary through the same guard, and answers in euros', async () => {
    vi.mocked(getGroupView).mockImplementation(async (_holding, _query, access: GroupAccess) => {
      await access.require('s1', { reports: ['read'] })
      const figures = { ...ZERO_FIGURES, chiffreAffairesCents: 1_234_550 }
      return {
        holding: { id: 'h1', name: 'Holding' },
        fiscalYear: fy,
        members: [
          { id: 'h1', name: 'Holding', slug: 'holding', siren: null, role: 'holding', ownershipBp: null, fiscalYear: fy, samePeriod: true, figures },
          { id: 's1', name: 'Filiale Nord', slug: 'filiale-nord', siren: null, role: 'subsidiary', ownershipBp: 8000, fiscalYear: fy, samePeriod: true, figures },
        ],
        unreachable: [{ name: null, reason: 'out_of_reach' }],
        truncated: 0,
        combined: { ...figures, chiffreAffairesCents: 2_469_100 },
        eliminations: {
          operations: [{ sellerId: 'h1', buyerId: 's1', categories: ['management_fee'], revenueCents: 100_000, chargeCents: 90_000, gapCents: 10_000 }],
          dividends: [],
          balances: [],
          effect: { ...ZERO_FIGURES, chiffreAffairesCents: -100_000 },
        },
        afterEliminations: { ...figures, chiffreAffairesCents: 2_369_100 },
        flows: [],
        treasury: [{ month: '2026-01', totalCents: 50_000, byCompany: {} }],
        titresParticipationCents: 0,
        warnings: [],
      } satisfies GroupView
    })
    const data = parse(await server().get('get_group_view')!({ companyId: 'h1' }))
    expect(guard.require).toHaveBeenCalledWith('h1', { reports: ['read'] })
    expect(guard.require).toHaveBeenCalledWith('s1', { reports: ['read'] })
    expect(data.companies[1]).toMatchObject({ name: 'Filiale Nord', ownershipPercent: 80, figures: { revenue: 12345.5 } })
    expect(data).toMatchObject({ notAccessibleSubsidiaries: 1, notAccessibleNames: [], combined: { revenue: 24691 }, afterEliminations: { revenue: 23691 } })
    expect(data.operations).toEqual([{ seller: 'Holding', buyer: 'Filiale Nord', kinds: ['Frais de gestion'], revenue: 1000, charges: 900, gap: 100 }])
    expect(data.notice).toContain('ANC 2020-01')
  })

  it('answers an error when the holding is outside the grant, without calling the service', async () => {
    guard.require.mockRejectedValueOnce(new NotFoundError('Société introuvable'))
    const result = await server().get('get_group_view')!({ companyId: 'other' })
    expect(result.isError).toBe(true)
    expect(getGroupView).not.toHaveBeenCalled()
  })
})

describe('get_participations', () => {
  it('reports the participations in euros and percent', async () => {
    vi.mocked(getParticipations).mockResolvedValue({
      holding: { id: 'h1', name: 'Holding' },
      fiscalYear: fy,
      rows: [
        {
          subsidiaryId: 's1',
          name: 'Filiale Nord',
          siren: '931000020',
          kind: 'filiale',
          ownershipBp: 8000,
          numberOfShares: 800,
          bookValueGrossCents: 8_000_000,
          depreciationCents: 0,
          bookValueNetCents: 8_000_000,
          fiscalYear: fy,
          samePeriod: true,
          capitalCents: 1_000_000,
          capitauxPropresCents: 9_000_000,
          quotePartCents: 7_200_000,
          chiffreAffairesCents: 10_000_000,
          resultatCents: 9_000_000,
          loansCents: 2_500_000,
          dividendsCents: 1_500_000,
        },
      ],
      unreachable: [],
      unattributed: [{ accountCode: '261200', label: 'Titres B', cents: 3_000_000 }],
      totals: { bookValueGrossCents: 8_000_000, depreciationCents: 0, bookValueNetCents: 8_000_000, dividendsCents: 1_500_000 },
    } satisfies ParticipationsReport)
    const data = parse(await server().get('get_participations')!({ companyId: 'h1', fiscalYearId: 'fy' }))
    expect(guard.require).toHaveBeenCalledWith('h1', { reports: ['read'] })
    expect(getParticipations).toHaveBeenCalledWith('h1', { fiscalYearId: 'fy' }, expect.objectContaining({ userId: 'u1' }))
    expect(data.participations[0]).toMatchObject({ category: 'Filiale (plus de 50 %)', ownershipPercent: 80, bookValueNet: 80000, equityShare: 72000, dividendsReceived: 15000 })
    expect(data.unattributedInvestments).toEqual([{ account: '261200', label: 'Titres B', amount: 30000 }])
  })
})

describe('group space tools', () => {
  const holding = { id: 'h1', name: 'Holding', slug: 'holding', role: 'holding' as const, ownershipBp: null }
  const nord = { id: 's1', name: 'Filiale Nord', slug: 'filiale-nord', role: 'subsidiary' as const, ownershipBp: 8000 }
  const perimeter = { unreachable: [{ name: null, reason: 'out_of_reach' as const }], truncated: 0, warnings: ['Une filiale n’est pas lue'] }

  it('refuses every group space tool when the holding is outside the grant, without calling its service', async () => {
    const tools = server()
    for (const name of ['get_group_companies', 'get_group_indicators', 'get_group_evolution', 'get_group_treasury', 'get_group_shareholders', 'get_group_deadlines', 'get_group_alerts', 'list_group_transactions', 'get_group_ledger', 'get_group_structure', 'simulate_tax_integration']) {
      guard.require.mockRejectedValueOnce(new NotFoundError('Société introuvable'))
      const result = await tools.get(name)!({ companyId: 'other' })
      expect(result.isError, name).toBe(true)
    }
    for (const service of [getGroupCompanies, getGroupIndicators, getGroupEvolution, getGroupTreasury, getGroupPersons, getGroupDeadlines, getGroupAlerts, listGroupTransactions, getGroupLedger, getGroupStructure, getGroupTax]) {
      expect(service).not.toHaveBeenCalled()
    }
  })

  it('get_group_companies answers the companies in euros with their officers', async () => {
    vi.mocked(getGroupCompanies).mockResolvedValue({
      holding: { id: 'h1', name: 'Holding' },
      fiscalYear: fy,
      companies: [{ company: nord, siren: '931000020', legalType: 'SAS', legalForm: null, logo: null, shareCapitalCents: 100_000, numberOfShares: 100, officers: [{ name: 'Claire Martin', title: 'Présidente' }], fiscalYear: fy, samePeriod: true, figures: { ...ZERO_FIGURES, chiffreAffairesCents: 1_000_050 } }],
      ...perimeter,
    })
    const data = parse(await server().get('get_group_companies')!({ companyId: 'h1' }))
    expect(guard.require).toHaveBeenCalledWith('h1', { reports: ['read'] })
    expect(data.companies[0]).toMatchObject({ name: 'Filiale Nord', ownershipPercent: 80, legalForm: 'SAS', officers: [{ name: 'Claire Martin', title: 'Présidente' }], figures: { revenue: 10000.5 } })
    expect(data.notAccessibleSubsidiaries).toBe(1)
  })

  it('get_group_indicators answers each company and the aggregate, ratios as fractions', async () => {
    const accounts = [
      { code: '706000', debitCents: 0, creditCents: 10_000_000 },
      { code: '641000', debitCents: 4_000_000, creditCents: 0 },
    ]
    const current = computeFinancialIndicators({ accounts, vat: { collecteeCents: 0, deductibleCents: 0 }, days: 365 })
    vi.mocked(getGroupIndicators).mockResolvedValue({
      holding: { id: 'h1', name: 'Holding' },
      fiscalYear: fy,
      members: [{ company: nord, fiscalYear: fy, previousFiscalYear: null, samePeriod: true, current, previous: null }],
      combined: { current, previous: null },
      notice: 'Agrégat du groupe',
      ...perimeter,
    })
    const data = parse(await server().get('get_group_indicators')!({ companyId: 'h1' }))
    expect(data.companies[0].current).toMatchObject({ revenue: 100000, ebitda: 60000, ebitdaMargin: 0.6 })
    expect(data.companies[0].previous).toBeNull()
    expect(data.aggregate.current.netResult).toBe(60000)
  })

  it('get_group_evolution answers month by month in euros', async () => {
    vi.mocked(getGroupEvolution).mockResolvedValue({
      holding: { id: 'h1', name: 'Holding' },
      fiscalYear: fy,
      companies: [nord],
      months: [{ month: '2026-01', byCompany: { s1: { produitsCents: 150_000, chargesCents: 50_000, resultatCents: 100_000, tresorerieCents: null } }, total: { produitsCents: 150_000, chargesCents: 50_000, resultatCents: 100_000, tresorerieCents: null } }],
      totals: { byCompany: {}, total: { produitsCents: 150_000, chargesCents: 50_000, resultatCents: 100_000 } },
      ...perimeter,
    })
    const data = parse(await server().get('get_group_evolution')!({ companyId: 'h1' }))
    expect(data.months[0]).toEqual({ month: '2026-01', total: { income: 1500, expenses: 500, result: 1000, cash: null }, byCompany: [{ company: 'Filiale Nord', income: 1500, expenses: 500, result: 1000, cash: null }] })
  })

  it('get_group_treasury answers masked accounts and current accounts in euros', async () => {
    vi.mocked(getGroupTreasury).mockResolvedValue({
      holding: { id: 'h1', name: 'Holding' },
      fiscalYear: fy,
      companies: [{ company: nord, accounts: [{ id: 'a1', companyId: 's1', name: 'Compte courant', maskedIban: 'FR76 •••• 1234', provider: 'MANUAL', currency: 'EUR', balanceCents: 250_000, lastSyncedAt: null }], bankEurCents: 250_000, ledgerCents: 240_000 }],
      totalsByCurrency: [{ currency: 'EUR', balanceCents: 250_000 }],
      ledgerTotalCents: 240_000,
      months: [],
      currentAccounts: [{ creditorId: 'h1', debtorId: 's1', categories: ['current_account'], receivableCents: 2_500_000, payableCents: 2_500_000, eliminatedCents: 2_500_000, gapCents: 0 }],
      currentAccountLines: [],
      ...perimeter,
    })
    const data = parse(await server().get('get_group_treasury')!({ companyId: 'h1' }))
    expect(data.companies[0].accounts[0]).toMatchObject({ iban: 'FR76 •••• 1234', balance: 2500 })
    expect(data.totalsByCurrency).toEqual([{ currency: 'EUR', balance: 2500 }])
    expect(data.currentAccounts[0]).toMatchObject({ debtor: 'Filiale Nord', receivable: 25000, gap: 0 })
  })

  it('get_group_shareholders answers percentages, never a photo, and hides an unread subsidiary', async () => {
    vi.mocked(getGroupPersons).mockResolvedValue({
      holding: { id: 'h1', name: 'Holding' },
      companies: [holding, nord],
      holders: [
        { holderId: 'holder-1', kind: 'person', name: 'Claire Martin', photo: 'data:image/png;base64,AAAA', groupCompany: null, titles: [{ companyId: 's1', title: 'Présidente' }], interests: [{ companyId: 's1', directBp: 0, indirectBp: 4800, totalBp: 4800, shares: null }] },
        { holderId: 'holder-2', kind: 'company', name: null, photo: null, groupCompany: null, titles: [], interests: [{ companyId: 's1', directBp: 1000, indirectBp: 0, totalBp: 1000, shares: 10 }] },
      ],
      ...perimeter,
    })
    const result = await server().get('get_group_shareholders')!({ companyId: 'h1' })
    const data = parse(result)
    expect(result.content[0].text).not.toContain('base64')
    expect(data.holders[0]).toEqual({ name: 'Claire Martin', kind: 'person', officerOf: [{ company: 'Filiale Nord', title: 'Présidente' }], holdings: [{ company: 'Filiale Nord', directPercent: 0, indirectPercent: 48, totalPercent: 48, shares: null }] })
    expect(data.holders[1].name).toBe('Filiale non accessible')
  })

  it('get_group_deadlines and get_group_alerts answer the tracker of the group', async () => {
    vi.mocked(getGroupDeadlines).mockResolvedValue({
      holding: { id: 'h1', name: 'Holding' },
      fiscalYear: fy,
      today: '2026-10-05',
      companies: [{ company: nord, fiscalYear: { id: 'fy', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' }, missingRegimes: false, summary: summarizeDeadlines([]) }],
      deadlines: [{ companyId: 's1', id: 'cfe:2026', label: 'CFE 2026', form: '1447', category: 'cfe', column: 'cfe', date: '2026-12-15', lateAfter: '2026-12-15', estimated: false, status: 'todo', statusLabel: 'À faire', settled: false, amountCents: 120_000 }],
      totals: { overdue: 0, pending: 1, settled: 0 },
      ...perimeter,
    })
    const deadlines = parse(await server().get('get_group_deadlines')!({ companyId: 'h1' }))
    expect(deadlines.deadlines).toEqual([{ company: 'Filiale Nord', date: '2026-12-15', label: 'CFE 2026', form: '1447', status: 'À faire', settled: false, amount: 1200 }])

    vi.mocked(getGroupAlerts).mockResolvedValue({
      companies: [{ company: nord, overdue: 1, unreconciled: 3, drafts: 2 }],
      overdue: [{ companyId: 's1', deadlineId: 'tva-ca3:2026-08', label: 'TVA août', form: 'CA3', category: 'tva', date: '2026-09-24' }],
      totals: { overdue: 1, unreconciled: 3, drafts: 2 },
      ...perimeter,
    })
    const alerts = parse(await server().get('get_group_alerts')!({ companyId: 'h1' }))
    expect(alerts.companies).toEqual([{ name: 'Filiale Nord', lateDeclarations: 1, transactionsToReconcile: 3, draftEntries: 2 }])
    expect(alerts.lateDeclarations).toEqual([{ company: 'Filiale Nord', label: 'TVA août', form: 'CA3', dueOn: '2026-09-24' }])
  })

  it('list_group_transactions passes the filters and the cursor, and answers euros', async () => {
    vi.mocked(listGroupTransactions).mockResolvedValue({
      companies: [nord],
      items: [{ id: 't1', companyId: 's1', date: '2026-03-02', at: '2026-03-02T00:00:00.000Z', label: 'Loyer', counterpartyName: null, reference: null, amountCents: 120_000, side: 'debit', reconciled: false, bankAccountName: 'Compte courant' }],
      nextCursor: 'next',
      ...perimeter,
    })
    const data = parse(await server().get('list_group_transactions')!({ companyId: 'h1', reconciled: false, cursor: 'abc', limit: 10 }))
    expect(listGroupTransactions).toHaveBeenCalledWith('h1', expect.objectContaining({ reconciled: 'false', cursor: 'abc', limit: 10 }), expect.objectContaining({ userId: 'u1' }))
    expect(data).toMatchObject({ nextCursor: 'next', transactions: [{ company: 'Filiale Nord', amount: 1200, side: 'debit', reconciled: false }] })
  })

  it('get_group_ledger answers the combined accounts and the lines of one account', async () => {
    vi.mocked(getGroupLedger).mockResolvedValue({
      holding: { id: 'h1', name: 'Holding' },
      fiscalYear: fy,
      notice: 'Grand livre combiné',
      companies: [{ ...nord, fiscalYear: fy }],
      accounts: [{ code: '512000', label: 'Banque', byCompany: { s1: { debitCents: 300_000, creditCents: 100_000, balanceCents: 200_000 } }, total: { debitCents: 300_000, creditCents: 100_000, balanceCents: 200_000 } }],
      total: { debitCents: 300_000, creditCents: 100_000, balanceCents: 200_000 },
      detail: { code: '512000', lines: [{ companyId: 's1', date: '2026-02-01', journal: 'BQ', entryNumber: '1', label: 'Apport', debitCents: 300_000, creditCents: 0 }], truncated: false },
      ...perimeter,
    })
    const data = parse(await server().get('get_group_ledger')!({ companyId: 'h1', account: '512000' }))
    expect(getGroupLedger).toHaveBeenCalledWith('h1', { fiscalYearId: undefined, prefix: undefined, account: '512000' }, expect.anything())
    expect(data.accounts[0]).toEqual({ account: '512000', label: 'Banque', byCompany: [{ company: 'Filiale Nord', debit: 3000, credit: 1000, balance: 2000 }], total: { debit: 3000, credit: 1000, balance: 2000 } })
    expect(data.lines).toEqual([{ company: 'Filiale Nord', date: '2026-02-01', journal: 'BQ', entry: '1', label: 'Apport', debit: 3000, credit: 0 }])
  })

  it('get_group_structure answers the organigramme in percent, a subsidiary not read without name nor id', async () => {
    vi.mocked(getGroupStructure).mockResolvedValue({
      ...buildGroupStructure({
        holdingId: 'h1',
        companies: [
          { id: 'h1', name: 'Holding', slug: 'holding', role: 'holding', logo: null, legalType: 'SAS', officers: [] },
          { id: 's1', name: 'Filiale Nord', slug: 'filiale-nord', role: 'subsidiary', logo: null, legalType: 'SAS', officers: [{ name: 'Claire Vasseur', title: 'Présidente' }] },
        ],
        hidden: [{ key: 'hidden-1', name: null }],
        holders: [{ key: 'holder-1', kind: 'person', name: 'Claire Vasseur', photo: 'data:image/png;base64,AAAA' }],
        holdings: [
          { holderKey: 'holder-1', companyKey: 'h1', bp: 6000 },
          { holderKey: 'company:h1', companyKey: 's1', bp: 8000 },
          { holderKey: 'company:h1', companyKey: 'hidden-1', bp: null },
        ],
      }),
      holding: { id: 'h1', name: 'Holding', slug: 'holding' },
      ...perimeter,
    })
    const result = await server().get('get_group_structure')!({ companyId: 'h1' })
    const body = parse(result)
    expect(guard.require).toHaveBeenCalledWith('h1', { reports: ['read'] })
    expect(body.holdings).toEqual([
      { holder: 'Claire Vasseur', company: 'Holding', percent: 60, kind: null },
      { holder: 'Holding', company: 'Filiale Nord', percent: 80, kind: 'Filiale (plus de 50 %)' },
      { holder: 'Holding', company: 'Société non accessible', percent: null, kind: null },
    ])
    expect(body.nodes.find((n: { name: string }) => n.name === 'Filiale Nord')).toMatchObject({ holdingInterest: { directPercent: 80, indirectPercent: 0, totalPercent: 80 }, officers: [{ name: 'Claire Vasseur', title: 'Présidente' }] })
    expect(JSON.stringify(body)).not.toContain('base64')
    expect(body.notAccessibleSubsidiaries).toBe(1)
  })

  it('simulate_tax_integration passes the typed retraitements in cents and answers in euros', async () => {
    const year = { startDate: '2026-01-01', endDate: '2026-12-31', months: 12 }
    const company = (id: string, result: number, tax: number) => ({ id, name: id, role: (id === 'h1' ? 'holding' : 'subsidiary') as 'holding' | 'subsidiary', status: 'ready' as const, fiscalYear: year, resultBeforeDeficitsCents: result, deficitsOpeningCents: 0, turnoverCents: 0, separateTaxCents: tax, separateSocialCents: 0, capitalPaidUp: true, naturalPersons75: true })
    const integrationInput: IntegrationInput = {
      holdingId: 'h1',
      companies: [company('h1', -3_000_000, 0), company('s1', 4_000_000, 600_000)],
      holdings: [{ holderId: 'h1', companyId: 's1', bp: 10000 }],
      parentHeldByCompany: false,
      dividends: [],
      managementFees: [],
      manual: { provisions: 120_000 },
      unreachable: 0,
    }
    vi.mocked(getGroupTax).mockResolvedValue({
      holding: { id: 'h1', name: 'Holding' },
      fiscalYear: fy,
      companies: [],
      parentSubsidiary: [{ parent: holding, subsidiary: nord, stakeBp: 10000, eligible: true, dividendsCents: 50_000, applied: true }],
      integration: simulateTaxIntegration(integrationInput),
      integrationInput,
      ...perimeter,
    })
    const body = parse(await server().get('simulate_tax_integration')!({ companyId: 'h1', fiscalYearId: 'fy', provisions: 1200 }))
    expect(vi.mocked(getGroupTax).mock.calls[0][1]).toMatchObject({ fiscalYearId: 'fy', provisions: 120_000 })
    // 40 000 - 30 000 + 1 200 = 11 200 € at 15 %: 1 680 €; separately 6 000 €.
    expect(body.integration).toMatchObject({ possible: true, groupResultBeforeDeficits: 11_200, groupTax: { corporateTax: 1_680 }, separateTotal: 6_000, saving: 4_320 })
    expect(body.parentSubsidiary).toEqual([{ parent: 'Holding', subsidiary: 'Filiale Nord', stakePercent: 100, eligible: true, dividends: 500, appliedInParentTax: true }])
    expect(body.notice).toContain('Simulation indicative')
    expect(body.integration.sources.length).toBeGreaterThan(5)
  })
})
