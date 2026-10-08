/**
 * Automatic numbering of sales invoices against PostgreSQL (skipped without
 * the server). CGI ann. II art. 242 nonies A, I, 7°: a unique number in a
 * chronological and continuous sequence; BOI-TVA-DECLA-30-20-20-10 § 80 to
 * 100: separate series allowed. Checked here: a draft has no number, the
 * number is given when posted, two postings at once get two consecutive
 * numbers, a failed or rolled back posting gives no number, deleting a
 * draft leaves no gap, a numbered invoice keeps its number and cannot be
 * deleted, chronology, existing numbers and the starting number, yearly
 * reset, credit notes in their own series, typed numbers (manual mode,
 * invoices already issued), management fee series apart, company isolation
 * and the audit of a configuration change. Fictitious data.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('invoice_numbering')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { DEFAULT_NUMBERING, type InvoiceNumberingSettings } from '../numbering/format'
import { seedBooks, type Books } from './helpers/books'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let invoices: typeof import('../manage-invoices.service')
let posting: typeof import('../post-invoice.service')
let series: typeof import('../numbering/series')
let settingsSvc: typeof import('../numbering/manage-numbering-settings.service')
let issuing: typeof import('../create-in-qonto.service')
let errors: typeof import('@/lib/accounting/errors')

const NOW = new Date('2026-06-15T10:00:00Z')

const line = (label: string, unitPriceCents = 10_000) => ({ label, quantity: '1', unitPriceCents, vatRateBp: 2000, accountCode: null, nature: 'GOODS' as const, fixedAsset: false })

describe.skipIf(!available)('sales invoice numbering (PostgreSQL)', () => {
  let books: Books

  const draft = (issueDate = '2026-03-02', extra: Record<string, unknown> = {}) =>
    invoices.createInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, issueDate, typeCode: '380', lines: [line('Vente')], ...extra })
  const numberOf = async (id: string) => (await prisma.invoice.findUniqueOrThrow({ where: { id }, select: { number: true } })).number
  const configure = (over: Partial<InvoiceNumberingSettings>, nextNumbers?: { invoice?: number; creditNote?: number }) =>
    settingsSvc.updateInvoiceNumbering(books.companyId, { settings: { ...DEFAULT_NUMBERING, ...over }, ...(nextNumbers ? { nextNumbers } : {}) }, { now: NOW })

  beforeAll(async () => {
    await prepareTestDatabase('invoice_numbering')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    invoices = await import('../manage-invoices.service')
    posting = await import('../post-invoice.service')
    series = await import('../numbering/series')
    settingsSvc = await import('../numbering/manage-numbering-settings.service')
    issuing = await import('../create-in-qonto.service')
    errors = await import('@/lib/accounting/errors')
  })
  beforeEach(async () => {
    await prepareTestDatabase('invoice_numbering')
    books = await seedBooks(prisma, svc, { siren: '900000301', slug: 'numerotation-alpha' })
  })
  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('assignment when posted', () => {
    it('records a sales draft without number, shows the provisional next one, and numbers it F2026-0001 when posted', async () => {
      const invoice = await draft()
      expect(invoice).toMatchObject({ number: null, origin: 'AUTO', provisionalNumber: 'F2026-0001', numberAssignedAt: null })
      const posted = await posting.postInvoice(books.companyId, invoice.id)
      expect(posted.number).toBe('F2026-0001')
      const stored = await invoices.getInvoice(books.companyId, invoice.id)
      expect(stored).toMatchObject({ number: 'F2026-0001', origin: 'AUTO', provisionalNumber: null })
      expect(stored.numberAssignedAt).not.toBeNull()
      const entry = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: posted.entryId }, select: { reference: true, description: true } })
      expect(entry.reference).toBe('F2026-0001')
      expect(entry.description).toBe('Facture F2026-0001 Martin SA')
    })

    it('gives two distinct consecutive numbers to two postings at the same time', async () => {
      const a = await draft()
      const b = await draft()
      const c = await draft()
      const results = await Promise.all([posting.postInvoice(books.companyId, a.id), posting.postInvoice(books.companyId, b.id), posting.postInvoice(books.companyId, c.id)])
      expect(results.map((r) => r.number).sort()).toEqual(['F2026-0001', 'F2026-0002', 'F2026-0003'])
      expect((await prisma.invoiceNumberCounter.findFirstOrThrow({ where: { companyId: books.companyId } })).lastValue).toBe(3)
    })

    it('gives no number when the posting fails or rolls back', async () => {
      // Refused: dated in the closed 2025 fiscal year
      const refused = await draft('2025-11-03')
      await expect(posting.postInvoice(books.companyId, refused.id)).rejects.toBeInstanceOf(errors.ConflictError)
      expect(await numberOf(refused.id)).toBeNull()
      // Rolled back after the number was given in the transaction
      const ok = await draft()
      await expect(
        prisma.$transaction(async (tx) => {
          expect(await series.assignSeriesNumber(tx, books.companyId, { id: ok.id, typeCode: '380', issueDay: '2026-03-02' })).toBe('F2026-0001')
          throw new Error('rollback')
        }),
      ).rejects.toThrow('rollback')
      expect((await posting.postInvoice(books.companyId, ok.id)).number).toBe('F2026-0001')
    })

    it('leaves no gap when a draft is deleted', async () => {
      const first = await draft()
      const second = await draft()
      await invoices.deleteInvoice(books.companyId, first.id)
      expect((await posting.postInvoice(books.companyId, second.id)).number).toBe('F2026-0001')
    })

    it('keeps the number when unposted and posted again, and refuses to delete a numbered invoice', async () => {
      const invoice = await draft()
      await posting.postInvoice(books.companyId, invoice.id)
      await posting.unpostInvoice(books.companyId, invoice.id)
      expect(await numberOf(invoice.id)).toBe('F2026-0001')
      await expect(invoices.deleteInvoice(books.companyId, invoice.id)).rejects.toThrow(/avoir/)
      await expect(
        invoices.updateInvoice(books.companyId, invoice.id, { tiersId: books.customerId, issueDate: '2026-03-20', typeCode: '380', lines: [line('Vente')] }),
      ).rejects.toThrow(/sa date fixe sa place/)
      const edited = await invoices.updateInvoice(books.companyId, invoice.id, { tiersId: books.customerId, issueDate: '2026-03-02', typeCode: '380', lines: [line('Vente corrigée', 12_000)] })
      expect(edited).toMatchObject({ number: 'F2026-0001', totalExclTaxCents: 12_000 })
      expect((await posting.postInvoice(books.companyId, invoice.id)).number).toBe('F2026-0001')
      expect((await prisma.invoiceNumberCounter.findFirstOrThrow({ where: { companyId: books.companyId } })).lastValue).toBe(1)
    })

    it('refuses to number an invoice dated before one already numbered (chronological sequence)', async () => {
      const later = await draft('2026-03-10')
      await posting.postInvoice(books.companyId, later.id)
      const earlier = await draft('2026-03-01')
      await expect(posting.postInvoice(books.companyId, earlier.id)).rejects.toThrow(/F2026-0001 du 10\/03\/2026 est déjà numérotée/)
      expect(await numberOf(earlier.id)).toBeNull()
      const sameDay = await draft('2026-03-10')
      expect((await posting.postInvoice(books.companyId, sameDay.id)).number).toBe('F2026-0002')
    })

    it('refuses a typed number while the numbering is automatic', async () => {
      await expect(draft('2026-03-02', { number: 'F2026-0100' })).rejects.toThrow(/numérotation automatique est active/)
    })
  })

  describe('periods and series', () => {
    it('restarts each calendar year', async () => {
      await prisma.fiscalYear.create({ data: { companyId: books.companyId, year: 2027, startDate: new Date('2027-01-01T00:00:00Z'), endDate: new Date('2027-12-31T00:00:00Z') } })
      for (const [code, label] of [['411000', 'Clients'], ['445710', 'TVA collectée'], ['707000', 'Ventes de marchandises']]) {
        const fy = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: books.companyId, year: 2027 } })
        await prisma.account.create({ data: { companyId: books.companyId, fiscalYearId: fy.id, code, label } })
      }
      const a = await draft('2026-12-30')
      const b = await draft('2027-01-04')
      expect((await posting.postInvoice(books.companyId, a.id)).number).toBe('F2026-0001')
      expect((await posting.postInvoice(books.companyId, b.id)).number).toBe('F2027-0001')
    })

    it('numbers credit notes in their own series when configured, else in the invoice series', async () => {
      const note = await draft('2026-03-02', { typeCode: '381' })
      expect((await posting.postInvoice(books.companyId, note.id)).number).toBe('F2026-0001')
      await configure({ creditNotes: 'OWN_SERIES', creditNotePrefix: 'A' })
      const own = await draft('2026-03-03', { typeCode: '381' })
      const invoice = await draft('2026-03-03')
      expect((await posting.postInvoice(books.companyId, own.id)).number).toBe('A2026-0001')
      expect((await posting.postInvoice(books.companyId, invoice.id)).number).toBe('F2026-0002')
    })

    it('starts after the highest existing number of the same format, which keeps its number', async () => {
      const old = await invoices.createInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, number: 'F2026-0041', numbering: 'recorded', issueDate: '2026-02-01', typeCode: '380', lines: [line('Ancienne')] })
      expect(old).toMatchObject({ number: 'F2026-0041', origin: 'RECORDED' })
      await invoices.createInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, number: 'OLD-0999', numbering: 'recorded', issueDate: '2026-02-01', typeCode: '380', lines: [line('Autre format')] })
      const next = await draft()
      expect(next.provisionalNumber).toBe('F2026-0042')
      expect((await posting.postInvoice(books.companyId, next.id)).number).toBe('F2026-0042')
      expect(await numberOf(old.id)).toBe('F2026-0041')
    })

    it('resumes the series at a starting number, only upward, never onto a number already given', async () => {
      // Before Kledg's first number of the period: the sequence of another tool goes on, and can be set again
      expect((await configure({}, { invoice: 120 })).next.invoice).toBe('F2026-0120')
      const view = await configure({}, { invoice: 138 })
      expect(view.next.invoice).toBe('F2026-0138')
      const invoice = await draft('2026-06-15')
      expect((await posting.postInvoice(books.companyId, invoice.id)).number).toBe('F2026-0138')
      await expect(configure({}, { invoice: 100 })).rejects.toThrow(/F2026-0138 est déjà attribué/)
      await expect(configure({}, { invoice: 138 })).rejects.toBeInstanceOf(errors.ConflictError)
      // R3 QUAL-10: once Kledg numbered an invoice of the period, raising would leave 139 to 199 never
      // issued: refused (CGI ann. II art. 242 nonies A, I, 7°: "séquence chronologique et continue")
      await expect(configure({}, { invoice: 200 })).rejects.toThrow(/déjà attribué le numéro F2026-0138/)
      expect((await configure({})).next.invoice).toBe('F2026-0139')
    })

    it('continues right after the numbers already recorded in the period, never leaving a hole', async () => {
      await invoices.createInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, number: 'F2026-0041', numbering: 'recorded', issueDate: '2026-02-01', typeCode: '380', lines: [line('Ancienne')] })
      await expect(configure({}, { invoice: 50 })).rejects.toThrow(/le prochain numéro est F2026-0042/)
      expect((await configure({}, { invoice: 42 })).next.invoice).toBe('F2026-0042')
    })

    it('keeps an invoice already issued out of the running series: its number is typed and never shifts the sequence', async () => {
      const first = await draft()
      await posting.postInvoice(books.companyId, first.id)
      // Above the last number given: Kledg would give it later, refused
      await expect(
        invoices.createInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, number: 'F2026-0005', numbering: 'recorded', issueDate: '2026-01-10', typeCode: '380', lines: [line('Émise')] }),
      ).rejects.toThrow(/série automatique de Kledg/)
      // A number already given: a duplicate
      await expect(
        invoices.createInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, number: 'F2026-0001', numbering: 'recorded', issueDate: '2026-01-10', typeCode: '380', lines: [line('Émise')] }),
      ).rejects.toBeInstanceOf(errors.ConflictError)
      // Another numbering, in the past: kept as typed, the sequence unchanged
      const recorded = await invoices.createInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, number: 'EXT-2025-77', numbering: 'recorded', issueDate: '2026-01-10', typeCode: '380', lines: [line('Émise')] })
      expect((await posting.postInvoice(books.companyId, recorded.id)).number).toBe('EXT-2025-77')
      const second = await draft('2026-03-05')
      expect((await posting.postInvoice(books.companyId, second.id)).number).toBe('F2026-0002')
      // A recorded invoice keeps the rules of closed fiscal years
      const closed = await invoices.createInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, number: 'EXT-2025-12', numbering: 'recorded', issueDate: '2025-06-10', typeCode: '380', lines: [line('Émise')] })
      await expect(posting.postInvoice(books.companyId, closed.id)).rejects.toBeInstanceOf(errors.ConflictError)
    })

    it('keeps the management fee series apart from the company numbering', async () => {
      const fee = await invoices.createInvoice(
        books.companyId,
        { direction: 'SALE', tiersId: books.customerId, number: 'FG-2026-001', issueDate: '2026-03-31', typeCode: '380', lines: [line('Frais de gestion')] },
        { origin: 'MANAGEMENT_FEES', source: 'management-fees' },
      )
      expect(fee).toMatchObject({ number: 'FG-2026-001', origin: 'MANAGEMENT_FEES' })
      const invoice = await draft('2026-04-01')
      expect((await posting.postInvoice(books.companyId, invoice.id)).number).toBe('F2026-0001')
      expect((await posting.postInvoice(books.companyId, fee.id)).number).toBe('FG-2026-001')
    })
  })

  describe('typed numbers (the company numbers elsewhere)', () => {
    it('requires a number, unique among the sales invoices of the company', async () => {
      await configure({ mode: 'MANUAL' })
      await expect(draft()).rejects.toThrow(/numéro est requis/)
      const a = await draft('2026-03-02', { number: 'V-1' })
      expect(a).toMatchObject({ number: 'V-1', origin: 'MANUAL' })
      await expect(draft('2026-03-02', { number: 'V-1' })).rejects.toThrow(/V-1 existe déjà/)
      const view = await settingsSvc.getInvoiceNumbering(books.companyId, NOW)
      expect(view.next).toEqual({ invoice: null, creditNote: null })
    })

    it('goes through issueInvoice without Qonto: a company without a Qonto connection numbers in Kledg', async () => {
      const invoice = await issuing.issueInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, issueDate: '2026-03-02', typeCode: '380', lines: [line('Vente')] })
      expect(invoice).toMatchObject({ origin: 'AUTO', number: null })
      const purchase = await issuing.issueInvoice(books.companyId, { direction: 'PURCHASE', tiersId: books.supplierId, number: 'D-77', issueDate: '2026-03-02', typeCode: '380', lines: [line('Achat')] })
      expect(purchase).toMatchObject({ origin: 'MANUAL', number: 'D-77' })
    })
  })

  describe('default numbering of existing and new companies', () => {
    it('sets companies that existed before the migration to typed numbers, invited to configure the automatic numbering', async () => {
      const { readFileSync } = await import('node:fs')
      const path = await import('node:path')
      const sql = readFileSync(path.join(process.cwd(), 'prisma/migrations/20261115090000_invoice_numbering/migration.sql'), 'utf8')
      const update = /^UPDATE "companies" SET "invoiceNumbering".*;$/m.exec(sql)?.[0]
      expect(update).toBeDefined()
      // books.companyId was created with no configuration, like a row before the migration
      await prisma.$executeRawUnsafe(update!)
      const view = await settingsSvc.getInvoiceNumbering(books.companyId, NOW)
      expect(view.settings.mode).toBe('MANUAL')
      expect(view.suggestAutomatic).toBe(true)
      expect(view.next).toEqual({ invoice: null, creditNote: null })
      await expect(draft()).rejects.toThrow(/numéro est requis/)
      // Once the numbering is saved, the invitation goes
      expect((await configure({})).suggestAutomatic).toBe(false)
      expect(await draft()).toMatchObject({ origin: 'AUTO', number: null })
    })

    it('numbers the sales invoices of a company created after the migration automatically (F{YYYY}-{SEQ:4})', async () => {
      const { createCompany } = await import('@/lib/companies/create-company.service')
      const { CreateCompanySchema } = await import('@/lib/companies/company-wizard')
      const created = await createCompany(
        CreateCompanySchema.parse({
          name: 'Nouvelle société',
          siren: '732829320',
          firstFiscalYear: { startDate: '2026-01-01', endDate: '2026-12-31', isFirst: false },
          vatRegime: 'normal',
          corporateTaxRegime: 'normal',
        }),
      )
      const view = await settingsSvc.getInvoiceNumbering(created.id, NOW)
      expect(view.settings).toEqual(DEFAULT_NUMBERING)
      expect(view.suggestAutomatic).toBe(false)
      expect(view.next.invoice).toBe('F2026-0001')
    })
  })

  describe('configuration', () => {
    it('saves the configuration with an audit log entry, and isolates companies', async () => {
      const other = await seedBooks(prisma, svc, { siren: '900000302', slug: 'numerotation-beta' })
      const view = await configure({ prefix: 'FA', year: 'YY', month: true, separator: '/', padding: 3 })
      expect(view.patterns.invoice).toBe('FA{YY}/{MM}/{SEQ:3}')
      expect(view.next.invoice).toBe('FA26/06/001')
      const log = await prisma.auditLog.findFirstOrThrow({ where: { companyId: books.companyId, action: 'UPDATE_INVOICE_NUMBERING' }, select: { metadata: true } })
      expect(log.metadata).toMatchObject({ before: { prefix: 'F' }, after: { prefix: 'FA', year: 'YY' } })

      const mine = await draft('2026-06-01')
      expect((await posting.postInvoice(books.companyId, mine.id)).number).toBe('FA26/06/001')
      const theirs = await invoices.createInvoice(other.companyId, { direction: 'SALE', tiersId: other.customerId, issueDate: '2026-06-01', typeCode: '380', lines: [line('Vente')] })
      expect((await posting.postInvoice(other.companyId, theirs.id)).number).toBe('F2026-0001')
      expect(await prisma.invoiceNumberCounter.count({ where: { companyId: other.companyId } })).toBe(1)
    })

    it('refuses a fiscal year reset where no fiscal year contains the invoice', async () => {
      await configure({ reset: 'FISCAL_YEAR' })
      const invoice = await draft('2026-03-02')
      expect((await posting.postInvoice(books.companyId, invoice.id)).number).toBe('F2026-0001')
      await expect(series.assignSeriesNumber(prisma as never, books.companyId, { id: invoice.id, typeCode: '380', issueDay: '2031-01-01' })).rejects.toThrow(/Aucun exercice/)
    })
  })
})
