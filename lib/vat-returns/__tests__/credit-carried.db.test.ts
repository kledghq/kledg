/**
 * The credit carried forward on CA3 line 22 (notice 3310-CA3-SD: line 22
 * repeats line 27 of the previous return) against PostgreSQL (#122):
 * - in January, before the previous fiscal year is closed: the December
 *   credit is in the previous year's books, not yet in opening entries;
 * - after a settlement moved out of a closed period: the settlement of
 *   September dated on 1 October (first open day, BOI-BIC-DECLA-30-10-20-40
 *   § 140) still carries its credit into the October return;
 * - a refund requested on form 3519 (CA3 line 26, #173): booked on 44583,
 *   only line 27 carried to line 22 of the next return.
 * Skipped without the test database server.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('vat_credit_carried')
})

vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(async () => {}) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { BOOK_ACCOUNTS, seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'
import type { VatReturnView } from '../load-vat-return.service'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
let prisma: Prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let load: typeof import('../load-vat-return.service')
let settle: typeof import('../prepare-vat-settlement.service')
let filing: typeof import('../record-vat-filing.service')

const EXTRA_ACCOUNTS: Array<[string, string]> = [
  ['445510', 'TVA à décaisser'],
  ['445670', 'Crédit de TVA à reporter'],
]

const lineOf = (view: VatReturnView, code: string) => view.computation?.lines.find((l) => l.code === code)

async function company(slug: string, siren: string): Promise<Books> {
  const books = await seedBooks(prisma, svc, { siren, slug })
  await prisma.company.update({
    where: { id: books.companyId },
    data: { legalType: 'SAS', vatRegime: 'normal', deadlineSettings: { vatFilingDay: 21, vatCa3Frequency: 'monthly' } },
  })
  for (const [code, label] of EXTRA_ACCOUNTS) {
    books.accounts[code] = (await prisma.account.create({ data: { companyId: books.companyId, fiscalYearId: books.fiscalYearId, code, label } })).id
  }
  return books
}

async function book(books: Books, accounts: Record<string, string>, journal: string, date: string, lines: Array<[string, number, number]>) {
  const entry = await svc.createEntry({
    companyId: books.companyId,
    journalId: books.journals[journal],
    date,
    description: `Écriture du ${date}`,
    status: 'validated',
    lines: lines.map(([code, debit, credit]) => ({ accountId: accounts[code], debit: debit.toFixed(2), credit: credit.toFixed(2) })),
  })
  return entry.id
}

describe.skipIf(!available)('VAT credit carried forward (PostgreSQL)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('vat_credit_carried')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    load = await import('../load-vat-return.service')
    settle = await import('../prepare-vat-settlement.service')
    filing = await import('../record-vat-filing.service')
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('carries the December credit into the January return before the year is closed', async () => {
    const books = await company('credit-new-year', '950000201')
    await book(books, books.accounts, 'AC', '2026-12-10', [['6064', 1_000, 0], ['445660', 200, 0], ['401000', 0, 1_200]])
    const december = await settle.prepareVatSettlement(books.companyId, '2026-12', { now: new Date('2027-01-10T09:00:00Z') })
    expect(december.lines.find((l) => l.code === '445670')).toMatchObject({ debitCents: 20_000 })
    expect((await svc.validateEntries(books.companyId, [december.entryId as string])).errors).toEqual([])

    // 2027 is open, 2026 is not closed: no opening entries yet
    const fy2027 = await prisma.fiscalYear.create({
      data: { companyId: books.companyId, year: 2027, startDate: new Date('2027-01-01T00:00:00Z'), endDate: new Date('2027-12-31T00:00:00Z') },
    })
    const accounts2027: Record<string, string> = {}
    for (const [code, label] of [...BOOK_ACCOUNTS, ...EXTRA_ACCOUNTS]) {
      accounts2027[code] = (await prisma.account.create({ data: { companyId: books.companyId, fiscalYearId: fy2027.id, code, label } })).id
    }
    await book(books, accounts2027, 'VE', '2027-01-15', [['411000', 120, 0], ['706000', 0, 100], ['445710', 0, 20]])

    const { view } = await load.buildVatReturn(books.companyId, '2027-01', new Date('2027-02-05T09:00:00Z'))
    expect(lineOf(view, '22')).toMatchObject({ amountCents: 20_000 })
    expect(view.computation?.result).toMatchObject({ kind: 'credit', creditEuros: 180 })
  })

  it('carries the credit of a settlement moved to the first open day of the next period', async () => {
    const books = await company('credit-moved', '950000202')
    await book(books, books.accounts, 'AC', '2026-09-10', [['6064', 500, 0], ['445660', 100, 0], ['401000', 0, 600]])
    const { lockPeriod } = await import('@/lib/accounting/period-lock/lock-period.service')
    await lockPeriod(books.companyId, books.fiscalYearId, '2026-09-30', 'u-vat')
    const september = await settle.prepareVatSettlement(books.companyId, '2026-09', { now: new Date('2026-10-10T09:00:00Z') })
    const entry = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: september.entryId as string } })
    expect(entry.date.toISOString().slice(0, 10)).toBe('2026-10-01')
    expect((await svc.validateEntries(books.companyId, [entry.id])).errors).toEqual([])

    await book(books, books.accounts, 'VE', '2026-10-15', [['411000', 120, 0], ['706000', 0, 100], ['445710', 0, 20]])
    const { view } = await load.buildVatReturn(books.companyId, '2026-10', new Date('2026-11-05T09:00:00Z'))
    expect(lineOf(view, '22')).toMatchObject({ amountCents: 10_000 })
    expect(view.computation?.result).toMatchObject({ kind: 'credit', creditEuros: 80 })
    expect(view.checks.find((c) => c.id === 'balances')?.severity).toBe('ok')
  })

  it('books a refund requested on form 3519 on 44583 and carries only the rest of the credit (#173)', async () => {
    const books = await company('credit-refund', '950000203')
    // A credit of 1 000 € in September: 5 000 € of purchases, 1 000 € of deductible VAT
    await book(books, books.accounts, 'AC', '2026-09-10', [['6064', 5_000, 0], ['445660', 1_000, 0], ['401000', 0, 6_000]])
    const now = new Date('2026-10-16T09:00:00Z')
    const record = (body: { amountDueCents: number; creditCents: number; refundCents: number }) =>
      filing.recordVatFiling(books.companyId, { period: '2026-09', filedOn: '2026-10-15', ...body }, { now })

    // Line 26 never exceeds line 25, comes only with a credit, in whole euros (notice 3310-NOT-CA3-SD)
    await expect(record({ amountDueCents: 0, creditCents: 0, refundCents: 120_000 })).rejects.toThrow('dépasse le crédit de TVA de la période (ligne 25 : 1 000,00 €)')
    await expect(record({ amountDueCents: 10_000, creditCents: 0, refundCents: 10_000 })).rejects.toThrow('soit un montant à payer, soit un crédit')
    await expect(record({ amountDueCents: 0, creditCents: 20_050, refundCents: 79_950 })).rejects.toThrow('euros entiers')
    // The database refuses a refund with an amount due, whatever the code path
    await expect(
      prisma.vatReturnFiling.create({
        data: { companyId: books.companyId, form: 'CA3', periodKey: '2026-08', periodStart: new Date('2026-08-01T00:00:00Z'), periodEnd: new Date('2026-08-31T00:00:00Z'), filedOn: new Date('2026-09-15T00:00:00Z'), amountDue: 10, creditAmount: 0, refundAmount: 10 },
      }),
    ).rejects.toThrow()

    const saved = await record({ amountDueCents: 0, creditCents: 20_000, refundCents: 80_000 })
    expect(saved).toMatchObject({ creditCents: 20_000, refundCents: 80_000 })
    const { view } = await load.buildVatReturn(books.companyId, '2026-09', now)
    expect(lineOf(view, '25')?.amount).toBe(1_000)
    expect(lineOf(view, '26')).toMatchObject({ amount: 800, status: 'computed' })
    expect(lineOf(view, '27')?.amount).toBe(200)
    expect(view.filing).toMatchObject({ creditCents: 20_000, refundCents: 80_000 })
    // Saving again: the refund already recorded does not shrink the credit it is checked against
    await expect(record({ amountDueCents: 0, creditCents: 0, refundCents: 100_000 })).resolves.toMatchObject({ refundCents: 100_000 })
    await record({ amountDueCents: 0, creditCents: 20_000, refundCents: 80_000 })

    const settlement = await settle.prepareVatSettlement(books.companyId, '2026-09', { now })
    expect(settlement.lines.find((l) => l.code === '445670')).toMatchObject({ debitCents: 20_000, creditCents: 0 })
    expect(settlement.lines.find((l) => l.code === '44583')).toMatchObject({ debitCents: 80_000, creditCents: 0, label: 'Remboursement de taxes sur le chiffre d’affaires demandé' })
    expect((await svc.validateEntries(books.companyId, [settlement.entryId as string])).errors).toEqual([])

    // October: line 22 takes line 27 only; the refund received clears 44583 without a blocking check
    const refundAccount = await prisma.account.findFirstOrThrow({ where: { companyId: books.companyId, fiscalYearId: books.fiscalYearId, code: '44583' }, select: { id: true } })
    const ids = { ...books.accounts, '44583': refundAccount.id }
    await book(books, ids, 'BQ', '2026-10-20', [['512000', 800, 0], ['44583', 0, 800]])
    const { view: october } = await load.buildVatReturn(books.companyId, '2026-10', new Date('2026-11-05T09:00:00Z'))
    expect(lineOf(october, '22')).toMatchObject({ amountCents: 20_000 })
    expect(october.checks.some((c) => c.id === 'credit')).toBe(false)
    expect(october.checks.some((c) => c.id === 'accounts')).toBe(false)
  })

  it('refuses a refund on a CA12: the request is made on the return itself', async () => {
    const books = await company('credit-refund-ca12', '950000204')
    await prisma.company.update({ where: { id: books.companyId }, data: { vatRegime: 'simplified', deadlineSettings: { vatFilingDay: 21 } } })
    await book(books, books.accounts, 'AC', '2026-09-10', [['6064', 5_000, 0], ['445660', 1_000, 0], ['401000', 0, 6_000]])
    const { view } = await load.buildVatReturn(books.companyId, undefined, new Date('2027-04-10T09:00:00Z'))
    expect(view.period?.form).toBe('CA12')
    await expect(
      filing.recordVatFiling(books.companyId, { period: view.period?.id as string, filedOn: '2027-04-10', amountDueCents: 0, creditCents: 0, refundCents: 50_000 }, { now: new Date('2027-04-10T09:00:00Z') }),
    ).rejects.toThrow('ligne 26 de la CA3')
  })
})
