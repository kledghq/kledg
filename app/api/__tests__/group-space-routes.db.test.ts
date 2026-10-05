/**
 * Routes of the group space against PostgreSQL (docs/vue-groupe.md), with
 * only the session mocked: a holding and two subsidiaries (Nord 80 %, Sud
 * 40 %, Nord also holds 10 % of Sud), two natural persons holding the
 * holding (one also holding Sud directly), bank accounts and transactions,
 * a current account between the holding and Nord, a draft, an approval
 * naming an officer and a tax regime giving Nord its VAT deadlines.
 *
 * - a user of the three companies sees every figure, worked out below;
 * - a user of the holding and of Nord never receives anything of Sud: not
 *   its id, name, SIREN nor a transaction label, in any page or export;
 * - a non-member of the holding gets 404 everywhere; a company filter on a
 *   company the user cannot read is a 404; a forged cursor a 400.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('group_space_routes')
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as { id: string; email: string; name: string; role: string } | null }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'
import type { GroupSummary } from '@/lib/group/get-group-summary.service'
import type { GroupAlerts } from '@/lib/group/get-group-alerts.service'
import type { GroupCompaniesReport } from '@/lib/group/get-group-companies.service'
import type { GroupIndicatorsReport } from '@/lib/group/get-group-indicators.service'
import type { GroupEvolutionReport } from '@/lib/group/get-group-evolution.service'
import type { GroupTreasuryReport } from '@/lib/group/get-group-treasury.service'
import type { GroupPersonsReport } from '@/lib/group/get-group-persons.service'
import type { GroupDeadlinesReport } from '@/lib/group/get-group-deadlines.service'
import type { GroupTransactionsPage } from '@/lib/group/list-group-transactions.service'
import type { GroupLedgerReport } from '@/lib/group/get-group-ledger.service'
import { GROUP_REPORTS } from '@/lib/group/export-group.service'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Module = Record<string, Handler>

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
const routes = {} as Record<string, Module>

const USERS = {
  group: { id: 'u-gs-group', email: 'gs-group@test.local', name: 'Comptable groupe', role: 'user' },
  partial: { id: 'u-gs-partial', email: 'gs-partial@test.local', name: 'Holding et Nord', role: 'user' },
  outsider: { id: 'u-gs-out', email: 'gs-out@test.local', name: 'Nord seule', role: 'user' },
}

const SIREN = { holding: '941000014', nord: '941000022', sud: '941000030' }
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const ROUTE_NAMES = ['summary', 'alerts', 'companies', 'indicators', 'evolution', 'treasury', 'persons', 'deadlines', 'transactions', 'ledger'] as const

async function call(as: keyof typeof USERS, route: string, query: Record<string, string>) {
  state.user = USERS[as]
  return routes[route].GET(new NextRequest(`http://localhost/api/group/${route}?${new URLSearchParams(query)}`), { params: Promise.resolve({}) })
}

describe.skipIf(!available)('group space routes (PostgreSQL)', () => {
  let holding: Books
  let nord: Books
  let sud: Books
  const secrets = () => [sud.companyId, 'grp-sud', SIREN.sud, 'Secret Sud']

  async function account(books: Books, code: string, label: string) {
    books.accounts[code] = (await prisma.account.create({ data: { companyId: books.companyId, fiscalYearId: books.fiscalYearId, code, label } })).id
  }

  async function entry(books: Books, description: string, lines: Array<[string, number, number]>, date: string, status: 'draft' | 'validated' = 'validated') {
    return svc.createEntry({
      companyId: books.companyId,
      journalId: books.journals.OD,
      date,
      description,
      status,
      lines: lines.map(([code, debit, credit]) => ({ accountId: books.accounts[code], debit: String(debit), credit: String(credit) })),
    })
  }

  async function transactions(books: Books, balance: string, rows: Array<{ id: string; date: string; amount: string; side: 'debit' | 'credit'; label: string; reconciled: boolean }>) {
    const bank = await prisma.bankAccount.findFirstOrThrow({ where: { bankConnection: { companyId: books.companyId } } })
    await prisma.bankAccount.update({ where: { id: bank.id }, data: { balance, iban: 'FR7630006000011234567890189' } })
    for (const row of rows) {
      await prisma.bankTransaction.create({
        data: { bankAccountId: bank.id, externalTransactionId: row.id, amount: row.amount, date: new Date(`${row.date}T00:00:00Z`), side: row.side, label: row.label, reconciled: row.reconciled },
      })
    }
  }

  beforeAll(async () => {
    await prepareTestDatabase('group_space_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    Object.assign(routes, {
      summary: await import('@/app/api/group/summary/route'),
      alerts: await import('@/app/api/group/alerts/route'),
      companies: await import('@/app/api/group/companies/route'),
      indicators: await import('@/app/api/group/indicators/route'),
      evolution: await import('@/app/api/group/evolution/route'),
      treasury: await import('@/app/api/group/treasury/route'),
      persons: await import('@/app/api/group/persons/route'),
      deadlines: await import('@/app/api/group/deadlines/route'),
      transactions: await import('@/app/api/group/transactions/route'),
      ledger: await import('@/app/api/group/ledger/route'),
      export: await import('@/app/api/group/export/route'),
    })
  })

  beforeEach(async () => {
    await prepareTestDatabase('group_space_routes')
    holding = await seedBooks(prisma, svc, { siren: SIREN.holding, slug: 'grp-holding' })
    nord = await seedBooks(prisma, svc, { siren: SIREN.nord, slug: 'grp-nord' })
    sud = await seedBooks(prisma, svc, { siren: SIREN.sud, slug: 'grp-sud' })
    await prisma.company.update({ where: { id: nord.companyId }, data: { legalType: 'SAS', vatRegime: 'normal', corporateTaxRegime: 'normal' } })

    // Capital: Claire 60 % and Marc 40 % of the holding; the holding 80 % of Nord, 40 % of Sud; Nord 10 % and Marc 5 % of Sud.
    const claire = await prisma.person.create({ data: { companyId: holding.companyId, firstName: 'Claire', name: 'Vasseur', email: 'claire@exemple.test', photo: PHOTO } })
    const marc = await prisma.person.create({ data: { companyId: holding.companyId, firstName: 'Marc', name: 'Vasseur', email: 'marc@exemple.test' } })
    const marcInSud = await prisma.person.create({ data: { companyId: sud.companyId, firstName: 'Marc', name: 'Vasseur', email: 'MARC@exemple.test' } })
    await prisma.shareholder.createMany({
      data: [
        { companyId: holding.companyId, type: 'PHYSICAL', personId: claire.id, sharePercentage: 60, numberOfShares: 600 },
        { companyId: holding.companyId, type: 'PHYSICAL', personId: marc.id, sharePercentage: 40, numberOfShares: 400 },
        { companyId: nord.companyId, type: 'LEGAL', companyShareholderId: holding.companyId, sharePercentage: 80, numberOfShares: 800 },
        { companyId: sud.companyId, type: 'LEGAL', companyShareholderId: holding.companyId, sharePercentage: 40 },
        { companyId: sud.companyId, type: 'LEGAL', companyShareholderId: nord.companyId, sharePercentage: 10 },
        { companyId: sud.companyId, type: 'PHYSICAL', personId: marcInSud.id, sharePercentage: 5 },
      ],
    })
    await prisma.accountsApproval.create({ data: { companyId: nord.companyId, fiscalYearId: nord.fiscalYearId, details: { officers: [{ name: 'Claire Vasseur', title: 'Présidente' }] } } })

    for (const books of [holding, nord, sud]) await account(books, '101000', 'Capital')
    await account(holding, '451000', 'Groupe grp-nord')
    await account(nord, '455000', 'Compte courant grp-holding')
    await entry(holding, 'Apport en capital', [['512000', 200_000, 0], ['101000', 0, 200_000]], '2026-01-02')
    await entry(holding, 'Avance en compte courant', [['451000', 25_000, 0], ['512000', 0, 25_000]], '2026-02-01')
    await entry(nord, 'Avance de la holding', [['512000', 25_000, 0], ['455000', 0, 25_000]], '2026-02-01')
    await entry(nord, 'Ventes', [['512000', 100_000, 0], ['706000', 0, 100_000]], '2026-06-30')
    await entry(nord, 'Ventes à valider', [['512000', 500, 0], ['706000', 0, 500]], '2026-07-01', 'draft')
    await entry(sud, 'Ventes', [['512000', 50_000, 0], ['706000', 0, 50_000]], '2026-03-15')

    await transactions(holding, '1750.00', [
      { id: 'h1', date: '2026-03-01', amount: '1000.00', side: 'credit', label: 'Virement client', reconciled: false },
      { id: 'h2', date: '2026-03-03', amount: '200.00', side: 'debit', label: 'Frais bancaires', reconciled: true },
    ])
    await transactions(nord, '1250.00', [
      { id: 'n1', date: '2026-03-02', amount: '300.00', side: 'debit', label: 'Loyer Nord', reconciled: false },
      { id: 'n2', date: '2026-03-03', amount: '80.00', side: 'debit', label: 'Abonnement Nord', reconciled: false },
    ])
    await transactions(sud, '500.00', [{ id: 's1', date: '2026-03-04', amount: '42.00', side: 'debit', label: 'Secret Sud', reconciled: false }])

    for (const books of [holding, nord, sud]) await seedMembership(prisma, USERS.group.id, books.companyId, 'accountant')
    await seedMembership(prisma, USERS.partial.id, holding.companyId, 'accountant')
    await seedMembership(prisma, USERS.partial.id, nord.companyId, 'accountant')
    await seedMembership(prisma, USERS.outsider.id, nord.companyId, 'companyAdmin')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  const q = (extra: Record<string, string> = {}) => ({ companyId: holding.companyId, fiscalYearId: holding.fiscalYearId, ...extra })
  async function json<T>(as: keyof typeof USERS, route: string, extra: Record<string, string> = {}): Promise<T> {
    const response = await call(as, route, q(extra))
    expect(response.status, `${route} ${await response.clone().text()}`).toBe(200)
    return (await response.json()) as T
  }

  it('names the group, counts its companies and shows the main shareholder', async () => {
    const summary = await json<GroupSummary>('group', 'summary')
    expect(summary).toMatchObject({ name: 'Groupe grp-holding', readableCount: 3, unreadableCount: 0, mainShareholder: { name: 'Claire Vasseur', photo: PHOTO, percentBp: 6000, kind: 'person' } })
    expect(await json<GroupSummary>('partial', 'summary')).toMatchObject({ readableCount: 2, unreadableCount: 1 })
  })

  it('lists the companies with their stake, officers and key figures', async () => {
    const report = await json<GroupCompaniesReport>('group', 'companies')
    expect(report.companies.map((c) => [c.company.name, c.company.role, c.company.ownershipBp])).toEqual([
      ['grp-holding', 'holding', null],
      ['grp-nord', 'subsidiary', 8000],
      ['grp-sud', 'subsidiary', 4000],
    ])
    const n = report.companies[1]
    expect(n.officers).toEqual([{ name: 'Claire Vasseur', title: 'Présidente', photo: null }])
    expect(n.figures).toMatchObject({ chiffreAffairesCents: 10_000_000, tresorerieCents: 12_500_000 })
    expect(n.legalType).toBe('SAS')
  })

  it('compares the companies N and N-1 and aggregates them', async () => {
    const report = await json<GroupIndicatorsReport>('group', 'indicators')
    expect(report.members.map((m) => m.current?.sig.chiffreAffairesCents)).toEqual([0, 10_000_000, 5_000_000])
    expect(report.members[1].previous?.sig.chiffreAffairesCents).toBe(0)
    // The aggregate adds the books up: CA 150 000, cash 350 000.
    expect(report.combined.current?.sig.chiffreAffairesCents).toBe(15_000_000)
    expect(report.combined.current?.bilan.disponibilitesCents).toBe(35_000_000)
    expect(report.notice).toContain('pas des comptes consolidés')
  })

  it('gives the produits and cash month by month', async () => {
    const report = await json<GroupEvolutionReport>('group', 'evolution')
    expect(report.totals.total.produitsCents).toBe(15_000_000)
    expect(report.totals.byCompany[nord.companyId]).toEqual({ produitsCents: 10_000_000, chargesCents: 0, resultatCents: 10_000_000 })
    const march = report.months.find((m) => m.month === '2026-03')
    expect(march?.total.produitsCents).toBe(5_000_000)
    expect(march?.byCompany[holding.companyId].tresorerieCents).toBe(17_500_000)
  })

  it('gives the bank balances, the cash and the current accounts between companies', async () => {
    const report = await json<GroupTreasuryReport>('group', 'treasury')
    expect(report.totalsByCurrency).toEqual([{ currency: 'EUR', balanceCents: 350_000 }])
    expect(report.companies[0].accounts[0]).toMatchObject({ maskedIban: 'FR76 •••• 0189', balanceCents: 175_000 })
    expect(JSON.stringify(report)).not.toContain('FR7630006000011234567890189')
    expect(report.ledgerTotalCents).toBe(35_000_000)
    expect(report.currentAccounts).toEqual([
      { creditorId: holding.companyId, debtorId: nord.companyId, categories: ['current_account'], receivableCents: 2_500_000, payableCents: 2_500_000, eliminatedCents: 2_500_000, gapCents: 0 },
    ])
  })

  it('gives the direct and indirect holdings of the persons, with their photo and titles', async () => {
    const report = await json<GroupPersonsReport>('group', 'persons')
    const claire = report.holders.find((h) => h.name === 'Claire Vasseur')
    const marc = report.holders.find((h) => h.name === 'Marc Vasseur')
    expect(claire).toMatchObject({ kind: 'person', photo: PHOTO, titles: [{ companyId: nord.companyId, title: 'Présidente' }] })
    const pct = (h: typeof claire, id: string) => h?.interests.find((i) => i.companyId === id)
    expect(pct(claire, holding.companyId)).toMatchObject({ directBp: 6000, totalBp: 6000, shares: 600 })
    expect(pct(claire, nord.companyId)).toMatchObject({ directBp: 0, indirectBp: 4800, totalBp: 4800 })
    // 60 % x (40 % + 80 % x 10 %) = 28.8 %.
    expect(pct(claire, sud.companyId)).toMatchObject({ directBp: 0, indirectBp: 2880, totalBp: 2880 })
    // Marc is recorded in the holding and in Sud: one person (same email). 5 % + 40 % x 48 %.
    expect(report.holders.filter((h) => h.name === 'Marc Vasseur')).toHaveLength(1)
    expect(pct(marc, sud.companyId)).toMatchObject({ directBp: 500, indirectBp: 1920, totalBp: 2420 })
    // The holding itself, a company of the group.
    const h = report.holders.find((x) => x.groupCompany?.id === holding.companyId)
    expect(pct(h, sud.companyId)).toMatchObject({ directBp: 4000, indirectBp: 800, totalBp: 4800 })
    // No personal data beyond the name and the photo.
    expect(JSON.stringify(report)).not.toContain('exemple.test')
  })

  it("shows each company's tracker, as recorded in the company", async () => {
    let report = await json<GroupDeadlinesReport>('group', 'deadlines')
    const nordRow = report.companies.find((c) => c.company.id === nord.companyId)
    expect(nordRow?.missingRegimes).toBe(false)
    expect(nordRow?.summary.tva.total).toBe(12)
    expect(report.warnings.some((w) => w.startsWith('grp-holding') && w.includes('aucun régime de TVA'))).toBe(true)
    const first = report.deadlines.find((d) => d.companyId === nord.companyId && d.id.startsWith('tva-ca3:'))
    expect(first?.settled).toBe(false)
    // The VAT return is recorded on the VAT page of Nord (the tracker reads it from there).
    const period = first!.id.slice('tva-ca3:'.length)
    const [y, m] = period.split('-').map(Number)
    await prisma.vatReturnFiling.create({
      data: {
        companyId: nord.companyId,
        form: 'CA3',
        periodKey: period,
        periodStart: new Date(Date.UTC(y, m - 1, 1)),
        periodEnd: new Date(Date.UTC(y, m, 0)),
        filedOn: new Date(Date.UTC(y, m, 10)),
        amountDue: '120.00',
        creditAmount: '0',
      },
    })
    // A deadline the tracker owns, recorded on Nord's Échéances page.
    const approval = report.deadlines.find((d) => d.companyId === nord.companyId && d.column === 'approval' && d.id.startsWith('depot-comptes:'))
    expect(approval).toBeDefined()
    await prisma.declarationStatus.create({ data: { companyId: nord.companyId, deadlineId: approval!.id, notDue: true } })
    report = await json<GroupDeadlinesReport>('group', 'deadlines')
    expect(report.deadlines.find((d) => d.companyId === nord.companyId && d.id === first!.id)).toMatchObject({ status: 'paid', statusLabel: 'Payée', settled: true, amountCents: 12_000 })
    expect(report.deadlines.find((d) => d.companyId === nord.companyId && d.id === approval!.id)).toMatchObject({ status: 'not-due', settled: true })
  })

  it('counts what needs attention in each company', async () => {
    const report = await json<GroupAlerts>('group', 'alerts')
    expect(report.companies.map((c) => [c.company.name, c.unreconciled, c.drafts])).toEqual([
      ['grp-holding', 1, 0],
      ['grp-nord', 2, 1],
      ['grp-sud', 1, 0],
    ])
    expect(report.totals).toMatchObject({ unreconciled: 4, drafts: 1 })
    expect(report.overdue.every((d) => d.companyId === nord.companyId)).toBe(true)
  })

  it('merges the transactions of the companies newest first, page by page', async () => {
    const seen: GroupTransactionsPage['items'] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page: GroupTransactionsPage = await json<GroupTransactionsPage>('group', 'transactions', { limit: '2', ...(cursor ? { cursor } : {}) })
      seen.push(...page.items)
      cursor = page.nextCursor
      pages += 1
    } while (cursor && pages < 10)
    expect(pages).toBe(3)
    expect(seen.map((t) => t.date)).toEqual(['2026-03-04', '2026-03-03', '2026-03-03', '2026-03-02', '2026-03-01'])
    expect(new Set(seen.map((t) => t.id)).size).toBe(5)
    expect(seen[0]).toMatchObject({ companyId: sud.companyId, label: 'Secret Sud', amountCents: 4200, side: 'debit', reconciled: false })

    const filtered = await json<GroupTransactionsPage>('group', 'transactions', { company: 'grp-nord', reconciled: 'false' })
    expect(filtered.items.map((t) => t.label)).toEqual(['Abonnement Nord', 'Loyer Nord'])
    const searched = await json<GroupTransactionsPage>('group', 'transactions', { search: 'loyer' })
    expect(searched.items.map((t) => t.label)).toEqual(['Loyer Nord'])
  })

  it('combines the ledger by account and lists one account in every company', async () => {
    const report = await json<GroupLedgerReport>('group', 'ledger', { prefix: '512', account: '512000' })
    expect(report.accounts.map((a) => a.code)).toEqual(['512000'])
    expect(report.accounts[0].byCompany[nord.companyId].balanceCents).toBe(12_500_000)
    expect(report.accounts[0].total.balanceCents).toBe(35_000_000)
    // Validated lines only: the draft of Nord is not there.
    expect(report.detail?.lines.map((l) => [l.date, l.debitCents, l.creditCents])).toEqual([
      ['2026-06-30', 10_000_000, 0],
      ['2026-03-15', 5_000_000, 0],
      ['2026-02-01', 2_500_000, 0],
      ['2026-02-01', 0, 2_500_000],
      ['2026-01-02', 20_000_000, 0],
    ])
    expect(report.notice).toContain('pas une consolidation')
  })

  it('never gives anything of a subsidiary the user cannot read, in any page or export', async () => {
    for (const route of ROUTE_NAMES) {
      const extra: Record<string, string> = route === 'ledger' ? { account: '512000' } : {}
      const response = await call('partial', route, q(extra))
      const text = await response.text()
      expect(response.status, route).toBe(200)
      for (const secret of secrets()) expect(text, `${route} leaks ${secret}`).not.toContain(secret)
    }
    for (const report of GROUP_REPORTS) {
      for (const format of ['csv', 'xlsx']) {
        const response = await call('partial', 'export', q({ report, format, account: '512000' }))
        expect(response.status, `${report} ${format}`).toBe(200)
        const body = Buffer.from(await response.arrayBuffer())
        // The workbook is a zip: its sheets are compressed, so read the CSV for the text check.
        if (format === 'csv') for (const secret of secrets()) expect(body.toString('utf8'), `${report} leaks ${secret}`).not.toContain(secret)
      }
    }
    // The figures of the partial user: Sud is counted, not read.
    const transactions = await json<GroupTransactionsPage>('partial', 'transactions')
    expect(transactions.items).toHaveLength(4)
    expect(transactions.unreachable).toEqual([{ name: null, reason: 'out_of_reach' }])
    const indicators = await json<GroupIndicatorsReport>('partial', 'indicators')
    expect(indicators.combined.current?.sig.chiffreAffairesCents).toBe(10_000_000)
    const persons = await json<GroupPersonsReport>('partial', 'persons')
    expect(persons.holders.find((h) => h.name === 'Claire Vasseur')?.interests.map((i) => i.companyId).sort()).toEqual([holding.companyId, nord.companyId].sort())
    expect(persons.warnings.some((w) => w.includes('indirects'))).toBe(true)
  })

  it('exports the transactions of the group with the labels the user reads', async () => {
    const response = await call('group', 'export', q({ report: 'transactions', format: 'csv' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('Transactions_du_groupe_grp_holding_2026.csv')
    const text = await response.text()
    expect(text).toContain('Secret Sud')
    expect(text).toContain('-42,00')
  })

  it('refuses a non-member of the holding (404), a company filter outside the group (404), a forged cursor (400)', async () => {
    for (const route of ROUTE_NAMES) expect((await call('outsider', route, q())).status, route).toBe(404)
    expect((await call('outsider', 'export', q({ report: 'persons', format: 'csv' }))).status).toBe(404)
    const hidden = await call('partial', 'transactions', q({ company: sud.companyId }))
    expect(hidden.status).toBe(404)
    expect((await hidden.json()).error).toBe('Société introuvable dans ce groupe.')
    const forged = await call('group', 'transactions', q({ cursor: 'forged' }))
    expect(forged.status).toBe(400)
    expect((await call('group', 'ledger', q({ prefix: '6x' }))).status).toBe(400)
  })
})
