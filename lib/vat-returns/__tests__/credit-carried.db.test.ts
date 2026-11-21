/**
 * The credit carried forward on CA3 line 22 (notice 3310-CA3-SD: line 22
 * repeats line 27 of the previous return) against PostgreSQL (#122):
 * - in January, before the previous fiscal year is closed: the December
 *   credit is in the previous year's books, not yet in opening entries;
 * - after a settlement moved out of a closed period: the settlement of
 *   September dated on 1 October (first open day, BOI-BIC-DECLA-30-10-20-40
 *   § 140) still carries its credit into the October return.
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
})
