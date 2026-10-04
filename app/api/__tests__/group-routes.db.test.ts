/**
 * Routes of the group view against PostgreSQL, with only the session
 * mocked (roles come from the members of the database): a holding and two
 * subsidiaries, with management fee invoices, a current account, trade
 * balances and dividends between them.
 * - a user of the three companies sees the three, the flows and the
 *   eliminations;
 * - a user of the holding and of one subsidiary sees the holding and that
 *   subsidiary; the other one is counted as not accessible, never read: its
 *   id, name and SIREN are nowhere in the answers, its flows are not
 *   eliminated;
 * - a member of a subsidiary whose role cannot read reports sees it named
 *   and not read; a non-member of the holding gets 404; a read-only role
 *   cannot export.
 * The authorization matrix covers every role on every route.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('group_routes')
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as { id: string; email: string; name: string; role: string } | null }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'
import type { GroupView } from '@/lib/group/get-group-view.service'
import type { ParticipationsReport } from '@/lib/group/get-participations.service'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Module = Record<string, Handler>

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
const routes = {} as Record<string, Module>

const USERS = {
  group: { id: 'u-group', email: 'group@test.local', name: 'Comptable groupe', role: 'user' },
  partial: { id: 'u-partial', email: 'partial@test.local', name: 'Holding et Nord', role: 'user' },
  lowRole: { id: 'u-low', email: 'low@test.local', name: 'Rôle limité', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Lecture seule', role: 'user' },
  outsider: { id: 'u-out', email: 'out@test.local', name: 'Filiale seule', role: 'user' },
}

async function call(as: keyof typeof USERS, route: string, path: string) {
  state.user = USERS[as]
  return routes[route].GET(new NextRequest(`http://localhost${path}`), { params: Promise.resolve({}) })
}

const SIREN = { holding: '931000012', nord: '931000020', sud: '931000038' }

describe.skipIf(!available)('group view routes (PostgreSQL)', () => {
  let holding: Books
  let nord: Books
  let sud: Books

  async function account(books: Books, code: string, label: string) {
    const created = await prisma.account.create({ data: { companyId: books.companyId, fiscalYearId: books.fiscalYearId, code, label } })
    books.accounts[code] = created.id
    return created.id
  }

  async function entry(books: Books, description: string, lines: Array<[string, number, number, string?]>, date = '2026-06-30') {
    return svc.createEntry({
      companyId: books.companyId,
      journalId: books.journals.OD,
      date,
      description,
      status: 'validated',
      lines: lines.map(([code, debit, credit, aux]) => ({ accountId: books.accounts[code], debit: String(debit), credit: String(credit), auxiliaryAccountNumber: aux ?? null })),
    })
  }

  /** A management fee invoice from the holding to `sub`, booked and validated on both sides. */
  async function feeInvoice(sub: Books, subSiren: string, amount: number, number: string, aux: { customer: string; supplier: string }) {
    const vat = amount / 5
    const customer = await prisma.tiers.create({ data: { companyId: holding.companyId, kind: 'CUSTOMER', name: `Client ${number}`, siren: subSiren, auxiliaryAccountNumber: aux.customer } })
    const sale = await entry(holding, `Facture ${number}`, [['411000', amount + vat, 0, aux.customer], ['706000', 0, amount], ['445710', 0, vat]])
    await prisma.invoice.create({
      data: {
        companyId: holding.companyId,
        direction: 'SALE',
        tiersId: customer.id,
        number,
        issueDate: new Date('2026-06-30T00:00:00Z'),
        dueDate: new Date('2026-07-30T00:00:00Z'),
        buyerSiren: subSiren,
        totalExclTax: amount,
        totalVat: vat,
        totalInclTax: amount + vat,
        entryId: sale.id,
      },
    })
    const supplier = await prisma.tiers.create({ data: { companyId: sub.companyId, kind: 'SUPPLIER', name: 'Holding', siren: SIREN.holding, auxiliaryAccountNumber: aux.supplier } })
    const purchase = await entry(sub, `Facture ${number}`, [['6226', amount, 0], ['445660', vat, 0], ['401000', 0, amount + vat, aux.supplier]])
    await prisma.invoice.create({
      data: {
        companyId: sub.companyId,
        direction: 'PURCHASE',
        tiersId: supplier.id,
        number,
        issueDate: new Date('2026-06-30T00:00:00Z'),
        dueDate: new Date('2026-07-30T00:00:00Z'),
        sellerSiren: SIREN.holding,
        totalExclTax: amount,
        totalVat: vat,
        totalInclTax: amount + vat,
        entryId: purchase.id,
      },
    })
  }

  beforeAll(async () => {
    await prepareTestDatabase('group_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    Object.assign(routes, {
      view: await import('@/app/api/group/view/route'),
      participations: await import('@/app/api/group/participations/route'),
      export: await import('@/app/api/group/export/route'),
    })
  })

  beforeEach(async () => {
    await prepareTestDatabase('group_routes')
    holding = await seedBooks(prisma, svc, { siren: SIREN.holding, slug: 'grp-holding' })
    nord = await seedBooks(prisma, svc, { siren: SIREN.nord, slug: 'grp-nord' })
    sud = await seedBooks(prisma, svc, { siren: SIREN.sud, slug: 'grp-sud' })
    await prisma.shareholder.create({ data: { companyId: nord.companyId, type: 'LEGAL', sharePercentage: 80, numberOfShares: 800, companyShareholderId: holding.companyId } })
    await prisma.shareholder.create({ data: { companyId: sud.companyId, type: 'LEGAL', sharePercentage: 40, companyShareholderId: holding.companyId } })

    for (const books of [holding, nord, sud]) await account(books, '101000', 'Capital')
    await account(holding, '261100', 'Titres grp-nord')
    await account(holding, '261200', 'Titres de participation B')
    await account(holding, '451000', 'Groupe grp-nord')
    await account(holding, '761000', 'Produits de participations')
    await account(nord, '455000', 'Compte courant grp-holding')
    for (const books of [nord, sud]) await account(books, '6226', 'Honoraires')

    await entry(holding, 'Apport en capital', [['512000', 200_000, 0], ['101000', 0, 200_000]], '2026-01-02')
    await entry(holding, 'Acquisition des titres', [['261100', 80_000, 0], ['261200', 30_000, 0], ['512000', 0, 110_000]], '2026-01-03')
    // Current account: the holding lends 25 000 to Nord.
    await entry(holding, 'Avance en compte courant', [['451000', 25_000, 0], ['512000', 0, 25_000]], '2026-02-01')
    await entry(nord, 'Avance de la holding', [['512000', 25_000, 0], ['455000', 0, 25_000]], '2026-02-01')
    // Dividends from Nord, recognised by the entry description.
    await entry(holding, 'Dividendes grp-nord 2025', [['512000', 15_000, 0], ['761000', 0, 15_000]], '2026-05-15')
    // Each subsidiary's own sales.
    await entry(nord, 'Ventes', [['512000', 100_000, 0], ['706000', 0, 100_000]])
    await entry(sud, 'Ventes', [['512000', 50_000, 0], ['706000', 0, 50_000]])
    // Management fees: 10 000 HT to Nord, 5 000 HT to Sud.
    await feeInvoice(nord, SIREN.nord, 10_000, 'FG-2026-001', { customer: 'C00010', supplier: 'F00010' })
    await feeInvoice(sud, SIREN.sud, 5_000, 'FG-2026-002', { customer: 'C00011', supplier: 'F00011' })

    for (const books of [holding, nord, sud]) await seedMembership(prisma, USERS.group.id, books.companyId, 'accountant')
    await seedMembership(prisma, USERS.partial.id, holding.companyId, 'accountant')
    await seedMembership(prisma, USERS.partial.id, nord.companyId, 'accountant')
    await seedMembership(prisma, USERS.lowRole.id, holding.companyId, 'accountant')
    await seedMembership(prisma, USERS.lowRole.id, nord.companyId, 'member')
    for (const books of [holding, nord, sud]) await seedMembership(prisma, USERS.viewer.id, books.companyId, 'viewer')
    await seedMembership(prisma, USERS.outsider.id, nord.companyId, 'companyAdmin')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  const viewPath = () => `/api/group/view?companyId=${holding.companyId}&fiscalYearId=${holding.fiscalYearId}`

  it('combines the three companies of a user who reads them all, and eliminates their flows', async () => {
    const response = await call('group', 'view', viewPath())
    expect(response.status).toBe(200)
    const view = (await response.json()) as GroupView
    expect(view.members.map((m) => [m.name, m.role, m.ownershipBp])).toEqual([
      ['grp-holding', 'holding', null],
      ['grp-nord', 'subsidiary', 8000],
      ['grp-sud', 'subsidiary', 4000],
    ])
    expect(view.unreachable).toEqual([])
    // CA: holding 15 000 (fees), Nord 100 000, Sud 50 000.
    expect(view.combined.chiffreAffairesCents).toBe(16_500_000)
    expect(view.afterEliminations.chiffreAffairesCents).toBe(15_000_000)
    // Result: holding 15 000 + 15 000 dividends, Nord 90 000, Sud 45 000; after: dividends out, fees net to zero.
    expect(view.combined.resultatCents).toBe(16_500_000)
    expect(view.afterEliminations.resultatCents).toBe(15_000_000)
    const operation = (buyerId: string) => view.eliminations.operations.find((p) => p.buyerId === buyerId)
    expect(view.eliminations.operations).toHaveLength(2)
    expect(operation(nord.companyId)).toEqual({ sellerId: holding.companyId, buyerId: nord.companyId, categories: ['invoice'], revenueCents: 1_000_000, chargeCents: 1_000_000, gapCents: 0 })
    expect(operation(sud.companyId)).toMatchObject({ sellerId: holding.companyId, revenueCents: 500_000, chargeCents: 500_000, gapCents: 0 })
    expect(view.eliminations.dividends).toEqual([{ receiverId: holding.companyId, payerId: nord.companyId, cents: 1_500_000 }])
    // Current account 25 000 (by label), trade 12 000 and 6 000 TTC (by tiers SIREN).
    const balances = Object.fromEntries(view.eliminations.balances.map((b) => [`${b.creditorId === holding.companyId ? 'h' : '?'}>${b.debtorId === nord.companyId ? 'nord' : 'sud'}`, b.eliminatedCents]))
    expect(balances).toEqual({ 'h>nord': 3_700_000, 'h>sud': 600_000 })
    expect(view.eliminations.effect.totalBilanCents).toBe(-4_300_000)
    // Treasury: holding 80 000, Nord 125 000, Sud 50 000 at the end of the year.
    expect(view.combined.tresorerieCents).toBe(25_500_000)
    expect(view.treasury.at(-1)?.totalCents).toBe(25_500_000)
    expect(view.titresParticipationCents).toBe(11_000_000)
    expect(view.warnings.some((w) => w.includes('titres de participation'))).toBe(true)
  })

  it('counts a subsidiary the user cannot reach, never reads it and never names it', async () => {
    const response = await call('partial', 'view', viewPath())
    expect(response.status).toBe(200)
    const text = await response.text()
    const view = JSON.parse(text) as GroupView
    expect(view.members.map((m) => m.name)).toEqual(['grp-holding', 'grp-nord'])
    expect(view.unreachable).toEqual([{ name: null, reason: 'out_of_reach' }])
    for (const secret of [sud.companyId, 'grp-sud', SIREN.sud]) expect(text).not.toContain(secret)
    // Only Nord's flows are eliminated; the fee invoiced to Sud stays in the holding's revenue.
    expect(view.combined.chiffreAffairesCents).toBe(11_500_000)
    expect(view.afterEliminations.chiffreAffairesCents).toBe(10_500_000)
    expect(view.eliminations.operations.map((p) => p.buyerId)).toEqual([nord.companyId])
    expect(view.warnings).toContain('Une filiale n’est pas lue, faute d’accès : ses chiffres et ses flux avec le groupe ne sont pas dans la vue combinée.')

    const participations = await call('partial', 'participations', `/api/group/participations?companyId=${holding.companyId}&fiscalYearId=${holding.fiscalYearId}`)
    const ptext = await participations.text()
    expect(participations.status).toBe(200)
    for (const secret of [sud.companyId, 'grp-sud', SIREN.sud]) expect(ptext).not.toContain(secret)
    expect((JSON.parse(ptext) as ParticipationsReport).unreachable).toEqual([{ name: null, reason: 'out_of_reach' }])

    const exported = await call('partial', 'export', `/api/group/export?companyId=${holding.companyId}&fiscalYearId=${holding.fiscalYearId}&format=csv`)
    expect(exported.status).toBe(200)
    const csv = await exported.text()
    expect(csv).toContain('Après éliminations')
    for (const secret of [sud.companyId, 'grp-sud', SIREN.sud]) expect(csv).not.toContain(secret)
  })

  it('names a subsidiary where the role cannot read reports, without reading it', async () => {
    const view = (await (await call('lowRole', 'view', viewPath())).json()) as GroupView
    expect(view.members.map((m) => m.name)).toEqual(['grp-holding'])
    expect(view.unreachable).toEqual([
      { name: 'grp-nord', reason: 'role' },
      { name: null, reason: 'out_of_reach' },
    ])
    expect(view.combined.chiffreAffairesCents).toBe(1_500_000)
    expect(view.eliminations.operations).toEqual([])
  })

  it('reports the participations of the holding (2059-G-SD)', async () => {
    const response = await call('group', 'participations', `/api/group/participations?companyId=${holding.companyId}&fiscalYearId=${holding.fiscalYearId}`)
    expect(response.status).toBe(200)
    const report = (await response.json()) as ParticipationsReport
    expect(report.rows).toEqual([
      expect.objectContaining({
        name: 'grp-nord',
        kind: 'filiale',
        ownershipBp: 8000,
        numberOfShares: 800,
        bookValueGrossCents: 8_000_000,
        bookValueNetCents: 8_000_000,
        capitauxPropresCents: 9_000_000,
        quotePartCents: 7_200_000,
        chiffreAffairesCents: 10_000_000,
        resultatCents: 9_000_000,
        loansCents: 2_500_000,
        dividendsCents: 1_500_000,
      }),
      expect.objectContaining({ name: 'grp-sud', kind: 'participation', ownershipBp: 4000, bookValueGrossCents: 0, capitauxPropresCents: 4_500_000, quotePartCents: 1_800_000 }),
    ])
    expect(report.unattributed).toEqual([{ accountCode: '261200', label: 'Titres de participation B', cents: 3_000_000 }])
    expect(report.totals.bookValueGrossCents).toBe(8_000_000)
  })

  it('exports the combined view as a workbook and the participations as CSV', async () => {
    const xlsx = await call('group', 'export', `/api/group/export?companyId=${holding.companyId}&fiscalYearId=${holding.fiscalYearId}&format=xlsx`)
    expect(xlsx.status).toBe(200)
    expect(xlsx.headers.get('content-type')).toContain('spreadsheetml')
    expect(xlsx.headers.get('content-disposition')).toContain('Vue_groupe_grp_holding_2026.xlsx')
    const csv = await call('group', 'export', `/api/group/export?companyId=${holding.companyId}&fiscalYearId=${holding.fiscalYearId}&report=participations&format=csv`)
    expect(csv.status).toBe(200)
    const text = await csv.text()
    expect(text).toContain('Filiale (plus de 50 %)')
    expect(text).toContain('80000,00')
  })

  it('refuses a non-member of the holding (404), an export to a read-only role (403), bad input (400)', async () => {
    expect((await call('outsider', 'view', viewPath())).status).toBe(404)
    expect((await call('outsider', 'participations', `/api/group/participations?companyId=${holding.companyId}`)).status).toBe(404)
    expect((await call('viewer', 'view', viewPath())).status).toBe(200)
    expect((await call('viewer', 'export', `/api/group/export?companyId=${holding.companyId}&format=csv`)).status).toBe(403)
    const foreignYear = await call('group', 'view', `/api/group/view?companyId=${holding.companyId}&fiscalYearId=${nord.fiscalYearId}`)
    expect(foreignYear.status).toBe(404)
    expect((await foreignYear.json()).error).toBe('Exercice introuvable pour cette société.')
    expect((await call('group', 'export', `/api/group/export?companyId=${holding.companyId}&format=pdf`)).status).toBe(400)
  })

  it('gives the ids of the subsidiaries only to a context that reaches the holding (kledg_group_subsidiary_ids)', async () => {
    const { listSubsidiaryIds } = await import('@/lib/management-fees/holding')
    const { withUserContext } = await import('@/lib/rls/context')
    const { rlsMode } = await import('@/lib/rls/mode')
    const both = [nord.companyId, sud.companyId].sort()
    // A member of the holding learns the ids of every subsidiary, reachable or not (never their rows).
    expect(await withUserContext(USERS.partial.id, () => listSubsidiaryIds(holding.companyId))).toEqual(both)
    // A context that does not reach the holding gets nothing under row level security; without it the
    // connection is the tables' owner, which could read the shareholder rows anyway.
    const outsider = await withUserContext(USERS.outsider.id, () => listSubsidiaryIds(holding.companyId))
    expect(outsider).toEqual(rlsMode() === 'enforce' ? [] : both)
    expect(await withUserContext(USERS.partial.id, () => listSubsidiaryIds(holding.companyId), { companyIds: [nord.companyId] })).toEqual(rlsMode() === 'enforce' ? [] : both)
  })

  it('shows a company without subsidiary as a group of one', async () => {
    const view = (await (await call('outsider', 'view', `/api/group/view?companyId=${nord.companyId}&fiscalYearId=${nord.fiscalYearId}`)).json()) as GroupView
    expect(view.members.map((m) => m.name)).toEqual(['grp-nord'])
    expect(view.unreachable).toEqual([])
  })
})
