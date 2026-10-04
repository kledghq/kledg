/**
 * updateEntryDatesFromReconciledTransactions against PostgreSQL: a reconciled
 * draft entry takes the date of its bank transaction, but validated entries
 * (PCG art. 1031-3: a validated entry is never modified), closed fiscal years
 * and dates outside the entry's fiscal year are left alone, and the scope
 * (company, bank account) is respected. Skipped without the test database.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('entry_dates_from_tx')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let updateEntryDatesFromReconciledTransactions: typeof import('../update-entry-dates-from-transactions.service').updateEntryDatesFromReconciledTransactions

const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
let seq = 0

async function company(name: string) {
  seq += 1
  const created = await prisma.company.create({ data: { name, slug: `${name.toLowerCase()}-${seq}`, siren: String(300000000 + seq) } })
  const open = await prisma.fiscalYear.create({ data: { companyId: created.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
  const closed = await prisma.fiscalYear.create({ data: { companyId: created.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
  const bank = await prisma.account.create({ data: { companyId: created.id, fiscalYearId: open.id, code: '512000', label: 'Banque' } })
  const sales = await prisma.account.create({ data: { companyId: created.id, fiscalYearId: open.id, code: '706000', label: 'Ventes' } })
  const bankClosed = await prisma.account.create({ data: { companyId: created.id, fiscalYearId: closed.id, code: '512000', label: 'Banque' } })
  const salesClosed = await prisma.account.create({ data: { companyId: created.id, fiscalYearId: closed.id, code: '706000', label: 'Ventes' } })
  const journal = await prisma.journal.create({ data: { companyId: created.id, code: 'BQ', label: 'Banque' } })
  const connection = await prisma.bankConnection.create({ data: { companyId: created.id, provider: 'QONTO' } })
  const main = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: `main-${seq}`, name: 'Courant' } })
  const savings = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: `sav-${seq}`, name: 'Epargne' } })
  return { id: created.id, open, closed, accounts: { open: [bank.id, sales.id], closed: [bankClosed.id, salesClosed.id] }, journal: journal.id, main: main.id, savings: savings.id }
}

type Company = Awaited<ReturnType<typeof company>>

/** A balanced entry of 100,00 on 512/706, reconciled with a bank transaction dated `txDate`. */
async function reconciled(c: Company, options: { entryDate: string; txDate: string; status?: 'draft' | 'validated'; year?: 'open' | 'closed'; bankAccountId?: string }) {
  seq += 1
  const year = options.year ?? 'open'
  const fiscalYear = c[year]
  const [debitAccount, creditAccount] = c.accounts[year]
  const entryNumber = String(seq)
  const entry = await prisma.accountingEntry.create({
    data: {
      companyId: c.id,
      fiscalYearId: fiscalYear.id,
      journalId: c.journal,
      entryNumber,
      date: day(options.entryDate),
      description: `Encaissement ${seq}`,
      status: 'draft',
    },
  })
  await prisma.entryLine.createMany({
    data: [
      { accountingEntryId: entry.id, accountingEntryNumber: entryNumber, accountId: debitAccount, accountFiscalYearId: fiscalYear.id, debit: 100, credit: 0 },
      { accountingEntryId: entry.id, accountingEntryNumber: entryNumber, accountId: creditAccount, accountFiscalYearId: fiscalYear.id, debit: 0, credit: 100 },
    ],
  })
  if (options.status === 'validated') {
    await prisma.accountingEntry.update({ where: { id: entry.id }, data: { status: 'validated', validatedAt: day(options.entryDate) } })
  }
  await prisma.bankTransaction.create({
    data: {
      bankAccountId: options.bankAccountId ?? c.main,
      externalTransactionId: `tx-${seq}`,
      amount: 100,
      date: day(options.txDate),
      side: 'credit',
      label: `Virement ${seq}`,
      reconciled: true,
      reconciledWith: entry.id,
    },
  })
  return entry.id
}

const dateOf = async (id: string) => (await prisma.accountingEntry.findUniqueOrThrow({ where: { id } })).date.toISOString().slice(0, 10)

describe.skipIf(!available)('updateEntryDatesFromReconciledTransactions', () => {
  beforeAll(async () => {
    await prepareTestDatabase('entry_dates_from_tx')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ updateEntryDatesFromReconciledTransactions } = await import('../update-entry-dates-from-transactions.service'))
  })

  beforeEach(async () => {
    await prepareTestDatabase('entry_dates_from_tx')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('moves reconciled draft entries to the transaction date and counts them', async () => {
    const c = await company('Alpha')
    const moved = await reconciled(c, { entryDate: '2026-03-02', txDate: '2026-02-27' })
    const alreadyAligned = await reconciled(c, { entryDate: '2026-04-10', txDate: '2026-04-10' })

    expect(await updateEntryDatesFromReconciledTransactions({ companyId: c.id })).toEqual({ entriesUpdated: 1 })
    expect(await dateOf(moved)).toBe('2026-02-27')
    expect(await dateOf(alreadyAligned)).toBe('2026-04-10')
    // Idempotent: a second run has nothing left to move
    expect(await updateEntryDatesFromReconciledTransactions({ companyId: c.id })).toEqual({ entriesUpdated: 0 })
  })

  it('never rewrites a validated entry, a closed year or a date outside the fiscal year', async () => {
    const c = await company('Beta')
    // PCG art. 1031-3: a validated entry is definitive
    const validated = await reconciled(c, { entryDate: '2026-03-02', txDate: '2026-02-27', status: 'validated' })
    const inClosedYear = await reconciled(c, { entryDate: '2025-06-02', txDate: '2025-06-01', year: 'closed' })
    await prisma.fiscalYear.update({ where: { id: c.closed.id }, data: { isClosed: true, closedAt: day('2026-02-01') } })
    // The transaction is dated in 2025, before the entry's 2026 fiscal year
    const crossesYear = await reconciled(c, { entryDate: '2026-01-02', txDate: '2025-12-31' })

    expect(await updateEntryDatesFromReconciledTransactions({ companyId: c.id })).toEqual({ entriesUpdated: 0 })
    expect(await dateOf(validated)).toBe('2026-03-02')
    expect(await dateOf(inClosedYear)).toBe('2025-06-02')
    expect(await dateOf(crossesYear)).toBe('2026-01-02')
  })

  it('stays inside the requested company and bank account', async () => {
    const alpha = await company('Gamma')
    const other = await company('Delta')
    const onMain = await reconciled(alpha, { entryDate: '2026-05-05', txDate: '2026-05-04' })
    const onSavings = await reconciled(alpha, { entryDate: '2026-05-05', txDate: '2026-05-03', bankAccountId: alpha.savings })
    const otherCompany = await reconciled(other, { entryDate: '2026-05-05', txDate: '2026-05-01' })

    expect(await updateEntryDatesFromReconciledTransactions({ companyId: alpha.id, bankAccountId: alpha.main })).toEqual({ entriesUpdated: 1 })
    expect(await dateOf(onMain)).toBe('2026-05-04')
    expect(await dateOf(onSavings)).toBe('2026-05-05')
    expect(await dateOf(otherCompany)).toBe('2026-05-05')

    // A bank account of another company is not a way into its entries
    expect(await updateEntryDatesFromReconciledTransactions({ companyId: alpha.id, bankAccountId: other.main })).toEqual({ entriesUpdated: 0 })
    expect(await dateOf(otherCompany)).toBe('2026-05-05')
  })
})
