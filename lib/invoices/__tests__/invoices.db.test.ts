/**
 * Purchase and sales ledger against PostgreSQL (skipped without the server):
 * tiers rules and the auxiliary account helper, invoices with several VAT
 * rates, posting to the fiscal year containing the invoice date (never
 * another one), accounts and tiers of another company refused, payments
 * from reconciled bank lines with lettering once paid, partial payments
 * without lettering, VAT on receipts moved from 44574 to 44571, unposting,
 * concurrent posts, and the tiers names and terms in the aged balance.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('invoices')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedBooks, type Books } from './helpers/books'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let invoices: typeof import('../manage-invoices.service')
let posting: typeof import('../post-invoice.service')
let payments: typeof import('../invoice-payments.service')
let tiersSvc: typeof import('@/lib/tiers/manage-tiers.service')
let attach: typeof import('@/lib/tiers/attach-auxiliary-accounts.service')
let reports: typeof import('@/lib/reports/third-parties/get-third-party-reports.service')
let vat: typeof import('@/lib/companies/vat-settings.service')
let errors: typeof import('@/lib/accounting/errors')

const NOW = new Date('2026-06-15T10:00:00Z')

const line = (label: string, quantity: string, unitPriceCents: number, vatRateBp: number, extra: Record<string, unknown> = {}) => ({
  label,
  quantity,
  unitPriceCents,
  vatRateBp,
  accountCode: null,
  nature: 'SERVICES' as const,
  fixedAsset: false,
  ...extra,
})

async function entryLines(entryId: string) {
  const rows = await prisma.entryLine.findMany({
    where: { accountingEntryId: entryId },
    select: { debit: true, credit: true, auxiliaryAccountNumber: true, letteringCode: true, account: { select: { code: true, fiscalYearId: true } } },
  })
  return rows.map((r) => ({ code: r.account.code, debit: r.debit.toString(), credit: r.credit.toString(), aux: r.auxiliaryAccountNumber, fy: r.account.fiscalYearId, lettering: r.letteringCode }))
}

describe.skipIf(!available)('purchase and sales ledger (PostgreSQL)', () => {
  let books: Books

  beforeAll(async () => {
    await prepareTestDatabase('invoices')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    invoices = await import('../manage-invoices.service')
    posting = await import('../post-invoice.service')
    payments = await import('../invoice-payments.service')
    tiersSvc = await import('@/lib/tiers/manage-tiers.service')
    attach = await import('@/lib/tiers/attach-auxiliary-accounts.service')
    reports = await import('@/lib/reports/third-parties/get-third-party-reports.service')
    vat = await import('@/lib/companies/vat-settings.service')
    errors = await import('@/lib/accounting/errors')
  })
  beforeEach(async () => {
    await prepareTestDatabase('invoices')
    books = await seedBooks(prisma, svc, { siren: '900000101', slug: 'factures-alpha' })
  })
  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('tiers', () => {
    it('creates tiers with the next auxiliary number, checked identifiers and an owned address', async () => {
      const a = await tiersSvc.createTiers(books.companyId, { kind: 'CUSTOMER', name: 'Éole', email: null, siret: '73282932000074', vatNumber: 'fr44732829320', address: { street: '1 rue A', street2: null, postalCode: '75001', city: 'Paris', country: 'FR' } })
      expect(a).toMatchObject({ auxiliaryAccountNumber: 'C00002', siren: '732829320', siret: '73282932000074', vatNumber: 'FR44732829320' })
      expect(a.address?.city).toBe('Paris')
      expect((await prisma.address.findUniqueOrThrow({ where: { id: a.address!.id } })).companyId).toBe(books.companyId)
      const b = await tiersSvc.createTiers(books.companyId, { kind: 'SUPPLIER', name: 'Brico', email: null, paymentTerms: { days: 45, endOfMonth: true } })
      expect(b.auxiliaryAccountNumber).toBe('F00002')
      expect(b).toMatchObject({ paymentTermsDays: 45, paymentTermsEndOfMonth: true })
    })

    it('refuses an invalid SIREN, terms above L441-10 and a taken auxiliary number', async () => {
      await expect(tiersSvc.createTiers(books.companyId, { kind: 'CUSTOMER', name: 'X', email: null, siren: '123456789' })).rejects.toThrow(/SIREN/)
      await expect(tiersSvc.createTiers(books.companyId, { kind: 'CUSTOMER', name: 'X', email: null, paymentTerms: { days: 50, endOfMonth: true } })).rejects.toThrow(/45 jours/)
      await expect(tiersSvc.createTiers(books.companyId, { kind: 'CUSTOMER', name: 'X', email: null, auxiliaryAccountNumber: 'c00001' })).rejects.toBeInstanceOf(errors.ConflictError)
      await expect(tiersSvc.createTiers(books.companyId, { kind: 'SUPPLIER', name: 'X', email: null, defaultAccountCode: '706' })).rejects.toThrow(/classe 6/)
    })

    it('keeps the auxiliary number of a tiers with invoices, refuses to delete it, and deletes a free one with its address', async () => {
      await invoices.createInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, number: 'V1', issueDate: '2026-03-01', typeCode: '380', lines: [line('A', '1', 1000, 2000)] })
      await expect(tiersSvc.updateTiers(books.companyId, books.customerId, { auxiliaryAccountNumber: 'C09999' })).rejects.toBeInstanceOf(errors.ConflictError)
      await expect(tiersSvc.deleteTiers(books.companyId, books.customerId)).rejects.toBeInstanceOf(errors.ConflictError)
      const free = await tiersSvc.createTiers(books.companyId, { kind: 'CUSTOMER', name: 'Libre', email: null, address: { street: '2 rue B', street2: null, postalCode: '69001', city: 'Lyon', country: 'FR' } })
      await tiersSvc.deleteTiers(books.companyId, free.id)
      expect(await prisma.address.count({ where: { id: free.address!.id } })).toBe(0)
    })

    it('never reads or changes the tiers of another company', async () => {
      const other = await seedBooks(prisma, svc, { siren: '900000102', slug: 'factures-beta' })
      await expect(tiersSvc.getTiers(books.companyId, other.customerId)).rejects.toBeInstanceOf(errors.NotFoundError)
      await expect(tiersSvc.updateTiers(books.companyId, other.customerId, { name: 'Pris' })).rejects.toBeInstanceOf(errors.NotFoundError)
      await expect(tiersSvc.deleteTiers(books.companyId, other.customerId)).rejects.toBeInstanceOf(errors.NotFoundError)
      const listed = await tiersSvc.listTiers(books.companyId, { limit: 50 })
      expect(listed.tiers.every((t) => t.id !== other.customerId)).toBe(true)
    })

    it('creates the tiers of the auxiliary numbers of the books without changing any line, once', async () => {
      const sale = await svc.createEntry({
        companyId: books.companyId,
        journalId: books.journals.VE,
        date: '2026-02-01',
        description: 'Facture importée',
        status: 'validated',
        lines: [
          { accountId: books.accounts['411000'], debit: '100', credit: '0', auxiliaryAccountNumber: 'DUPONT', auxiliaryAccountLabel: 'Dupont et fils' },
          { accountId: books.accounts['706000'], debit: '0', credit: '100' },
        ],
      })
      await svc.createEntry({
        companyId: books.companyId,
        journalId: books.journals.OD,
        date: '2026-02-02',
        description: 'Ambigu',
        status: 'validated',
        lines: [
          { accountId: books.accounts['411000'], debit: '5', credit: '0', auxiliaryAccountNumber: 'MIXTE' },
          { accountId: books.accounts['401000'], debit: '0', credit: '5', auxiliaryAccountNumber: 'MIXTE' },
        ],
      })
      const before = await entryLines(sale.id)
      const first = await attach.attachAuxiliaryAccounts(books.companyId)
      expect(first.created).toBe(1)
      expect(first.skipped).toEqual([expect.objectContaining({ auxiliaryAccountNumber: 'MIXTE' })])
      expect(await prisma.tiers.findFirst({ where: { companyId: books.companyId, auxiliaryAccountNumber: 'DUPONT' }, select: { name: true, kind: true } })).toEqual({ name: 'Dupont et fils', kind: 'CUSTOMER' })
      expect(await entryLines(sale.id)).toEqual(before)
      const second = await attach.attachAuxiliaryAccounts(books.companyId)
      expect(second).toMatchObject({ created: 0, alreadyAttached: 1 })
    })
  })

  describe('invoices', () => {
    it('computes totals on the server, per rate, and the due date from the tiers terms', async () => {
      await prisma.tiers.update({ where: { id: books.supplierId }, data: { paymentTermsDays: 45, paymentTermsEndOfMonth: true } })
      const invoice = await invoices.createInvoice(books.companyId, {
        direction: 'PURCHASE',
        tiersId: books.supplierId,
        number: 'D-1',
        issueDate: '2026-01-10',
        typeCode: '380',
        lines: [line('Papier', '2', 4999, 2000), line('Livres', '1', 1234, 550), line('Port', '3', 333, 1000)],
      })
      expect(invoice).toMatchObject({ totalExclTaxCents: 12231, totalVatCents: 2168, totalInclTaxCents: 14399, status: 'draft', dueDate: '2026-02-28' })
      expect(invoice.vatBreakdown).toEqual([
        { vatRateBp: 2000, baseCents: 9998, vatCents: 2000 },
        { vatRateBp: 1000, baseCents: 999, vatCents: 100 },
        { vatRateBp: 550, baseCents: 1234, vatCents: 68 },
      ])
      expect(invoice.parties).toMatchObject({ buyerSiren: '900000101' })
    })

    it('refuses a due date beyond L441-10, a foreign rate, a wrong kind of tiers and a duplicate sales number', async () => {
      const base = { direction: 'SALE' as const, tiersId: books.customerId, number: 'V1', issueDate: '2026-01-10', typeCode: '380' as const, lines: [line('A', '1', 1000, 2000)] }
      await expect(invoices.createInvoice(books.companyId, { ...base, dueDate: '2026-03-12' })).rejects.toThrow(/L441-10/)
      await expect(invoices.createInvoice(books.companyId, { ...base, lines: [line('A', '1', 1000, 2200)] })).rejects.toThrow(/taux de TVA français/)
      await expect(invoices.createInvoice(books.companyId, { ...base, tiersId: books.supplierId })).rejects.toThrow(/client/)
      await invoices.createInvoice(books.companyId, base)
      const otherCustomer = await tiersSvc.createTiers(books.companyId, { kind: 'CUSTOMER', name: 'Autre', email: null })
      await expect(invoices.createInvoice(books.companyId, { ...base, tiersId: otherCustomer.id })).rejects.toBeInstanceOf(errors.ConflictError)
    })

    it('refuses VAT on the sales of a company under the VAT franchise (CGI art. 293 B)', async () => {
      await prisma.company.update({ where: { id: books.companyId }, data: { isVatExempt: true } })
      await expect(
        invoices.createInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, number: 'V9', issueDate: '2026-01-10', typeCode: '380', lines: [line('A', '1', 1000, 2000)] }),
      ).rejects.toThrow(/293 B/)
      expect((await vat.getVatSettings(books.companyId)).isVatExempt).toBe(true)
    })

    it('posts a purchase with several rates and a fixed asset as a draft AC entry of the fiscal year containing its date', async () => {
      const invoice = await invoices.createInvoice(books.companyId, {
        direction: 'PURCHASE',
        tiersId: books.supplierId,
        number: 'D-2',
        issueDate: '2026-04-03',
        typeCode: '380',
        lines: [
          line('Ordinateur', '1', 100000, 2000, { accountCode: '2183', fixedAsset: true, nature: 'GOODS' }),
          line('Papier', '2', 4999, 2000),
          line('Port', '1', 1000, 1000, { accountCode: '6241' }),
        ],
      })
      const posted = await posting.postInvoice(books.companyId, invoice.id)
      expect(posted.fiscalYear).toBe(2026)
      const entry = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: posted.entryId }, select: { status: true, journalId: true, fiscalYearId: true, date: true, reference: true } })
      expect(entry).toMatchObject({ status: 'draft', journalId: books.journals.AC, fiscalYearId: books.fiscalYearId, reference: 'D-2' })
      expect(entry.date.toISOString().slice(0, 10)).toBe('2026-04-03')
      const lines = await entryLines(posted.entryId)
      expect(lines.every((l) => l.fy === books.fiscalYearId)).toBe(true)
      const by = (code: string) => lines.filter((l) => l.code === code)
      expect(by('401000')).toEqual([expect.objectContaining({ credit: '1330.98', aux: 'F00001' })])
      expect(by('2183')[0].debit).toBe('1000')
      expect(by('6064')[0].debit).toBe('99.98')
      expect(by('6241')[0].debit).toBe('10')
      // 20 %: (1 000 + 99,98) x 20 % = 219,996 -> 220,00, split by base: 200,01 to 44562, 19,99 to 44566; 10 %: 1,00 to 44566
      expect(by('445620').map((l) => l.debit)).toEqual(['200.01'])
      expect(by('445660').map((l) => l.debit).sort()).toEqual(['1', '19.99'])
      expect((await invoices.getInvoice(books.companyId, invoice.id)).status).toBe('posted')
      await expect(posting.postInvoice(books.companyId, invoice.id)).rejects.toBeInstanceOf(errors.ConflictError)
    })

    it('refuses to post when no fiscal year contains the date, or when it is closed, and never uses another year', async () => {
      const noYear = await invoices.createInvoice(books.companyId, { direction: 'PURCHASE', tiersId: books.supplierId, number: 'D-3', issueDate: '2024-06-01', typeCode: '380', lines: [line('A', '1', 1000, 2000)] })
      await expect(posting.postInvoice(books.companyId, noYear.id)).rejects.toThrow(/Aucun exercice ne contient le 01\/06\/2024/)
      const closed = await invoices.createInvoice(books.companyId, { direction: 'PURCHASE', tiersId: books.supplierId, number: 'D-4', issueDate: '2025-06-01', typeCode: '380', lines: [line('A', '1', 1000, 2000)] })
      await expect(posting.postInvoice(books.companyId, closed.id)).rejects.toBeInstanceOf(errors.ConflictError)
      expect(await prisma.accountingEntry.count({ where: { companyId: books.companyId } })).toBe(0)
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: closed.id } })).entryId).toBeNull()
    })

    it('resolves accounts in this company only: a code that exists only in another company is refused', async () => {
      const other = await seedBooks(prisma, svc, { siren: '900000103', slug: 'factures-gamma' })
      await prisma.account.create({ data: { companyId: other.companyId, fiscalYearId: other.fiscalYearId, code: '6068', label: 'Autres matières' } })
      const invoice = await invoices.createInvoice(books.companyId, {
        direction: 'PURCHASE',
        tiersId: books.supplierId,
        number: 'D-5',
        issueDate: '2026-04-03',
        typeCode: '380',
        lines: [line('A', '1', 1000, 2000, { accountCode: '6068' })],
      })
      await expect(posting.postInvoice(books.companyId, invoice.id)).rejects.toThrow(/6068 n’existe pas dans le plan de comptes de l’exercice 2026/)
    })

    it('never reaches an invoice, a tiers or a payment line of another company (IDOR)', async () => {
      const other = await seedBooks(prisma, svc, { siren: '900000104', slug: 'factures-delta' })
      const theirs = await invoices.createInvoice(other.companyId, { direction: 'SALE', tiersId: other.customerId, number: 'B1', issueDate: '2026-03-01', typeCode: '380', lines: [line('A', '1', 1000, 2000)] })
      await expect(invoices.getInvoice(books.companyId, theirs.id)).rejects.toBeInstanceOf(errors.NotFoundError)
      await expect(invoices.deleteInvoice(books.companyId, theirs.id)).rejects.toBeInstanceOf(errors.NotFoundError)
      await expect(posting.postInvoice(books.companyId, theirs.id)).rejects.toBeInstanceOf(errors.NotFoundError)
      await expect(
        invoices.createInvoice(books.companyId, { direction: 'SALE', tiersId: other.customerId, number: 'X', issueDate: '2026-03-01', typeCode: '380', lines: [line('A', '1', 1000, 2000)] }),
      ).rejects.toBeInstanceOf(errors.NotFoundError)
      const mine = await invoices.createInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, number: 'V2', issueDate: '2026-03-01', typeCode: '380', lines: [line('A', '1', 1000, 2000, { nature: 'GOODS' })] })
      await posting.postInvoice(books.companyId, mine.id)
      const theirPayment = await other.payment('customer', '2026-03-10', '12.00')
      await expect(payments.recordInvoicePayment(books.companyId, mine.id, theirPayment)).rejects.toBeInstanceOf(errors.NotFoundError)
      await expect(payments.listPaymentCandidates(books.companyId, theirs.id)).rejects.toBeInstanceOf(errors.NotFoundError)
      expect((await invoices.listInvoices(books.companyId, { direction: 'SALE', status: 'all', limit: 50 })).items.map((i) => i.id)).toEqual([mine.id])
    })

    it('unposts a draft entry, and the deleted draft brings the invoice back to brouillon', async () => {
      const invoice = await invoices.createInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, number: 'V3', issueDate: '2026-03-01', typeCode: '380', lines: [line('A', '1', 1000, 2000, { nature: 'GOODS' })] })
      const posted = await posting.postInvoice(books.companyId, invoice.id)
      await expect(invoices.updateInvoice(books.companyId, invoice.id, { tiersId: books.customerId, number: 'V3', issueDate: '2026-03-01', typeCode: '380', lines: [line('A', '1', 2000, 2000)] })).rejects.toBeInstanceOf(
        errors.ConflictError,
      )
      await posting.unpostInvoice(books.companyId, invoice.id)
      expect(await prisma.accountingEntry.count({ where: { id: posted.entryId } })).toBe(0)
      expect((await invoices.getInvoice(books.companyId, invoice.id)).status).toBe('draft')

      const again = await posting.postInvoice(books.companyId, invoice.id)
      await svc.deleteDraftEntry(books.companyId, again.entryId)
      expect((await invoices.getInvoice(books.companyId, invoice.id)).status).toBe('draft')
    })

    it('posts one entry when two people post the same invoice at the same time', async () => {
      const invoice = await invoices.createInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, number: 'V4', issueDate: '2026-03-01', typeCode: '380', lines: [line('A', '1', 1000, 2000, { nature: 'GOODS' })] })
      const results = await Promise.allSettled([posting.postInvoice(books.companyId, invoice.id), posting.postInvoice(books.companyId, invoice.id)])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
      expect(await prisma.accountingEntry.count({ where: { companyId: books.companyId } })).toBe(1)
    })
  })

  describe('payments', () => {
    async function postedSale(number: string, cents: number, nature: 'GOODS' | 'SERVICES' = 'GOODS') {
      const invoice = await invoices.createInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, number, issueDate: '2026-03-01', typeCode: '380', lines: [line('Vente', '1', cents, 2000, { nature })] })
      const posted = await posting.postInvoice(books.companyId, invoice.id)
      return { invoice, posted }
    }

    it('records a full bank payment and letters the invoice with it (status paid)', async () => {
      const { invoice, posted } = await postedSale('V10', 10000)
      await svc.validateEntries(books.companyId, [posted.entryId])
      const paymentLine = await books.payment('customer', '2026-04-02', '120.00')
      const { candidates, remainingCents } = await payments.listPaymentCandidates(books.companyId, invoice.id)
      expect(remainingCents).toBe(12000)
      expect(candidates).toEqual([expect.objectContaining({ entryLineId: paymentLine, amountCents: 12000, exact: true })])
      const result = await payments.recordInvoicePayment(books.companyId, invoice.id, paymentLine, { now: NOW })
      expect(result).toMatchObject({ paidCents: 12000, remainingCents: 0, lettered: true, letteringCode: 'AA', letteringPending: null })
      const detail = await invoices.getInvoice(books.companyId, invoice.id)
      expect(detail).toMatchObject({ status: 'paid', letteringCode: 'AA', remainingCents: 0 })
      expect((await prisma.entryLine.findUniqueOrThrow({ where: { id: paymentLine } })).letteringCode).toBe('AA')
      await expect(payments.removeInvoicePayment(books.companyId, invoice.id, detail.payments[0].id)).rejects.toBeInstanceOf(errors.ConflictError)
    })

    it('leaves a part payment unlettered (status payée partiellement), then letters every line on the last payment', async () => {
      const { invoice, posted } = await postedSale('V11', 10000)
      const first = await books.payment('customer', '2026-04-02', '50.00')
      const partial = await payments.recordInvoicePayment(books.companyId, invoice.id, first)
      expect(partial).toMatchObject({ paidCents: 5000, remainingCents: 7000, lettered: false, letteringPending: null })
      expect((await invoices.getInvoice(books.companyId, invoice.id)).status).toBe('partially_paid')
      expect((await prisma.entryLine.findUniqueOrThrow({ where: { id: first } })).letteringCode).toBeNull()

      const second = await books.payment('customer', '2026-04-20', '70.00', { aux: 'C00001' })
      const full = await payments.recordInvoicePayment(books.companyId, invoice.id, second)
      // The invoice entry is still a draft: paid, lettering waits for its validation
      expect(full).toMatchObject({ paidCents: 12000, lettered: false })
      expect(full.letteringPending).toMatch(/Validez l’écriture/)
      expect((await invoices.getInvoice(books.companyId, invoice.id)).status).toBe('paid')

      await svc.validateEntries(books.companyId, [posted.entryId])
      const settled = await payments.settleInvoice(books.companyId, invoice.id, { now: NOW })
      expect(settled).toMatchObject({ lettered: true, letteringCode: 'AA' })
      const codes = await prisma.entryLine.findMany({ where: { id: { in: [first, second] } }, select: { letteringCode: true } })
      expect(codes.map((c) => c.letteringCode)).toEqual(['AA', 'AA'])
    })

    it('refuses a draft payment, a line not reconciled with the bank, another tiers, and more than what is due', async () => {
      const { invoice } = await postedSale('V12', 10000)
      await expect(payments.recordInvoicePayment(books.companyId, invoice.id, await books.payment('customer', '2026-04-02', '10.00', { status: 'draft' }))).rejects.toBeInstanceOf(
        errors.ConflictError,
      )
      await expect(payments.recordInvoicePayment(books.companyId, invoice.id, await books.payment('customer', '2026-04-02', '10.00', { reconciled: false }))).rejects.toThrow(
        /rapproché/,
      )
      await expect(payments.recordInvoicePayment(books.companyId, invoice.id, await books.payment('customer', '2026-04-02', '10.00', { aux: 'C99999' }))).rejects.toThrow(
        /autre tiers/,
      )
      await expect(payments.recordInvoicePayment(books.companyId, invoice.id, await books.payment('customer', '2026-04-02', '130.00'))).rejects.toThrow(/dépasse le reste/)
      // A supplier payment (401 debit) is on another account
      await expect(payments.recordInvoicePayment(books.companyId, invoice.id, await books.payment('supplier', '2026-04-02', '10.00'))).rejects.toThrow(/compte 401000/)
      expect(await prisma.invoicePayment.count()).toBe(0)
    })

    it('records a line once only', async () => {
      const a = await postedSale('V13', 10000)
      const b = await postedSale('V14', 10000)
      const paymentLine = await books.payment('customer', '2026-04-02', '50.00')
      await payments.recordInvoicePayment(books.companyId, a.invoice.id, paymentLine)
      await expect(payments.recordInvoicePayment(books.companyId, b.invoice.id, paymentLine)).rejects.toBeInstanceOf(errors.ConflictError)
      expect((await payments.listPaymentCandidates(books.companyId, b.invoice.id)).candidates).toEqual([])
    })

    it('moves the VAT of services from 44574 to 44571 with each payment (CGI art. 269, 2, c), the rest on the last one', async () => {
      const { invoice, posted } = await postedSale('V20', 10000, 'SERVICES')
      const lines = await entryLines(posted.entryId)
      expect(lines.find((l) => l.code === '445740')).toMatchObject({ credit: '20' })
      expect(lines.find((l) => l.code === '445710')).toBeUndefined()

      const first = await payments.recordInvoicePayment(books.companyId, invoice.id, await books.payment('customer', '2026-04-02', '40.00'))
      expect(first.vatTransferEntryId).not.toBeNull()
      const firstMove = await entryLines(first.vatTransferEntryId!)
      // 20,00 x 40 / 120 = 6,666 -> 6,67
      expect(firstMove).toEqual(expect.arrayContaining([expect.objectContaining({ code: '445740', debit: '6.67' }), expect.objectContaining({ code: '445710', credit: '6.67' })]))
      const transfer = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: first.vatTransferEntryId! }, select: { status: true, journalId: true, date: true } })
      expect(transfer).toMatchObject({ status: 'draft', journalId: books.journals.OD })
      expect(transfer.date.toISOString().slice(0, 10)).toBe('2026-04-02')

      const second = await payments.recordInvoicePayment(books.companyId, invoice.id, await books.payment('customer', '2026-04-30', '80.00'))
      const secondMove = await entryLines(second.vatTransferEntryId!)
      expect(secondMove.find((l) => l.code === '445740')?.debit).toBe('13.33')

      // Removing the last payment deletes its draft VAT move
      const detail = await invoices.getInvoice(books.companyId, invoice.id)
      await payments.removeInvoicePayment(books.companyId, invoice.id, detail.payments[1].id)
      expect(await prisma.accountingEntry.count({ where: { id: second.vatTransferEntryId! } })).toBe(0)
      expect((await invoices.getInvoice(books.companyId, invoice.id)).status).toBe('partially_paid')
      await expect(posting.unpostInvoice(books.companyId, invoice.id)).rejects.toThrow(/règlements/)
    })

    it('posts the VAT of services to 44571 at once with the option for debits', async () => {
      await vat.updateVatSettings(books.companyId, { servicesVatOnDebits: true })
      const { posted } = await postedSale('V21', 10000, 'SERVICES')
      const lines = await entryLines(posted.entryId)
      expect(lines.find((l) => l.code === '445710')).toMatchObject({ credit: '20' })
      expect(lines.find((l) => l.code === '445740')).toBeUndefined()
    })
  })

  describe('third-party reports', () => {
    it('shows the tiers name and applies its own payment terms in the aged balance', async () => {
      await prisma.tiers.update({ where: { id: books.customerId }, data: { name: 'Martin et associés', paymentTermsDays: 0, paymentTermsEndOfMonth: false } })
      const invoice = await invoices.createInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, number: 'V30', issueDate: '2026-05-01', typeCode: '380', lines: [line('A', '1', 10000, 2000, { nature: 'GOODS' })] })
      const posted = await posting.postInvoice(books.companyId, invoice.id)
      await svc.validateEntries(books.companyId, [posted.entryId])
      const report = await reports.getAgedBalance(books.companyId, { fiscalYearId: books.fiscalYearId, asOf: '2026-05-20' }, NOW)
      const tiers = report.customers.tiers.find((t) => t.code === 'C00001')!
      expect(tiers.label).toBe('Martin et associés')
      // Terms of the tiers (0 days), not the company's 30 days: due 1 May, 19 days late on 20 May
      expect(tiers.oldestDueDate).toBe('2026-05-01')
      expect(tiers.buckets.days0to30).toBe(12000)
    })
  })
})
