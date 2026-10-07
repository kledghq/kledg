/**
 * storeSyncedTransactions (lib/banking/store-synced-transactions.service.ts)
 * against PostgreSQL, called directly with provider lines:
 * - amounts are stored to the cent from the provider decimals, with their side;
 * - a line is inserted once per account and external id, even when the
 *   provider repeats it or the sync runs again;
 * - a stored line whose status or date changed is updated, not duplicated;
 * - a line already held from a statement file, or by another account of the
 *   company with the same IBAN, is recorded as a match instead of inserted;
 *   declined lines and lines of another company never match.
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('cov_bank_store_synced')
})

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { ProviderTransaction } from '@/lib/banking/providers/types'
import type { SyncTarget } from '@/lib/banking/store-synced-transactions.service'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
let prisma: Prisma
let storeSyncedTransactions: typeof import('@/lib/banking/store-synced-transactions.service').storeSyncedTransactions

const IBAN = 'FR7616958000016543210987654'
let target: SyncTarget
const ids = {} as Record<string, string>

function line(id: string, amount: number, side: 'debit' | 'credit', day: string, over: Partial<ProviderTransaction> = {}): ProviderTransaction {
  return {
    externalId: id,
    accountExternalId: IBAN,
    amount,
    side,
    date: new Date(`${day}T00:00:00Z`),
    valueDate: day,
    state: 'booked',
    status: 'completed',
    label: `Ligne ${id}`,
    ...over,
  }
}

async function seed() {
  const company = await prisma.company.create({ data: { name: 'Atelier Lumen', slug: 'atelier-lumen', siren: '111111111' } })
  const other = await prisma.company.create({ data: { name: 'Bureau Beta', slug: 'bureau-beta', siren: '222222222' } })
  const qonto = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'QONTO' } })
  const account = await prisma.bankAccount.create({
    data: { bankConnectionId: qonto.id, externalAccountId: IBAN, iban: IBAN, name: 'Compte Qonto' },
  })
  // The same IBAN fed by statement files on a manual account (stored with spaces)
  const manual = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'MANUAL' } })
  const manualAccount = await prisma.bankAccount.create({
    data: { bankConnectionId: manual.id, externalAccountId: 'manual:1', iban: 'FR76 1695 8000 0165 4321 0987 654', name: 'Compte manuel' },
  })
  // Another company holding the same IBAN: never a source of matches
  const otherConnection = await prisma.bankConnection.create({ data: { companyId: other.id, provider: 'MANUAL' } })
  const otherAccount = await prisma.bankAccount.create({
    data: { bankConnectionId: otherConnection.id, externalAccountId: 'manual:2', iban: IBAN, name: 'Autre société' },
  })
  target = { id: account.id, companyId: company.id, bankConnectionId: qonto.id, iban: IBAN }
  Object.assign(ids, { account: account.id, manualAccount: manualAccount.id, otherAccount: otherAccount.id })
}

const storedRows = () =>
  prisma.bankTransaction.findMany({
    where: { bankAccountId: ids.account },
    orderBy: { externalTransactionId: 'asc' },
    select: { externalTransactionId: true, amount: true, side: true, date: true, status: true, label: true, vatRate: true, vatAmount: true, imported: true },
  })

describe.skipIf(!available)('storeSyncedTransactions', () => {
  beforeAll(async () => {
    await prepareTestDatabase('cov_bank_store_synced')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ storeSyncedTransactions } = await import('@/lib/banking/store-synced-transactions.service'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('cov_bank_store_synced')
    await seed()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('stores each line once, to the cent and with its side', async () => {
    const outcome = await storeSyncedTransactions(target, [
      line('t-1', 42.1, 'debit', '2026-09-01', { vatRate: 5.5, vatAmount: 2.19 }),
      // A float sum the bank feed may send: rounded to 0.30
      line('t-2', 0.1 + 0.2, 'credit', '2026-09-02', { label: '' }),
      // The provider repeats a line in the same answer
      line('t-1', 42.1, 'debit', '2026-09-01'),
    ])
    expect(outcome).toEqual({ created: 2, matched: 0, updated: 0, entriesRedated: 0 })

    const rows = await storedRows()
    expect(rows.map((r) => ({ id: r.externalTransactionId, amount: r.amount.toFixed(2), side: r.side, label: r.label, imported: r.imported }))).toEqual([
      { id: 't-1', amount: '42.10', side: 'debit', label: 'Ligne t-1', imported: true },
      { id: 't-2', amount: '0.30', side: 'credit', label: null, imported: true },
    ])
    expect(rows[0].vatRate?.toFixed(2)).toBe('5.50')
    expect(rows[0].vatAmount?.toFixed(2)).toBe('2.19')
    expect(rows[0].date.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('creates nothing on a second run and updates a line whose status and date changed', async () => {
    await storeSyncedTransactions(target, [line('t-1', 18, 'debit', '2026-09-01', { status: 'pending', state: 'pending' })])

    const again = await storeSyncedTransactions(target, [line('t-1', 18, 'debit', '2026-09-01', { status: 'pending', state: 'pending' })])
    expect(again).toEqual({ created: 0, matched: 0, updated: 0, entriesRedated: 0 })

    // Qonto settles the payment: completed, one day later
    const settled = await storeSyncedTransactions(target, [
      line('t-1', 18, 'debit', '2026-09-02', { providerData: { id: 'uuid-1', status: 'completed' } }),
    ])
    expect(settled).toEqual({ created: 0, matched: 0, updated: 1, entriesRedated: 0 })
    const [row] = await storedRows()
    expect(row).toMatchObject({ externalTransactionId: 't-1', status: 'completed' })
    expect(row.date.toISOString()).toBe('2026-09-02T00:00:00.000Z')
    expect(await prisma.bankTransaction.count({ where: { bankAccountId: ids.account } })).toBe(1)
  })

  it('records a line already imported from a statement file as a match, once', async () => {
    const imported = await prisma.bankTransaction.create({
      data: {
        bankAccountId: ids.account,
        externalTransactionId: 'import:releve-septembre:1',
        amount: '1200.00',
        side: 'debit',
        date: new Date('2026-09-03T00:00:00Z'),
        label: 'LOYER SEPTEMBRE',
      },
    })
    const rent = line('t-rent', 1200, 'debit', '2026-09-03')

    expect(await storeSyncedTransactions(target, [rent])).toEqual({ created: 0, matched: 1, updated: 0, entriesRedated: 0 })
    expect(await prisma.bankTransactionMatch.findMany({ select: { bankAccountId: true, externalTransactionId: true, bankTransactionId: true } })).toEqual([
      { bankAccountId: ids.account, externalTransactionId: 't-rent', bankTransactionId: imported.id },
    ])
    // The match is known on the next run: nothing inserted, nothing matched twice
    expect(await storeSyncedTransactions(target, [rent])).toEqual({ created: 0, matched: 0, updated: 0, entriesRedated: 0 })
    expect((await storedRows()).map((r) => r.externalTransactionId)).toEqual(['import:releve-septembre:1'])
  })

  it('matches lines of another account of the company with the same IBAN, never those of another company', async () => {
    const manualLine = await prisma.bankTransaction.create({
      data: { bankAccountId: ids.manualAccount, externalTransactionId: 'import:m:1', amount: '35.00', side: 'credit', date: new Date('2026-09-05T00:00:00Z') },
    })
    await prisma.bankTransaction.create({
      data: { bankAccountId: ids.otherAccount, externalTransactionId: 'import:o:1', amount: '77.00', side: 'debit', date: new Date('2026-09-05T00:00:00Z') },
    })

    const outcome = await storeSyncedTransactions(target, [
      line('t-credit', 35, 'credit', '2026-09-05'),
      // Same amount and day as the other company's line: inserted
      line('t-other', 77, 'debit', '2026-09-05'),
      // Same amount and day but the other side: not the same operation
      line('t-side', 35, 'debit', '2026-09-05'),
    ])
    expect(outcome).toEqual({ created: 2, matched: 1, updated: 0, entriesRedated: 0 })
    const match = await prisma.bankTransactionMatch.findUniqueOrThrow({
      where: { bankAccountId_externalTransactionId: { bankAccountId: ids.account, externalTransactionId: 't-credit' } },
    })
    expect(match.bankTransactionId).toBe(manualLine.id)
    expect((await storedRows()).map((r) => r.externalTransactionId)).toEqual(['t-other', 't-side'])
  })

  it('never matches a declined line, nor a line this provider stored itself', async () => {
    await prisma.bankTransaction.create({
      data: { bankAccountId: ids.account, externalTransactionId: 'import:f:1', amount: '50.00', side: 'credit', date: new Date('2026-09-07T00:00:00Z') },
    })
    // Two identical card payments of the same day, the first one stored by an earlier run
    await storeSyncedTransactions(target, [line('coffee-1', 3.5, 'debit', '2026-09-08')])

    const outcome = await storeSyncedTransactions(target, [
      line('t-declined', 50, 'credit', '2026-09-07', { state: 'rejected', status: 'declined' }),
      line('coffee-2', 3.5, 'debit', '2026-09-08'),
    ])
    expect(outcome).toEqual({ created: 2, matched: 0, updated: 0, entriesRedated: 0 })
    const rows = await storedRows()
    expect(rows.map((r) => [r.externalTransactionId, r.amount.toFixed(2), r.status])).toEqual([
      ['coffee-1', '3.50', 'completed'],
      ['coffee-2', '3.50', 'completed'],
      ['import:f:1', '50.00', null],
      ['t-declined', '50.00', 'declined'],
    ])
  })

  it('queues two concurrent runs of the same lines: each line is inserted once', async () => {
    const lines = [line('c-1', 10, 'debit', '2026-09-10'), line('c-2', 20, 'credit', '2026-09-10')]
    const [first, second] = await Promise.all([storeSyncedTransactions(target, lines), storeSyncedTransactions(target, lines)])
    expect(first.created + second.created).toBe(2)
    expect(await prisma.bankTransaction.count({ where: { bankAccountId: ids.account } })).toBe(2)
  })

  describe('reconciled draft entries follow a moved transaction (KLEDG-R3-QUAL-05)', () => {
    /** A reconciled entry of 18,00 on 512/401 dated `entryDay`, linked to the stored line `externalId`. */
    async function reconciledEntry(externalId: string, entryDay: string, status: 'draft' | 'validated' = 'draft') {
      const fy =
        (await prisma.fiscalYear.findFirst({ where: { companyId: target.companyId, year: 2026 } })) ??
        (await prisma.fiscalYear.create({ data: { companyId: target.companyId, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') } }))
      const journal = (await prisma.journal.findFirst({ where: { companyId: target.companyId, code: 'BQ' } })) ?? (await prisma.journal.create({ data: { companyId: target.companyId, code: 'BQ', label: 'Banque' } }))
      const account = async (code: string) =>
        (await prisma.account.findFirst({ where: { fiscalYearId: fy.id, code } })) ?? (await prisma.account.create({ data: { companyId: target.companyId, fiscalYearId: fy.id, code, label: code } }))
      const [bank, supplier] = [await account('512000'), await account('401000')]
      const entry = await prisma.accountingEntry.create({
        data: { companyId: target.companyId, fiscalYearId: fy.id, journalId: journal.id, entryNumber: `BR-${externalId}`, date: new Date(`${entryDay}T00:00:00Z`), description: externalId, status: 'draft' },
      })
      await prisma.entryLine.createMany({
        data: [
          { accountingEntryId: entry.id, accountingEntryNumber: entry.entryNumber, accountId: supplier.id, accountFiscalYearId: fy.id, debit: 18, credit: 0 },
          { accountingEntryId: entry.id, accountingEntryNumber: entry.entryNumber, accountId: bank.id, accountFiscalYearId: fy.id, debit: 0, credit: 18 },
        ],
      })
      if (status === 'validated') await prisma.accountingEntry.update({ where: { id: entry.id }, data: { status: 'validated', entryNumber: externalId, validatedAt: new Date() } })
      await prisma.bankTransaction.updateMany({ where: { bankAccountId: ids.account, externalTransactionId: externalId }, data: { reconciled: true, reconciledWith: entry.id } })
      return entry.id
    }
    const dayOf = async (id: string) => (await prisma.accountingEntry.findUniqueOrThrow({ where: { id } })).date.toISOString().slice(0, 10)

    it('moves only drafts still on the old date, and nothing when no date changed', async () => {
      await storeSyncedTransactions(target, [line('m-1', 18, 'debit', '2026-09-01'), line('m-2', 18, 'debit', '2026-09-01'), line('m-3', 18, 'debit', '2026-09-01')])
      const follows = await reconciledEntry('m-1', '2026-09-01')
      // Dated by the user on the invoice day in the reconciliation dialog
      const chosen = await reconciledEntry('m-2', '2026-08-28')
      const validated = await reconciledEntry('m-3', '2026-09-01', 'validated')

      // A sync that changes no date updates no entry
      expect(await storeSyncedTransactions(target, [line('m-1', 18, 'debit', '2026-09-01'), line('m-2', 18, 'debit', '2026-09-01')])).toEqual({ created: 0, matched: 0, updated: 0, entriesRedated: 0 })

      const moved = await storeSyncedTransactions(target, [line('m-1', 18, 'debit', '2026-09-03'), line('m-2', 18, 'debit', '2026-09-03'), line('m-3', 18, 'debit', '2026-09-03')])
      expect(moved).toEqual({ created: 0, matched: 0, updated: 3, entriesRedated: 1 })
      expect([await dayOf(follows), await dayOf(chosen), await dayOf(validated)]).toEqual(['2026-09-03', '2026-08-28', '2026-09-01'])
    })
  })
})
