/**
 * VAT return preparation against PostgreSQL (session mocked, roles from
 * member rows; skipped without the server). A company at the réel normal,
 * monthly CA3, filing day 21:
 * - August: a sale and a purchase, the settlement prepared as a draft,
 *   validated, the filing recorded;
 * - September: the August VAT paid, sales at 20 % and 10 %, a computer
 *   (44562), services of a supplier not established in France (4452), a
 *   purchase: a credit carried to October;
 * - the worksheet and its checks (drafts, bank lines, 4455 against the
 *   August return, the credit against the September filing), the
 *   settlement idempotent (created, unchanged, replaced, validated), the
 *   filing record, the exports, the franchise company with nothing to
 *   file, the simple home's TVA à payer, the routes for every role.
 * Fictitious data. Sources: 3310-CA3-SD and its notice, PCG art. 944-44
 * and 1031-3, CGI art. 287 and 293 B.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('vat_returns')
  return { user: null as null | { id: string; email: string; name: string; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(async () => {}) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'
import type { VatReturnView } from '../load-vat-return.service'
import type { VatSettlementResult } from '../prepare-vat-settlement.service'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let load: typeof import('../load-vat-return.service')
let settle: typeof import('../prepare-vat-settlement.service')
let filing: typeof import('../record-vat-filing.service')
let forDeadline: typeof import('../vat-return-for-deadline.service')
let simpleHome: typeof import('@/lib/simple/load-simple-home.service')
let routes: { view: Record<'GET', Handler>; exportFile: Record<'GET', Handler>; settlement: Record<'POST', Handler>; filing: Record<'PUT' | 'DELETE', Handler> }

const USERS = {
  owner: { id: 'u-vat-owner', email: 'owner@vat.test', name: 'Gérante', role: 'user' },
  accountant: { id: 'u-vat-accountant', email: 'compta@vat.test', name: 'Comptable', role: 'user' },
  viewer: { id: 'u-vat-viewer', email: 'viewer@vat.test', name: 'Associé', role: 'user' },
  outsider: { id: 'u-vat-outsider', email: 'other@vat.test', name: 'Autre', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

/** 5 October 2026: the September return is due on the 21st. */
const NOW = new Date('2026-10-05T09:00:00Z')

let books: Books
let franchise: Books
let bankAccountId: string
let txCounter = 0

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

const base = () => `/api/companies/${books.companyId}/vat-returns`

/** A validated entry from [code, debit, credit] lines in euros. */
async function book(journal: string, date: string, description: string, lines: Array<[string, number, number]>, status: 'validated' | 'draft' = 'validated') {
  const entry = await svc.createEntry({
    companyId: books.companyId,
    journalId: books.journals[journal],
    date,
    description,
    status,
    lines: lines.map(([code, debit, credit]) => ({ accountId: books.accounts[code], debit: debit.toFixed(2), credit: credit.toFixed(2) })),
  })
  return entry.id
}

async function bankLine(date: string, amount: string, side: 'debit' | 'credit', reconciledWith: string | null) {
  txCounter += 1
  return prisma.bankTransaction.create({
    data: { bankAccountId, externalTransactionId: `vat-tx-${txCounter}`, amount, date: new Date(`${date}T00:00:00Z`), side, reconciled: reconciledWith !== null, reconciledWith },
  })
}

const lineOf = (view: VatReturnView, code: string) => view.computation?.lines.find((l) => l.code === code)

describe.skipIf(!available)('VAT returns (PostgreSQL)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('vat_returns')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    load = await import('../load-vat-return.service')
    settle = await import('../prepare-vat-settlement.service')
    filing = await import('../record-vat-filing.service')
    forDeadline = await import('../vat-return-for-deadline.service')
    simpleHome = await import('@/lib/simple/load-simple-home.service')
    routes = {
      view: (await import('@/app/api/companies/[id]/vat-returns/route')) as unknown as typeof routes.view,
      exportFile: (await import('@/app/api/companies/[id]/vat-returns/export/route')) as unknown as typeof routes.exportFile,
      settlement: (await import('@/app/api/companies/[id]/vat-returns/settlement/route')) as unknown as typeof routes.settlement,
      filing: (await import('@/app/api/companies/[id]/vat-returns/filing/route')) as unknown as typeof routes.filing,
    }

    books = await seedBooks(prisma, svc, { siren: '950000101', slug: 'vat-a' })
    franchise = await seedBooks(prisma, svc, { siren: '950000102', slug: 'vat-franchise' })
    await prisma.company.update({
      where: { id: books.companyId },
      data: { legalType: 'SAS', vatRegime: 'normal', deadlineSettings: { vatFilingDay: 21, vatCa3Frequency: 'monthly' } },
    })
    await prisma.company.update({ where: { id: franchise.companyId }, data: { vatRegime: 'franchise', isVatExempt: true } })
    for (const [code, label] of [
      ['445200', 'TVA due intracommunautaire'],
      ['445510', 'TVA à décaisser'],
      ['445670', 'Crédit de TVA à reporter'],
      ['622600', 'Honoraires'],
    ]) {
      books.accounts[code] = (await prisma.account.create({ data: { companyId: books.companyId, fiscalYearId: books.fiscalYearId, code, label } })).id
    }
    await seedMembership(prisma, USERS.owner.id, books.companyId, 'companyAdmin')
    await seedMembership(prisma, USERS.accountant.id, books.companyId, 'accountant')
    await seedMembership(prisma, USERS.viewer.id, books.companyId, 'viewer')
    await seedMembership(prisma, USERS.outsider.id, franchise.companyId, 'companyAdmin')
    const connection = await prisma.bankConnection.findFirstOrThrow({ where: { companyId: books.companyId } })
    bankAccountId = (await prisma.bankAccount.findFirstOrThrow({ where: { bankConnectionId: connection.id } })).id

    // August: a sale at 20 % and a purchase
    await book('VE', '2026-08-10', 'Facture août', [['411000', 1_200, 0], ['706000', 0, 1_000], ['445710', 0, 200]])
    await book('AC', '2026-08-12', 'Fournitures août', [['6064', 500, 0], ['445660', 100, 0], ['401000', 0, 600]])
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('computes the August CA3 and prepares its settlement as an idempotent draft', async () => {
    const { view } = await load.buildVatReturn(books.companyId, '2026-08', NOW)
    expect(view.status).toBe('ready')
    expect(view.period).toMatchObject({ id: '2026-08', form: 'CA3', start: '2026-08-01', end: '2026-08-31' })
    expect(view.deadline).toMatchObject({ date: '2026-09-21', estimated: false })
    expect(lineOf(view, '08')).toMatchObject({ base: 1_000, amount: 200 })
    expect(lineOf(view, '20')?.amount).toBe(100)
    expect(view.computation?.result).toMatchObject({ kind: 'due', dueEuros: 100 })

    const first = await settle.prepareVatSettlement(books.companyId, '2026-08', { now: NOW })
    expect(first).toMatchObject({ status: 'created', reference: 'TVA-CA3-2026-08' })
    const entry = await prisma.accountingEntry.findUniqueOrThrow({
      where: { id: first.entryId as string },
      select: { status: true, date: true, journal: { select: { code: true } }, lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
    })
    expect(entry.status).toBe('draft')
    expect(entry.journal.code).toBe('OD')
    expect(entry.date.toISOString().slice(0, 10)).toBe('2026-08-31')
    expect(entry.lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2)]).sort()).toEqual([
      ['445510', '0.00', '100.00'],
      ['445660', '0.00', '100.00'],
      ['445710', '200.00', '0.00'],
    ])
    // Run again: nothing created twice
    const again = await settle.prepareVatSettlement(books.companyId, '2026-08', { now: NOW })
    expect(again).toMatchObject({ status: 'unchanged', entryId: first.entryId })
    expect(await prisma.accountingEntry.count({ where: { companyId: books.companyId, reference: 'TVA-CA3-2026-08' } })).toBe(1)

    // The settlement draft is not a draft of the period for the checks, and never changes the figures
    const { view: after } = await load.buildVatReturn(books.companyId, '2026-08', NOW)
    expect(after.checks.find((c) => c.id === 'drafts')?.severity).toBe('ok')
    expect(after.computation?.result.dueEuros).toBe(100)
    expect(after.settlement).toMatchObject({ status: 'draft', entryId: first.entryId })

    // Validated by the user: never touched again
    await svc.validateEntries(books.companyId, [first.entryId as string])
    const validated = await settle.prepareVatSettlement(books.companyId, '2026-08', { now: NOW })
    expect(validated.status).toBe('validated')
    await filing.recordVatFiling(books.companyId, { period: '2026-08', filedOn: '2026-09-18', amountDueCents: 10_000, creditCents: 0 }, { now: NOW })
  })

  it('computes the September CA3 with several rates, a fixed asset, autoliquidation and a credit', async () => {
    const payment = await book('BQ', '2026-09-21', 'Paiement TVA août', [['445510', 100, 0], ['512000', 0, 100]])
    await bankLine('2026-09-21', '100.00', 'debit', payment)
    await book('VE', '2026-09-05', 'Facture 20 %', [['411000', 2_400, 0], ['706000', 0, 2_000], ['445710', 0, 400]])
    await book('VE', '2026-09-08', 'Facture 10 %', [['411000', 1_100, 0], ['707000', 0, 1_000], ['445710', 0, 100]])
    await book('AC', '2026-09-10', 'Ordinateur', [['2183', 1_500, 0], ['445620', 300, 0], ['401000', 0, 1_800]])
    await book('AC', '2026-09-12', 'Logiciel, éditeur irlandais', [['622600', 500, 0], ['445660', 100, 0], ['445200', 0, 100], ['401000', 0, 500]])
    await book('AC', '2026-09-15', 'Marchandises', [['6064', 2_000, 0], ['445660', 400, 0], ['401000', 0, 2_400]])

    const { view } = await load.buildVatReturn(books.companyId, '2026-09', NOW)
    expect(lineOf(view, 'A1')?.base).toBe(3_000)
    expect(lineOf(view, 'A3')?.base).toBe(500)
    expect(lineOf(view, '08')).toMatchObject({ base: 2_500, amount: 500 })
    expect(lineOf(view, '9B')).toMatchObject({ base: 1_000, amount: 100 })
    expect(lineOf(view, '16')?.amount).toBe(600)
    expect(lineOf(view, '19')?.amount).toBe(300)
    expect(lineOf(view, '20')?.amount).toBe(500)
    expect(lineOf(view, '25')?.amount).toBe(200)
    expect(lineOf(view, '27')?.amount).toBe(200)
    expect(view.computation?.result).toMatchObject({ kind: 'credit', creditEuros: 200, booksNetCents: -20_000 })
    expect(view.reliable).toBe(true)
    // August was settled and its 100 € paid: 4455 cleared after the 21 September deadline
    expect(view.checks.find((c) => c.id === 'to-pay')).toMatchObject({ severity: 'ok' })
    expect(view.checks.find((c) => c.id === 'balances')?.severity).toBe('ok')
    expect(view.sources.map((s) => s.label)).toContain('Notice 3310-NOT-CA3-SD (n° 50449#29)')
  })

  it('blocks the figures on drafts and unreconciled bank lines of the period, then lets them through', async () => {
    const draft = await book('VE', '2026-09-28', 'Facture en attente', [['411000', 120, 0], ['706000', 0, 100], ['445710', 0, 20]], 'draft')
    const pending = await bankLine('2026-09-29', '75.00', 'debit', null)
    let { view } = await load.buildVatReturn(books.companyId, '2026-09', NOW)
    expect(view.reliable).toBe(false)
    const draftNumber = (await prisma.accountingEntry.findUniqueOrThrow({ where: { id: draft }, select: { entryNumber: true } })).entryNumber
    expect(view.checks.find((c) => c.id === 'drafts')).toMatchObject({ severity: 'blocking', items: [draftNumber] })
    expect(view.checks.find((c) => c.id === 'bank')).toMatchObject({ severity: 'blocking' })
    expect(await forDeadline.vatReturnForDeadline(books.companyId, { id: 'tva-ca3:2026-09', ruleId: 'tva-ca3' }, NOW)).toBeNull()

    await svc.deleteDraftEntry(books.companyId, draft)
    await prisma.bankTransaction.update({ where: { id: pending.id }, data: { status: 'declined' } })
    ;({ view } = await load.buildVatReturn(books.companyId, '2026-09', NOW))
    expect(view.reliable).toBe(true)
    expect(await forDeadline.vatReturnForDeadline(books.companyId, { id: 'tva-ca3:2026-09', ruleId: 'tva-ca3' }, NOW)).toEqual({ amountCents: -20_000, periodLabel: 'septembre 2026' })
  })

  it('shows the return on the simple home when the books allow it, the estimate otherwise', async () => {
    const home = await simpleHome.loadSimpleHome(books.companyId, { can: () => true, now: NOW })
    expect(home.vat).toEqual({ estimateCents: -20_000, source: 'return', periodLabel: 'septembre 2026', deadline: { date: '2026-10-21', label: 'Déclaration et paiement de la TVA de septembre 2026', estimated: false } })

    const draft = await book('VE', '2026-09-30', 'Facture brouillon', [['411000', 12, 0], ['706000', 0, 10], ['445710', 0, 2]], 'draft')
    const estimate = await simpleHome.loadSimpleHome(books.companyId, { can: () => true, now: NOW })
    expect(estimate.vat).toMatchObject({ source: 'estimate', periodLabel: null })
    await svc.deleteDraftEntry(books.companyId, draft)
  })

  it('replaces a stale settlement draft, carries the credit and checks it against the filing', async () => {
    const created = await settle.prepareVatSettlement(books.companyId, '2026-09', { now: NOW })
    expect(created.status).toBe('created')
    expect(created.lines.find((l) => l.code === '445670')).toMatchObject({ debitCents: 20_000 })
    await book('VE', '2026-09-25', 'Facture complémentaire', [['411000', 120, 0], ['706000', 0, 100], ['445710', 0, 20]])
    const replaced = await settle.prepareVatSettlement(books.companyId, '2026-09', { now: NOW })
    expect(replaced.status).toBe('replaced')
    expect(replaced.entryId).not.toBe(created.entryId)
    expect(await prisma.accountingEntry.count({ where: { companyId: books.companyId, reference: 'TVA-CA3-2026-09' } })).toBe(1)
    expect(replaced.lines.find((l) => l.code === '445670')).toMatchObject({ debitCents: 18_000 })
    await svc.validateEntries(books.companyId, [replaced.entryId as string])
    await filing.recordVatFiling(books.companyId, { period: '2026-09', filedOn: '2026-10-15', amountDueCents: 0, creditCents: 18_000 }, { now: new Date('2026-10-16T09:00:00Z') })

    const { view: october } = await load.buildVatReturn(books.companyId, '2026-10', new Date('2026-11-05T09:00:00Z'))
    expect(lineOf(october, '22')).toMatchObject({ amount: 180, amountCents: 18_000 })
    expect(october.computation?.result).toMatchObject({ kind: 'credit', creditEuros: 180 })
    expect(october.checks.some((c) => c.id === 'credit')).toBe(false)
    expect(october.checks.find((c) => c.id === 'balances')?.severity).toBe('ok')
    // A credit declared differently from the books is flagged
    await prisma.vatReturnFiling.update({ where: { companyId_periodKey: { companyId: books.companyId, periodKey: '2026-09' } }, data: { creditAmount: 190 } })
    const { view: flagged } = await load.buildVatReturn(books.companyId, '2026-10', new Date('2026-11-05T09:00:00Z'))
    expect(flagged.checks.find((c) => c.id === 'credit')).toMatchObject({ severity: 'warning' })
  })

  it('picks the return due next by default and lists the periods with their filings', async () => {
    const { view } = await load.buildVatReturn(books.companyId, undefined, NOW)
    expect(view.period?.id).toBe('2026-09')
    expect(view.periods[0]).toMatchObject({ id: '2026-10', form: 'CA3' })
    expect(view.periods.find((p) => p.id === '2026-08')?.filed).toBe(true)
    expect(view.periods.at(-1)?.id).toBe('2025-01')
  })

  it('has nothing to file under the franchise en base (CGI art. 293 B)', async () => {
    const { view } = await load.buildVatReturn(franchise.companyId, undefined, NOW)
    expect(view).toMatchObject({ status: 'exempt', period: null, computation: null })
    expect(view.sources.map((s) => s.label)).toContain('CGI, art. 293 B (franchise en base)')
    await expect(settle.prepareVatSettlement(franchise.companyId, '2026-09', { now: NOW })).rejects.toThrow('rien à liquider')
  })

  describe('routes', () => {
    it('reads the worksheet for every member, 404 outside the company, 401 without a session', async () => {
      for (const who of ['owner', 'accountant', 'viewer'] as const) {
        const response = await call(who, routes.view.GET, 'GET', `${base()}?period=2026-09`)
        expect(response.status, who).toBe(200)
        const data = (await response.json()) as VatReturnView
        expect(data.period?.id).toBe('2026-09')
        expect(data.settlement.status).toBe('validated')
      }
      expect((await call('outsider', routes.view.GET, 'GET', `${base()}?period=2026-09`)).status).toBe(404)
      expect((await call('anonymous', routes.view.GET, 'GET', `${base()}?period=2026-09`)).status).toBe(401)
    })

    it('refuses an unknown period with a French message', async () => {
      const malformed = await call('owner', routes.view.GET, 'GET', `${base()}?period=2026-13`)
      expect(malformed.status).toBe(400)
      const outside = await call('owner', routes.view.GET, 'GET', `${base()}?period=2019-01`)
      expect(outside.status).toBe(400)
      expect(((await outside.json()) as { error: string }).error).toContain('choisissez une période de la liste')
    })

    it('exports the worksheet as CSV and PDF (reports:export)', async () => {
      const csv = await call('accountant', routes.exportFile.GET, 'GET', `${base()}/export?period=2026-09&format=csv`)
      expect(csv.status).toBe(200)
      expect(csv.headers.get('content-type')).toContain('text/csv')
      expect(csv.headers.get('content-disposition')).toContain('TVA_CA3_2026-09_vat_a.csv')
      const bytes = Buffer.from(await csv.arrayBuffer())
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
      const text = bytes.toString('utf8')
      expect(text).toContain('08;0207;Taux normal 20 %')
      const pdf = await call('owner', routes.exportFile.GET, 'GET', `${base()}/export?period=2026-09&format=pdf`)
      expect(pdf.status).toBe(200)
      expect(pdf.headers.get('content-type')).toBe('application/pdf')
      expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF')
      expect((await call('viewer', routes.exportFile.GET, 'GET', `${base()}/export?period=2026-09&format=csv`)).status).toBe(403)
    })

    it('prepares the settlement for entries:create only', async () => {
      await book('VE', '2026-10-06', 'Facture octobre', [['411000', 600, 0], ['706000', 0, 500], ['445710', 0, 100]])
      expect((await call('viewer', routes.settlement.POST, 'POST', `${base()}/settlement`, { period: '2026-10' })).status).toBe(403)
      const response = await call('accountant', routes.settlement.POST, 'POST', `${base()}/settlement`, { period: '2026-10' })
      expect(response.status).toBe(201)
      const result = (await response.json()) as VatSettlementResult
      expect(result.status).toBe('created')
      const again = await call('accountant', routes.settlement.POST, 'POST', `${base()}/settlement`, { period: '2026-10' })
      expect(again.status).toBe(200)
      expect(((await again.json()) as VatSettlementResult).status).toBe('unchanged')
    })

    it('records and removes a filing, with French messages for wrong amounts and dates', async () => {
      const both = await call('owner', routes.filing.PUT, 'PUT', `${base()}/filing`, { period: '2026-07', filedOn: '2026-08-20', amountDueCents: 100, creditCents: 100 })
      expect(both.status).toBe(400)
      expect(((await both.json()) as { error: string }).error).toContain('laissez l’un des deux à zéro')
      const negative = await call('owner', routes.filing.PUT, 'PUT', `${base()}/filing`, { period: '2026-07', filedOn: '2026-08-20', amountDueCents: -1, creditCents: 0 })
      expect(negative.status).toBe(400)
      expect((await call('viewer', routes.filing.PUT, 'PUT', `${base()}/filing`, { period: '2026-07', filedOn: '2026-08-20', amountDueCents: 0, creditCents: 0 })).status).toBe(403)
      const saved = await call('accountant', routes.filing.PUT, 'PUT', `${base()}/filing`, { period: '2026-07', filedOn: '2026-08-20', amountDueCents: 0, creditCents: 0 })
      expect(saved.status).toBe(200)
      expect(await saved.json()).toEqual({ period: '2026-07', filedOn: '2026-08-20', amountDueCents: 0, creditCents: 0 })
      const removed = await call('accountant', routes.filing.DELETE, 'DELETE', `${base()}/filing?period=2026-07`)
      expect(removed.status).toBe(200)
      expect((await call('accountant', routes.filing.DELETE, 'DELETE', `${base()}/filing?period=2026-07`)).status).toBe(404)
    })

    it('refuses the amounts the database forbids, whatever the code path', async () => {
      await expect(
        prisma.vatReturnFiling.create({
          data: { companyId: books.companyId, form: 'CA3', periodKey: '2026', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-12-31'), filedOn: new Date('2027-01-10'), amountDue: 0, creditAmount: 0 },
        }),
      ).rejects.toThrow()
      await expect(
        prisma.vatReturnFiling.create({
          data: { companyId: books.companyId, form: 'CA3', periodKey: '2026-06', periodStart: new Date('2026-06-01'), periodEnd: new Date('2026-06-30'), filedOn: new Date('2026-07-10'), amountDue: 10, creditAmount: 5 },
        }),
      ).rejects.toThrow()
    })
  })
})
