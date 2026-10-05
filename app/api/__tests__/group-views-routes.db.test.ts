/**
 * Routes of the group views against PostgreSQL (docs/vue-groupe.md), only
 * the session mocked: Structure (GET /api/group/structure), Fiscalité
 * (GET /api/group/tax) and the simple mode (GET /api/group/simple-home).
 *
 * A holding (Claire 60 %, Marc 40 %), Nord held at 100 % and Sud held at
 * 40 % by the holding and 10 % by Nord (Marc 5 % directly), Nord liable to
 * IS with a profit of 100 000 €, an advance of the holding to Nord.
 * - the user of the three companies sees the organigramme and the
 *   intégration fiscale worked out below;
 * - the user of the holding and Nord sees Sud as "Société non accessible",
 *   never its id, slug, SIREN or a figure, in any answer or export;
 * - the simple home shows the figures of the expert views to the cent;
 * - a non-member of the holding gets 404.
 * Run with KLEDG_RLS=enforce as well: each company is read in its own scope.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('group_views_routes')
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as { id: string; email: string; name: string; role: string } | null }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'
import type { GroupStructureReport } from '@/lib/group/get-group-structure.service'
import type { GroupTaxReport } from '@/lib/group/get-group-tax.service'
import type { GroupSummary } from '@/lib/group/get-group-summary.service'
import type { GroupTreasuryReport } from '@/lib/group/get-group-treasury.service'
import type { GroupView } from '@/lib/group/get-group-view.service'
import type { SimpleGroupHome } from '@/lib/group/simple-home'
import { jargonIn } from '@/lib/simple/vocabulary'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Module = Record<string, Handler>

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
const routes = {} as Record<string, Module>

const USERS = {
  group: { id: 'u-gv-group', email: 'gv-group@test.local', name: 'Comptable groupe', role: 'user' },
  partial: { id: 'u-gv-partial', email: 'gv-partial@test.local', name: 'Holding et Nord', role: 'user' },
  outsider: { id: 'u-gv-out', email: 'gv-out@test.local', name: 'Nord seule', role: 'user' },
}

const SIREN = { holding: '942000013', nord: '942000021', sud: '942000039' }
const NEW_ROUTES = ['structure', 'tax', 'simple-home'] as const

async function call(as: keyof typeof USERS, route: string, query: Record<string, string>) {
  state.user = USERS[as]
  return routes[route].GET(new NextRequest(`http://localhost/api/group/${route}?${new URLSearchParams(query)}`), { params: Promise.resolve({}) })
}

describe.skipIf(!available)('group views routes (PostgreSQL)', () => {
  let holding: Books
  let nord: Books
  let sud: Books
  const secrets = () => [sud.companyId, 'gv-sud', SIREN.sud]

  async function account(books: Books, code: string, label: string) {
    books.accounts[code] = (await prisma.account.create({ data: { companyId: books.companyId, fiscalYearId: books.fiscalYearId, code, label } })).id
  }

  async function entry(books: Books, description: string, lines: Array<[string, number, number]>, date: string) {
    return svc.createEntry({
      companyId: books.companyId,
      journalId: books.journals.OD,
      date,
      description,
      status: 'validated',
      lines: lines.map(([code, debit, credit]) => ({ accountId: books.accounts[code], debit: String(debit), credit: String(credit) })),
    })
  }

  beforeAll(async () => {
    await prepareTestDatabase('group_views_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    Object.assign(routes, {
      structure: await import('@/app/api/group/structure/route'),
      tax: await import('@/app/api/group/tax/route'),
      'simple-home': await import('@/app/api/group/simple-home/route'),
      summary: await import('@/app/api/group/summary/route'),
      view: await import('@/app/api/group/view/route'),
      treasury: await import('@/app/api/group/treasury/route'),
      export: await import('@/app/api/group/export/route'),
    })
  })

  beforeEach(async () => {
    await prepareTestDatabase('group_views_routes')
    holding = await seedBooks(prisma, svc, { siren: SIREN.holding, slug: 'gv-holding' })
    nord = await seedBooks(prisma, svc, { siren: SIREN.nord, slug: 'gv-nord' })
    sud = await seedBooks(prisma, svc, { siren: SIREN.sud, slug: 'gv-sud' })
    await prisma.company.update({ where: { id: holding.companyId }, data: { legalType: 'SAS', corporateTaxRegime: 'simplified' } })
    await prisma.company.update({ where: { id: nord.companyId }, data: { legalType: 'SAS', corporateTaxRegime: 'simplified' } })

    const claire = await prisma.person.create({ data: { companyId: holding.companyId, firstName: 'Claire', name: 'Vasseur', email: 'claire@exemple.test' } })
    const marc = await prisma.person.create({ data: { companyId: holding.companyId, firstName: 'Marc', name: 'Vasseur', email: 'marc@exemple.test' } })
    const marcInSud = await prisma.person.create({ data: { companyId: sud.companyId, firstName: 'Marc', name: 'Vasseur', email: 'marc@exemple.test' } })
    await prisma.shareholder.createMany({
      data: [
        { companyId: holding.companyId, type: 'PHYSICAL', personId: claire.id, sharePercentage: 60 },
        { companyId: holding.companyId, type: 'PHYSICAL', personId: marc.id, sharePercentage: 40 },
        { companyId: nord.companyId, type: 'LEGAL', companyShareholderId: holding.companyId, sharePercentage: 100 },
        { companyId: sud.companyId, type: 'LEGAL', companyShareholderId: holding.companyId, sharePercentage: 40 },
        { companyId: sud.companyId, type: 'LEGAL', companyShareholderId: nord.companyId, sharePercentage: 10 },
        { companyId: sud.companyId, type: 'PHYSICAL', personId: marcInSud.id, sharePercentage: 5 },
      ],
    })
    await prisma.accountsApproval.create({ data: { companyId: nord.companyId, fiscalYearId: nord.fiscalYearId, details: { officers: [{ name: 'Claire Vasseur', title: 'Présidente' }] } } })
    // The answers of the reduced rate and the deficits, as typed on each IS page.
    await prisma.corporateTaxReturn.create({ data: { companyId: holding.companyId, fiscalYearId: holding.fiscalYearId, capitalPaidUp: true, naturalPersons75: true, deficitsOpening: 0 } })
    await prisma.corporateTaxReturn.create({ data: { companyId: nord.companyId, fiscalYearId: nord.fiscalYearId, deficitsOpening: 0 } })

    for (const books of [holding, nord, sud]) await account(books, '101000', 'Capital')
    await account(holding, '451000', 'Groupe gv-nord')
    await account(nord, '455000', 'Compte courant gv-holding')
    await entry(holding, 'Apport en capital', [['512000', 200_000, 0], ['101000', 0, 200_000]], '2026-01-02')
    await entry(holding, 'Avance en compte courant', [['451000', 25_000, 0], ['512000', 0, 25_000]], '2026-02-01')
    await entry(nord, 'Avance de la holding', [['512000', 25_000, 0], ['455000', 0, 25_000]], '2026-02-01')
    await entry(nord, 'Ventes', [['512000', 100_000, 0], ['706000', 0, 100_000]], '2026-06-30')
    await entry(sud, 'Ventes', [['512000', 50_000, 0], ['706000', 0, 50_000]], '2026-03-15')

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

  it('draws the organigramme with the percentages, the indirect interests and the officers', async () => {
    const report = await json<GroupStructureReport>('group', 'structure')
    expect(report.nodes.map((n) => [n.label, n.kind, n.level])).toEqual([
      ['Claire Vasseur', 'person', 0],
      ['Marc Vasseur', 'person', 0],
      ['gv-holding', 'holding', 1],
      ['gv-nord', 'subsidiary', 2],
      ['gv-sud', 'subsidiary', 3],
    ])
    const sudNode = report.nodes.find((n) => n.label === 'gv-sud')!
    // 40 % directly, 100 % x 10 % through Nord.
    expect(sudNode.holdingInterest).toEqual({ directBp: 4000, indirectBp: 1000, totalBp: 5000 })
    // Marc: 5 % + 40 % x 50 % = 25 %.
    expect(sudNode.holders.find((h) => h.label === 'Marc Vasseur')).toMatchObject({ directBp: 500, indirectBp: 2000, totalBp: 2500 })
    expect(report.edges.find((e) => e.from === holding.companyId && e.to === nord.companyId)).toMatchObject({ bp: 10000, kind: 'filiale' })
    expect(report.nodes.find((n) => n.label === 'gv-nord')?.officers).toEqual([{ name: 'Claire Vasseur', title: 'Présidente' }])
    // Persons get positional ids: never an email.
    expect(JSON.stringify(report)).not.toContain('@exemple.test')
  })

  it('shows a subsidiary the user cannot read as "Société non accessible", without anything of it', async () => {
    const report = await json<GroupStructureReport>('partial', 'structure')
    const hidden = report.nodes.filter((n) => n.kind === 'hidden')
    expect(hidden).toEqual([expect.objectContaining({ id: 'hidden-1', label: 'Société non accessible', slug: null, holdingInterest: null })])
    expect(report.edges.find((e) => e.to === 'hidden-1')).toMatchObject({ from: holding.companyId, bp: null })
    // Marc's 5 % of Sud is in Sud's cap table: not read.
    expect(report.edges.some((e) => e.to === 'hidden-1' && e.bp !== null)).toBe(false)
    expect(report.unreachable).toEqual([{ name: null, reason: 'out_of_reach' }])
  })

  it('simulates the intégration fiscale: Nord at 100 % joins, Sud at 50 % does not, the reduced rate once', async () => {
    const report = await json<GroupTaxReport>('group', 'tax')
    expect(report.companies.map((c) => [c.company.name, c.status])).toEqual([
      ['gv-holding', 'ready'],
      ['gv-nord', 'ready'],
      ['gv-sud', 'missing-regime'],
    ])
    // Nord on its own: 100 000 € at 25 % (its capital conditions are not answered).
    expect(report.companies[1]).toMatchObject({ resultBeforeDeficitsCents: 10_000_000, corporateTaxCents: 2_500_000, reducedRateApplied: false })
    const sim = report.integration
    expect(sim.members.map((m) => [m.name, m.interestBp, m.member])).toEqual([
      ['gv-holding', null, true],
      ['gv-nord', 10000, true],
      ['gv-sud', 5000, false],
    ])
    // The group: 100 000 €, 15 % on 42 500 € (the holding's conditions are answered) and 25 % on 57 500 €.
    expect(sim.group).toMatchObject({ taxableProfitCents: 10_000_000, corporateTaxCents: 2_075_000, reducedRate: { applied: true } })
    expect(sim.separateTotalCents).toBe(2_500_000)
    expect(sim.savingCents).toBe(425_000)
    expect(report.parentSubsidiary.map((p) => [p.parent.name, p.subsidiary.name, p.stakeBp, p.eligible])).toEqual([
      ['gv-holding', 'gv-nord', 10000, true],
      ['gv-holding', 'gv-sud', 4000, true],
      ['gv-nord', 'gv-sud', 1000, true],
    ])
    // A typed retraitement in cents.
    const withProvision = await json<GroupTaxReport>('group', 'tax', { provisions: '1000000' })
    expect(withProvision.integration.resultBeforeDeficitsCents).toBe(11_000_000)
    expect((await call('group', 'tax', q({ provisions: '12.5' }))).status).toBe(400)
  })

  it('leaves a subsidiary not read out of the fiscal view and says so', async () => {
    const report = await json<GroupTaxReport>('partial', 'tax')
    expect(report.companies.map((c) => c.company.name)).toEqual(['gv-holding', 'gv-nord'])
    expect(report.integration.warnings[0]).toContain('Une filiale n’est pas lue')
    expect(report.integrationInput.companies.map((c) => c.id)).toEqual([holding.companyId, nord.companyId])
  })

  it('shows in simple mode the figures of the expert views, in plain words', async () => {
    const home = await json<SimpleGroupHome>('group', 'simple-home')
    const view = await json<GroupView>('group', 'view')
    const treasury = await json<GroupTreasuryReport>('group', 'treasury')
    expect(home.earnedCents).toBe(view.afterEliminations.resultatCents)
    expect(home.moneyCents).toBe(treasury.totalsByCurrency.find((t) => t.currency === 'EUR')?.balanceCents ?? 0)
    expect(home.companies.map((c) => [c.name, c.salesCents, c.profitCents])).toEqual(view.members.map((m) => [m.name, m.figures?.chiffreAffairesCents ?? null, m.figures?.resultatCents ?? null]))
    expect(home.owes.map((o) => o.text)).toEqual(['gv-nord doit 25 000,00 € à gv-holding'])
    const texts = [home.earnedTitle, ...home.owes.map((o) => o.text), ...home.flows.map((f) => f.text), ...home.notes, ...home.companies.map((c) => c.ownership)]
    expect(texts.flatMap(jargonIn)).toEqual([])
  })

  it('lists the shareholders of the holding for the avatar stack, largest first', async () => {
    const summary = await json<GroupSummary>('group', 'summary')
    expect(summary.shareholders).toEqual([
      { name: 'Claire Vasseur', photo: null, percentBp: 6000, kind: 'person' },
      { name: 'Marc Vasseur', photo: null, percentBp: 4000, kind: 'person' },
    ])
  })

  it('never gives anything of a subsidiary the user cannot read, in the new views or their exports', async () => {
    for (const route of NEW_ROUTES) {
      const response = await call('partial', route, q())
      const text = await response.text()
      expect(response.status, route).toBe(200)
      for (const secret of secrets()) expect(text, `${route} leaks ${secret}`).not.toContain(secret)
    }
    for (const report of ['structure', 'tax']) {
      const response = await call('partial', 'export', q({ report, format: 'csv' }))
      expect(response.status, report).toBe(200)
      const text = await response.text()
      for (const secret of secrets()) expect(text, `${report} export leaks ${secret}`).not.toContain(secret)
      expect(text).toContain(report === 'structure' ? 'Société non accessible' : 'Filiale non accessible')
    }
  })

  it('refuses a non-member of the holding (404)', async () => {
    for (const route of NEW_ROUTES) expect((await call('outsider', route, q())).status, route).toBe(404)
    expect((await call('outsider', 'export', q({ report: 'tax', format: 'csv' }))).status).toBe(404)
  })
})
