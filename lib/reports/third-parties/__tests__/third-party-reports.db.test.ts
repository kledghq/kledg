/**
 * Aged balance, auxiliary balance, their Excel exports and the payment
 * terms of a company against PostgreSQL (skipped without the server):
 * validated lines only, lettering as of the report day, the opening entry
 * as opening balance, the company's terms capped by Code de commerce
 * art. L441-10 (and by the database check), report days inside the year.
 */

import ExcelJS from 'exceljs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('third_party_reports')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { bookLedger, type Ledger } from '@/lib/lettering/__tests__/helpers/ledger'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let reports: typeof import('../get-third-party-reports.service')
let exports: typeof import('../export-third-party-reports.service')
let terms: typeof import('@/lib/companies/payment-terms.service')
let lettering: typeof import('@/lib/lettering/lettering.service')

describe.skipIf(!available)('third-party reports (PostgreSQL)', () => {
  let ledger: Ledger

  beforeAll(async () => {
    await prepareTestDatabase('third_party_reports')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    reports = await import('../get-third-party-reports.service')
    exports = await import('../export-third-party-reports.service')
    terms = await import('@/lib/companies/payment-terms.service')
    lettering = await import('@/lib/lettering/lettering.service')
  })

  beforeEach(async () => {
    await prepareTestDatabase('third_party_reports')
    ledger = await bookLedger(prisma, svc, { siren: '910000001', slug: 'tiers-alpha' })
    // Opening entry: a receivable brought forward without auxiliary account
    await ledger.entry('AN', '2026-01-01', 'À-nouveaux', [{ code: '411000', debit: '500.00' }, { code: '101300', credit: '500.00' }])
    // Martin: invoice of 10/01 paid on 20/02 (lettered), invoice of 01/03 open
    const sale1 = await ledger.entry('VE', '2026-01-10', 'Facture 1', [{ code: '411000', debit: '1200.00', aux: ['C001', 'Martin SA'] }, { code: '706000', credit: '1200.00' }])
    const pay1 = await ledger.entry('BQ', '2026-02-20', 'Règlement 1', [{ code: '512000', debit: '1200.00' }, { code: '411000', credit: '1200.00', aux: ['C001', 'Martin SA'] }])
    await lettering.letterLines(ledger.companyId, { accountId: ledger.accounts['411000'], lineIds: [sale1.line('411000'), pay1.line('411000')] }, { now: new Date('2026-02-20T12:00:00Z') })
    await ledger.entry('VE', '2026-03-01', 'Facture 2', [{ code: '411000', debit: '300.00', aux: ['C001', 'Martin SA'] }, { code: '706000', credit: '300.00' }])
    // Supplier invoice of 15/02, open
    await ledger.entry('AC', '2026-02-15', 'Fournitures', [{ code: '606100', debit: '80.00' }, { code: '401000', credit: '80.00', aux: ['F007', 'Papeterie'] }])
    // A draft never counts
    await ledger.entry('VE', '2026-03-02', 'Brouillon', [{ code: '411000', debit: '999.00', aux: ['C009', 'Brouillon'] }, { code: '706000', credit: '999.00' }], 'draft')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('builds the aged balance on a day from validated, unlettered lines with the default 30 days', async () => {
    const report = await reports.getAgedBalance(ledger.companyId, { fiscalYearId: ledger.fiscalYearId, asOf: '2026-04-15' })
    expect(report).toMatchObject({ asOf: '2026-04-15', terms: { days: 30, endOfMonth: false }, fiscalYear: { year: 2026 } })
    expect(report.customers.tiers.map((t) => [t.code, t.buckets.totalCents])).toEqual([
      // AN line: 01/01 + 30 = 31/01, 74 days late
      ['411000', 50_000],
      // Facture 2: 01/03 + 30 = 31/03, 15 days late
      ['C001', 30_000],
    ])
    expect(report.customers.tiers[0].buckets.days61to90).toBe(50_000)
    expect(report.customers.tiers[1].buckets.days0to30).toBe(30_000)
    // 15/02 + 30 = 17/03, 29 days late
    expect(report.suppliers.tiers).toMatchObject([{ code: 'F007', label: 'Papeterie', buckets: { days0to30: 8_000, totalCents: 8_000 } }])
  })

  it('counts the lettered invoice as open on a day before its lettering', async () => {
    const report = await reports.getAgedBalance(ledger.companyId, { fiscalYearId: ledger.fiscalYearId, asOf: '2026-02-19' })
    expect(report.customers.tiers.find((t) => t.code === 'C001')?.buckets).toMatchObject({ days0to30: 120_000, totalCents: 120_000 })
  })

  it('uses the payment terms of the company and refuses terms above L441-10', async () => {
    await terms.updatePaymentTerms(ledger.companyId, { days: 45, endOfMonth: true })
    expect(await terms.getPaymentTerms(ledger.companyId)).toEqual({ days: 45, endOfMonth: true })
    const report = await reports.getAgedBalance(ledger.companyId, { fiscalYearId: ledger.fiscalYearId, asOf: '2026-04-15' })
    // 01/03 + 45 days = 15/04, end of month 30/04: not due on 15/04
    expect(report.customers.tiers.find((t) => t.code === 'C001')?.buckets.notDue).toBe(30_000)

    await expect(terms.updatePaymentTerms(ledger.companyId, { days: 61, endOfMonth: false })).rejects.toThrow(/L441-10/)
    await expect(terms.updatePaymentTerms(ledger.companyId, { days: 50, endOfMonth: true })).rejects.toThrow(/45 jours/)
    // The database refuses it too, whatever the code path
    await expect(prisma.company.update({ where: { id: ledger.companyId }, data: { paymentTermsDays: 90 } })).rejects.toThrow()
    expect(await terms.getPaymentTerms(ledger.companyId)).toEqual({ days: 45, endOfMonth: true })
    const audit = await prisma.auditLog.count({ where: { action: 'UPDATE_PAYMENT_TERMS', companyId: ledger.companyId } })
    expect(audit).toBe(1)
  })

  it('refuses a report day outside the fiscal year and a fiscal year of another company', async () => {
    await expect(reports.getAgedBalance(ledger.companyId, { fiscalYearId: ledger.fiscalYearId, asOf: '2027-01-05' })).rejects.toThrow(/hors de l'exercice 2026/)
    const other = await bookLedger(prisma, svc, { siren: '910000002', slug: 'tiers-beta' })
    await expect(reports.getAgedBalance(other.companyId, { fiscalYearId: ledger.fiscalYearId })).rejects.toThrow(/Exercice introuvable/)
    // Without a fiscal year: the one containing the day
    const byDay = await reports.getAgedBalance(ledger.companyId, { asOf: '2026-03-31' })
    expect(byDay.fiscalYear.id).toBe(ledger.fiscalYearId)
  })

  it('builds the auxiliary balance of a period with the opening entry and the unlettered part', async () => {
    const report = await reports.getAuxiliaryBalance(ledger.companyId, { fiscalYearId: ledger.fiscalYearId, startDate: '2026-02-01', endDate: '2026-03-31' })
    expect(report.period).toEqual({ startDate: '2026-02-01', endDate: '2026-03-31' })
    expect(report.customers.tiers.map((t) => [t.code, t.openingCents, t.debitCents, t.creditCents, t.closingCents, t.unletteredCents])).toEqual([
      ['411000', 50_000, 0, 0, 50_000, 50_000],
      ['C001', 120_000, 30_000, 120_000, 30_000, 30_000],
    ])
    expect(report.suppliers.totals).toMatchObject({ creditCents: 8_000, closingCents: -8_000 })
    await expect(reports.getAuxiliaryBalance(ledger.companyId, { fiscalYearId: ledger.fiscalYearId, startDate: '2026-04-01', endDate: '2026-03-01' })).rejects.toThrow(
      /précède/,
    )
  })

  it('exports both reports as Excel workbooks named after the company and the day', async () => {
    const aged = await exports.exportAgedBalanceExcel(ledger.companyId, { fiscalYearId: ledger.fiscalYearId, asOf: '2026-04-15' })
    expect(aged.fileName).toBe('Balance_agee_tiers_alpha_2026-04-15.xlsx')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(new Uint8Array(aged.content as Uint8Array).buffer as ArrayBuffer)
    const clients = workbook.getWorksheet('Clients')!
    expect(clients.getRow(3).values).toEqual([undefined, 'Tiers', 'Libellé', 'Comptes', 'Non échu', '0 à 30 jours', '31 à 60 jours', '61 à 90 jours', 'Plus de 90 jours', 'Total'])
    expect(clients.getRow(clients.rowCount).values).toEqual([undefined, 'TOTAL', '', '', 0, 300, 0, 500, 0, 800])

    const aux = await exports.exportAuxiliaryBalanceExcel(ledger.companyId, { fiscalYearId: ledger.fiscalYearId })
    expect(aux.fileName).toBe('Balance_auxiliaire_tiers_alpha_2026-12-31.xlsx')
  })
})
