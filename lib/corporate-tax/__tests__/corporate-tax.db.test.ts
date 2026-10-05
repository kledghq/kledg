/**
 * Impôt sur les sociétés against PostgreSQL (session mocked, roles from
 * member rows; skipped without the server). A SAS at the régime simplifié,
 * calendar years, one natural person holding the whole capital:
 * - 2025 closed and filed (40 000 € taxed at 15 %);
 * - 2026: sales 200 000 €, purchases 50 000 €, a tax fine 1 000 € (6582),
 *   the vehicle tax 500 € (63514): tax result 150 000 €, IS 33 250 € once
 *   the capital is said paid up;
 * - the worksheet and its answers, the acomptes of 2027 (the first on 2025,
 *   regularised with the second), the balance against the acomptes paid,
 *   the IS charge and acompte payment drafts (idempotent), the filing, the
 *   deficits history, a company whose deficits absorb its profit, a SCI
 *   at the impôt sur le revenu with nothing to compute, a company without
 *   regime, the dividends of a subsidiary held at 60 %, the simple home,
 *   the routes for every role, the database constraints.
 * Fictitious data. Sources: CGI art. 39, 145, 209, 213, 216, 219, 1668;
 * BOI-IS-LIQ-20-10, BOI-IS-DECLA-20-10; forms 2033-B-SD, 2571-SD, 2572-SD.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('corporate_tax')
  return { user: null as null | { id: string; email: string; name: string; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(async () => {}) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'
import type { CorporateTaxView } from '../load-corporate-tax.service'
import type { CorporateTaxEntryResult } from '../prepare-corporate-tax-entries.service'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let load: typeof import('../load-corporate-tax.service')
let entries: typeof import('../prepare-corporate-tax-entries.service')
let record: typeof import('../record-corporate-tax.service')
let simpleHome: typeof import('@/lib/simple/load-simple-home.service')
let routes: {
  view: Record<'GET', Handler>
  exportFile: Record<'GET', Handler>
  inputs: Record<'PUT', Handler>
  filing: Record<'PUT' | 'DELETE', Handler>
  entries: Record<'POST', Handler>
}

const USERS = {
  owner: { id: 'u-is-owner', email: 'owner@is.test', name: 'Présidente', role: 'user' },
  accountant: { id: 'u-is-accountant', email: 'compta@is.test', name: 'Comptable', role: 'user' },
  viewer: { id: 'u-is-viewer', email: 'viewer@is.test', name: 'Associé', role: 'user' },
  outsider: { id: 'u-is-outsider', email: 'other@is.test', name: 'Autre', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

/** 10 February 2027: 2026 is closed in time, its balance due in May. */
const NOW = new Date('2027-02-10T09:00:00Z')
const k = (euros: number) => Math.round(euros * 100)

let books: Books
let fy2027: string
let small: Books
let sci: Books
let noRegime: Books

function call(who: Who, handler: Handler, method: string, path: string, body?: unknown) {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    }),
    { params: Promise.resolve({ id: books.companyId }) },
  )
}

const base = () => `/api/companies/${books.companyId}/corporate-tax`

async function book(target: Books, journal: string, date: string, description: string, lines: Array<[string, number, number]>, status: 'validated' | 'draft' = 'validated') {
  const entry = await svc.createEntry({
    companyId: target.companyId,
    journalId: target.journals[journal],
    date,
    description,
    status,
    lines: lines.map(([code, debit, credit]) => ({ accountId: target.accounts[code], debit: debit.toFixed(2), credit: credit.toFixed(2) })),
  })
  return entry.id
}

async function addAccounts(target: Books, fiscalYearId: string, list: Array<[string, string]>) {
  for (const [code, label] of list) {
    const id = (await prisma.account.create({ data: { companyId: target.companyId, fiscalYearId, code, label } })).id
    if (fiscalYearId === target.fiscalYearId) target.accounts[code] = id
  }
}

const IS_ACCOUNTS: Array<[string, string]> = [
  ['444', 'État - Impôts sur les bénéfices'],
  ['6582', 'Pénalités, amendes fiscales et pénales'],
  ['63514', 'Taxe sur les véhicules des sociétés'],
  ['695', 'Impôts sur les bénéfices'],
  ['761', 'Produits de participations'],
]

const lineOf = (view: CorporateTaxView, id: string) => view.computation?.lines.find((l) => l.id === id)

describe.skipIf(!available)('impôt sur les sociétés (PostgreSQL)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('corporate_tax')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    load = await import('../load-corporate-tax.service')
    entries = await import('../prepare-corporate-tax-entries.service')
    record = await import('../record-corporate-tax.service')
    simpleHome = await import('@/lib/simple/load-simple-home.service')
    routes = {
      view: (await import('@/app/api/companies/[id]/corporate-tax/route')) as unknown as typeof routes.view,
      exportFile: (await import('@/app/api/companies/[id]/corporate-tax/export/route')) as unknown as typeof routes.exportFile,
      inputs: (await import('@/app/api/companies/[id]/corporate-tax/inputs/route')) as unknown as typeof routes.inputs,
      filing: (await import('@/app/api/companies/[id]/corporate-tax/filing/route')) as unknown as typeof routes.filing,
      entries: (await import('@/app/api/companies/[id]/corporate-tax/entries/route')) as unknown as typeof routes.entries,
    }

    books = await seedBooks(prisma, svc, { siren: '960000101', slug: 'is-a' })
    small = await seedBooks(prisma, svc, { siren: '960000102', slug: 'is-small' })
    sci = await seedBooks(prisma, svc, { siren: '960000103', slug: 'is-sci' })
    noRegime = await seedBooks(prisma, svc, { siren: '960000104', slug: 'is-noregime' })
    const foundationDate = new Date('2020-01-01T00:00:00Z')
    await prisma.company.update({ where: { id: books.companyId }, data: { legalType: 'SAS', corporateTaxRegime: 'simplified', foundationDate } })
    await prisma.company.update({ where: { id: small.companyId }, data: { legalType: 'SARL', corporateTaxRegime: 'simplified', foundationDate } })
    await prisma.company.update({ where: { id: sci.companyId }, data: { legalType: 'SCI', corporateTaxRegime: null, foundationDate } })
    await prisma.company.update({ where: { id: noRegime.companyId }, data: { legalType: 'SAS', corporateTaxRegime: null, foundationDate } })
    await addAccounts(books, books.fiscalYearId, IS_ACCOUNTS)
    await addAccounts(small, small.fiscalYearId, IS_ACCOUNTS)
    fy2027 = (
      await prisma.fiscalYear.create({
        data: { companyId: books.companyId, year: 2027, startDate: new Date('2027-01-01T00:00:00Z'), endDate: new Date('2027-12-31T00:00:00Z') },
      })
    ).id
    await addAccounts(books, fy2027, [['444', 'État - Impôts sur les bénéfices'], ['512000', 'Banque']])

    // One natural person holds the whole capital
    const person = await prisma.person.create({ data: { companyId: books.companyId, firstName: 'Claire', name: 'Martin' } })
    await prisma.shareholder.create({ data: { companyId: books.companyId, type: 'PHYSICAL', personId: person.id, sharePercentage: 100 } })

    // 2025, closed, filed: 40 000 € taxed at 15 %
    await prisma.corporateTaxReturn.create({
      data: {
        companyId: books.companyId,
        fiscalYearId: books.closedFiscalYearId,
        deficitsOpening: 0,
        filedOn: new Date('2026-05-05T00:00:00Z'),
        resultBeforeDeficits: 40_000,
        deficitsImputed: 0,
        corporateTax: 6_000,
        reducedRate: true,
      },
    })

    for (const [who, role] of [['owner', 'companyAdmin'], ['accountant', 'accountant'], ['viewer', 'viewer']] as const) {
      await seedMembership(prisma, USERS[who].id, books.companyId, role)
    }
    await seedMembership(prisma, USERS.outsider.id, sci.companyId, 'companyAdmin')

    await book(books, 'BQ', '2026-03-10', 'Ventes', [['512000', 200_000, 0], ['706000', 0, 200_000]])
    await book(books, 'AC', '2026-04-10', 'Achats', [['6064', 50_000, 0], ['512000', 0, 50_000]])
    await book(books, 'OD', '2026-05-10', 'Majoration de retard', [['6582', 1_000, 0], ['512000', 0, 1_000]])
    await book(books, 'OD', '2026-06-10', 'Taxe sur les véhicules', [['63514', 500, 0], ['512000', 0, 500]])
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('computes the tax result and asks for the reduced rate conditions it cannot read', async () => {
    const { view } = await load.buildCorporateTax(books.companyId, {}, { now: NOW })
    expect(view.status).toBe('ready')
    expect(view.fiscalYear).toMatchObject({ year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' })
    expect(view.regime).toBe('simplified')
    const c = view.computation!
    expect(c.accountingResultCents).toBe(k(148_500))
    expect(lineOf(view, 'books-penalties')).toMatchObject({ amountCents: k(1_000), formLine: '330' })
    expect(lineOf(view, 'books-vehicle-tax')).toMatchObject({ amountCents: k(500), formLine: '324' })
    expect(c.taxableProfitCents).toBe(k(150_000))
    // 75 % natural persons read from the shareholders; the capital is not known
    expect(view.answers.naturalPersons75).toEqual({ value: true, from: 'shareholders' })
    expect(view.answers.capitalPaidUp).toEqual({ value: null, from: null })
    expect(c.corporateTaxCents).toBe(k(37_500))
    expect(c.ifEligibleCents).toBe(k(33_250))
    expect(view.checks.find((x) => x.id === 'reduced-rate')?.severity).toBe('warning')
    expect(view.reliable).toBe(true)
    expect(view.deficits.history.map((h) => [h.year, h.basis, h.closingCents])).toEqual([
      [2025, 'filed', 0],
      [2026, 'worksheet', 0],
    ])

    await record.saveCorporateTaxInputs(books.companyId, { fiscalYearId: books.fiscalYearId, capitalPaidUp: true }, { now: NOW })
    const { view: after } = await load.buildCorporateTax(books.companyId, {}, { now: NOW })
    expect(after.computation?.reducedRate).toMatchObject({ applied: true, taxCents: k(6_375) })
    expect(after.computation?.corporateTaxCents).toBe(k(33_250))
    expect(after.checks.some((x) => x.id === 'reduced-rate')).toBe(false)
  })

  it('schedules the 2027 acomptes: the first on 2025, regularised with the second (CGI art. 1668)', async () => {
    const { view } = await load.buildCorporateTax(books.companyId, {}, { now: NOW })
    const acomptes = view.acomptes!
    expect(acomptes.exercice).toMatchObject({ year: 2027, exists: true, id: fy2027 })
    expect(acomptes.referenceTaxCents).toBe(k(33_250))
    // 2025: 6 000 € → 1 500 €; 2026: 33 250 € → 8 312,50 € rounded to 8 313 €
    expect(acomptes.items.map((i) => [i.number, i.date, i.amountCents, i.reference])).toEqual([
      [1, '2027-03-15', k(1_500), 'previous'],
      [2, '2027-06-15', k(2 * 8_313 - 1_500), 'current'],
      [3, '2027-09-15', k(8_313), 'current'],
      [4, '2027-12-15', k(8_313), 'current'],
    ])
    expect(acomptes.items[0].deadlineId).toBe('is-acompte:2027-12-31:1')
    expect(view.balance?.deadline?.legalDate).toBe('2027-05-15')
    expect(view.liasse?.legalDate).toBe('2027-05-04')
    // The calendar's acompte opens the worksheet that computes it
    const { view: fromDeadline } = await load.buildCorporateTax(books.companyId, { deadline: 'is-acompte:2027-12-31:2' }, { now: NOW })
    expect(fromDeadline.fiscalYear?.year).toBe(2026)
    const { view: fromSolde } = await load.buildCorporateTax(books.companyId, { deadline: 'is-solde:2026-12-31' }, { now: NOW })
    expect(fromSolde.fiscalYear?.year).toBe(2026)
  })

  it('records the acomptes paid and checks them against the 444 payments', async () => {
    const paid = [1, 2, 3, 4].map((number) => ({ number, paidOn: `2026-${String(number * 3).padStart(2, '0')}-15`, amountCents: k(1_500) }))
    await record.saveCorporateTaxInputs(books.companyId, { fiscalYearId: books.fiscalYearId, acomptesPaid: paid }, { now: NOW })
    let { view } = await load.buildCorporateTax(books.companyId, {}, { now: NOW })
    expect(view.balance).toMatchObject({ paidCents: k(6_000), balanceCents: k(27_250), acomptesBookedCents: 0 })
    expect(view.checks.find((x) => x.id === 'acomptes')?.severity).toBe('warning')

    await book(books, 'BQ', '2026-03-15', 'Acomptes d’IS', [['444', 6_000, 0], ['512000', 0, 6_000]])
    ;({ view } = await load.buildCorporateTax(books.companyId, {}, { now: NOW }))
    expect(view.balance?.acomptesBookedCents).toBe(k(6_000))
    expect(view.checks.some((x) => x.id === 'acomptes')).toBe(false)
  })

  it('prepares the IS charge as an idempotent draft that never changes the tax', async () => {
    const first = await entries.prepareCorporateTaxEntry(books.companyId, { kind: 'charge', fiscalYearId: books.fiscalYearId }, { now: NOW })
    expect(first).toMatchObject({ status: 'created', reference: 'IS-2026' })
    const entry = await prisma.accountingEntry.findUniqueOrThrow({
      where: { id: first.entryId as string },
      select: { status: true, date: true, journal: { select: { code: true } }, lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
    })
    expect(entry.status).toBe('draft')
    expect(entry.journal.code).toBe('OD')
    expect(entry.date.toISOString().slice(0, 10)).toBe('2026-12-31')
    expect(entry.lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2)]).sort()).toEqual([
      ['444', '0.00', '33250.00'],
      ['695', '33250.00', '0.00'],
    ])
    expect((await entries.prepareCorporateTaxEntry(books.companyId, { kind: 'charge', fiscalYearId: books.fiscalYearId }, { now: NOW })).status).toBe('unchanged')
    // The IS draft is not a draft of the year for the checks
    const { view } = await load.buildCorporateTax(books.companyId, {}, { now: NOW })
    expect(view.checks.find((x) => x.id === 'drafts')?.severity).toBe('ok')
    expect(view.charge).toMatchObject({ status: 'draft', entryId: first.entryId })

    // A purchase added: the draft is stale and replaced
    await book(books, 'AC', '2026-11-20', 'Achat complémentaire', [['6064', 1_000, 0], ['512000', 0, 1_000]])
    const replaced = await entries.prepareCorporateTaxEntry(books.companyId, { kind: 'charge', fiscalYearId: books.fiscalYearId }, { now: NOW })
    expect(replaced.status).toBe('replaced')
    expect(replaced.lines.find((l) => l.code === '695')?.debitCents).toBe(k(33_000))
    expect(await prisma.accountingEntry.count({ where: { companyId: books.companyId, reference: 'IS-2026' } })).toBe(1)

    // Validated by the user: never touched again, and the IS stays the same (695 is reintegrated)
    await svc.validateEntries(books.companyId, [replaced.entryId as string])
    expect((await entries.prepareCorporateTaxEntry(books.companyId, { kind: 'charge', fiscalYearId: books.fiscalYearId }, { now: NOW })).status).toBe('validated')
    const { view: after } = await load.buildCorporateTax(books.companyId, {}, { now: NOW })
    expect(after.computation?.accountingResultCents).toBe(k(147_500 - 33_000))
    expect(lineOf(after, 'books-income-tax')).toMatchObject({ kind: 'reintegration', amountCents: k(33_000), formLine: '324' })
    expect(after.computation?.corporateTaxCents).toBe(k(33_000))
  })

  it('prepares an acompte payment in the year that pays it, idempotent', async () => {
    const result = await entries.prepareCorporateTaxEntry(books.companyId, { kind: 'acompte', fiscalYearId: books.fiscalYearId, number: 1 }, { now: NOW })
    expect(result).toMatchObject({ status: 'created', reference: 'IS-AC-2027-1' })
    const entry = await prisma.accountingEntry.findUniqueOrThrow({
      where: { id: result.entryId as string },
      select: { status: true, fiscalYearId: true, date: true, journal: { select: { code: true } }, lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
    })
    expect(entry).toMatchObject({ status: 'draft', fiscalYearId: fy2027 })
    expect(entry.journal.code).toBe('BQ')
    expect(entry.date.toISOString().slice(0, 10)).toBe('2027-03-15')
    expect(entry.lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2)]).sort()).toEqual([
      ['444', '1500.00', '0.00'],
      ['512000', '0.00', '1500.00'],
    ])
    expect((await entries.prepareCorporateTaxEntry(books.companyId, { kind: 'acompte', fiscalYearId: books.fiscalYearId, number: 1 }, { now: NOW })).status).toBe('unchanged')
    await expect(entries.prepareCorporateTaxEntry(books.companyId, { kind: 'acompte', fiscalYearId: books.fiscalYearId, number: 7 }, { now: NOW })).rejects.toThrow('Aucun acompte n° 7')
  })

  it('records the filing, refuses inconsistent amounts, and the next year reads it', async () => {
    const later = new Date('2027-05-10T09:00:00Z')
    await expect(
      record.recordCorporateTaxFiling(books.companyId, { fiscalYearId: books.fiscalYearId, filedOn: '2026-12-15', resultBeforeDeficitsCents: k(149_000), deficitsImputedCents: 0, corporateTaxCents: k(33_000), reducedRate: true }, { now: later }),
    ).rejects.toThrow('après la clôture')
    await expect(
      record.recordCorporateTaxFiling(books.companyId, { fiscalYearId: books.fiscalYearId, filedOn: '2027-05-03', resultBeforeDeficitsCents: k(1_000), deficitsImputedCents: k(2_000), corporateTaxCents: 0, reducedRate: true }, { now: later }),
    ).rejects.toThrow('ne peuvent pas dépasser')
    await record.recordCorporateTaxFiling(
      books.companyId,
      { fiscalYearId: books.fiscalYearId, filedOn: '2027-05-03', resultBeforeDeficitsCents: k(149_000), deficitsImputedCents: 0, corporateTaxCents: k(33_000), reducedRate: true },
      { now: later },
    )
    const { view } = await load.buildCorporateTax(books.companyId, { fiscalYearId: fy2027 }, { now: later })
    expect(view.fiscalYear?.year).toBe(2027)
    expect(view.deficits.history.map((h) => [h.year, h.basis])).toEqual([
      [2025, 'filed'],
      [2026, 'filed'],
      [2027, 'worksheet'],
    ])
    expect(view.fiscalYears.find((y) => y.year === 2026)?.filed).toBe(true)
    // 2028's first acompte is computed on 2026 as filed: 33 000 € → 8 250 €
    expect(view.acomptes?.items[0]).toMatchObject({ amountCents: k(8_250), reference: 'previous' })
  })

  it('lets earlier deficits absorb a small profit, with no IS and no acompte', async () => {
    await book(small, 'BQ', '2026-05-10', 'Ventes', [['512000', 2_000, 0], ['706000', 0, 2_000]])
    await record.saveCorporateTaxInputs(small.companyId, { fiscalYearId: small.fiscalYearId, deficitsOpeningCents: k(5_000), capitalPaidUp: true, naturalPersons75: true }, { now: NOW })
    const { view } = await load.buildCorporateTax(small.companyId, { fiscalYearId: small.fiscalYearId }, { now: NOW })
    expect(view.computation?.deficits).toMatchObject({ known: true, openingCents: k(5_000), imputedCents: k(2_000), closingCents: k(3_000) })
    expect(view.computation?.corporateTaxCents).toBe(0)
    expect(view.acomptes?.exempt).toBe(true)
    expect(view.acomptes?.items.every((i) => i.amountCents === 0 || i.amountCents === null)).toBe(true)
    expect((await entries.prepareCorporateTaxEntry(small.companyId, { kind: 'charge', fiscalYearId: small.fiscalYearId }, { now: NOW })).status).toBe('nothing')
  })

  it('has nothing to compute for a SCI at the impôt sur le revenu, and asks for a missing regime', async () => {
    const { view } = await load.buildCorporateTax(sci.companyId, {}, { now: NOW })
    expect(view).toMatchObject({ status: 'not-subject', computation: null })
    await expect(entries.prepareCorporateTaxEntry(sci.companyId, { kind: 'charge', fiscalYearId: sci.fiscalYearId }, { now: NOW })).rejects.toThrow('pas soumise')
    await expect(record.saveCorporateTaxInputs(sci.companyId, { fiscalYearId: sci.fiscalYearId, capitalPaidUp: true }, { now: NOW })).rejects.toThrow('pas soumise')
    expect((await load.buildCorporateTax(noRegime.companyId, {}, { now: NOW })).view.status).toBe('missing-regime')
  })

  it('shows the estimate on the simple home, nothing for a company at the impôt sur le revenu', async () => {
    const during = new Date('2026-11-25T09:00:00Z')
    const home = await simpleHome.loadSimpleHome(books.companyId, { can: () => true, now: during })
    const { view } = await load.buildCorporateTax(books.companyId, { fiscalYearId: books.fiscalYearId }, { now: during })
    expect(home.corporateTax).toEqual({ estimateCents: view.computation?.totalCents, reducedRate: true })
    expect(home.corporateTax?.estimateCents).toBe(k(33_000))
    expect((await simpleHome.loadSimpleHome(sci.companyId, { can: () => true, now: during })).corporateTax).toBeNull()
  })

  it('deducts the dividends of a subsidiary held at 60 %, read with the user’s own access', async () => {
    const sub = await prisma.company.create({ data: { name: 'Filiale Lumen', slug: 'filiale-lumen', siren: '960000199' } })
    await prisma.shareholder.create({ data: { companyId: sub.id, type: 'LEGAL', companyShareholderId: books.companyId, sharePercentage: 60 } })
    await seedMembership(prisma, USERS.owner.id, sub.id, 'viewer')
    await book(books, 'BQ', '2026-07-01', 'Dividendes Filiale Lumen', [['512000', 10_000, 0], ['761', 0, 10_000]])

    const response = await call('owner', routes.view.GET, 'GET', `${base()}?fiscalYearId=${books.fiscalYearId}`)
    expect(response.status).toBe(200)
    const view = (await response.json()) as CorporateTaxView
    expect(lineOf(view, 'group-dividends')).toMatchObject({ kind: 'deduction', amountCents: k(10_000), formLine: '350' })
    expect(lineOf(view, 'group-quote-part')).toMatchObject({ kind: 'reintegration', amountCents: k(500), formLine: '330' })
    expect(view.parentSubsidiary.map((p) => [p.name, p.stakeBp])).toEqual([['Filiale Lumen', 6_000]])
    expect(view.computation?.taxableProfitCents).toBe(k(149_500))
    // Without a group access (the simple home), the dividends stay taxable and are flagged
    const { view: alone } = await load.buildCorporateTax(books.companyId, { fiscalYearId: books.fiscalYearId }, { now: NOW })
    expect(alone.computation?.taxableProfitCents).toBe(k(159_000))
    expect(alone.checks.find((x) => x.id === 'dividends')?.severity).toBe('warning')
  })

  describe('routes', () => {
    it('reads the worksheet for every member, 404 outside the company, 401 without a session', async () => {
      for (const who of ['owner', 'accountant', 'viewer'] as const) {
        const response = await call(who, routes.view.GET, 'GET', `${base()}?fiscalYearId=${books.fiscalYearId}`)
        expect(response.status, who).toBe(200)
        expect(((await response.json()) as CorporateTaxView).fiscalYear?.year).toBe(2026)
      }
      expect((await call('outsider', routes.view.GET, 'GET', base())).status).toBe(404)
      expect((await call('anonymous', routes.view.GET, 'GET', base())).status).toBe(401)
      expect((await call('owner', routes.view.GET, 'GET', `${base()}?deadline=tva-ca3:2026-09`)).status).toBe(400)
      expect((await call('owner', routes.view.GET, 'GET', `${base()}?fiscalYearId=unknown`)).status).toBe(404)
    })

    it('exports the worksheet as CSV and PDF (reports:export)', async () => {
      const csv = await call('accountant', routes.exportFile.GET, 'GET', `${base()}/export?fiscalYearId=${books.fiscalYearId}&format=csv`)
      expect(csv.status).toBe(200)
      expect(csv.headers.get('content-disposition')).toContain('IS_2026_is_a.csv')
      const bytes = Buffer.from(await csv.arrayBuffer())
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
      const text = bytes.toString('utf8')
      expect(text).toContain('Taux réduit de 15 %')
      expect(text).toContain('Pénalités, amendes fiscales et pénales')
      const pdf = await call('owner', routes.exportFile.GET, 'GET', `${base()}/export?fiscalYearId=${books.fiscalYearId}&format=pdf`)
      expect(pdf.status).toBe(200)
      expect(pdf.headers.get('content-type')).toBe('application/pdf')
      expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF')
      expect((await call('viewer', routes.exportFile.GET, 'GET', `${base()}/export?format=csv`)).status).toBe(403)
    })

    it('saves the inputs for entries:create only, with French messages', async () => {
      const body = { fiscalYearId: books.fiscalYearId, manualLines: [{ id: 'l1', kind: 'reintegration', label: 'Dépenses somptuaires', amountCents: k(2_000) }] }
      expect((await call('viewer', routes.inputs.PUT, 'PUT', `${base()}/inputs`, body)).status).toBe(403)
      const saved = await call('accountant', routes.inputs.PUT, 'PUT', `${base()}/inputs`, body)
      expect(saved.status).toBe(200)
      const negative = await call('accountant', routes.inputs.PUT, 'PUT', `${base()}/inputs`, { fiscalYearId: books.fiscalYearId, deficitsOpeningCents: -1 })
      expect(negative.status).toBe(400)
      expect(((await negative.json()) as { error: string }).error).toContain('ne peuvent pas être négatifs')
      const { view } = await load.buildCorporateTax(books.companyId, { fiscalYearId: books.fiscalYearId }, { now: NOW })
      expect(lineOf(view, 'manual-l1')).toMatchObject({ origin: 'manual', amountCents: k(2_000) })
    })

    it('records and removes a filing', async () => {
      const filing = { fiscalYearId: books.closedFiscalYearId, filedOn: '2026-05-05', resultBeforeDeficitsCents: k(40_000), deficitsImputedCents: 0, corporateTaxCents: k(6_000), reducedRate: true }
      expect((await call('viewer', routes.filing.PUT, 'PUT', `${base()}/filing`, filing)).status).toBe(403)
      expect((await call('accountant', routes.filing.PUT, 'PUT', `${base()}/filing`, filing)).status).toBe(200)
      expect((await call('accountant', routes.filing.DELETE, 'DELETE', `${base()}/filing?fiscalYearId=${books.closedFiscalYearId}`)).status).toBe(200)
      expect((await call('accountant', routes.filing.DELETE, 'DELETE', `${base()}/filing?fiscalYearId=${books.closedFiscalYearId}`)).status).toBe(404)
    })

    it('prepares the drafts for entries:create only', async () => {
      expect((await call('viewer', routes.entries.POST, 'POST', `${base()}/entries`, { kind: 'acompte', fiscalYearId: books.fiscalYearId, number: 3 })).status).toBe(403)
      const created = await call('accountant', routes.entries.POST, 'POST', `${base()}/entries`, { kind: 'acompte', fiscalYearId: books.fiscalYearId, number: 3 })
      expect(created.status).toBe(201)
      expect(((await created.json()) as CorporateTaxEntryResult).reference).toBe('IS-AC-2027-3')
      const again = await call('accountant', routes.entries.POST, 'POST', `${base()}/entries`, { kind: 'acompte', fiscalYearId: books.fiscalYearId, number: 3 })
      expect(again.status).toBe(200)
      expect((await call('accountant', routes.entries.POST, 'POST', `${base()}/entries`, { kind: 'other', fiscalYearId: books.fiscalYearId })).status).toBe(400)
    })

    it('refuses rows the database forbids, whatever the code path', async () => {
      // Filed amounts set without a date
      await expect(prisma.corporateTaxReturn.create({ data: { companyId: small.companyId, fiscalYearId: small.closedFiscalYearId, corporateTax: 10 } })).rejects.toThrow()
      // Negative deficits
      await expect(prisma.corporateTaxReturn.create({ data: { companyId: small.companyId, fiscalYearId: small.closedFiscalYearId, deficitsOpening: -1 } })).rejects.toThrow()
      // A fiscal year of another company
      await expect(prisma.corporateTaxReturn.create({ data: { companyId: small.companyId, fiscalYearId: books.fiscalYearId } })).rejects.toThrow()
    })
  })
})
