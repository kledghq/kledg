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
    expect(outcome).toEqual({ created: 2, matched: 0, updated: 0 })

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
    expect(again).toEqual({ created: 0, matched: 0, updated: 0 })

    // Qonto settles the payment: completed, one day later
    const settled = await storeSyncedTransactions(target, [
      line('t-1', 18, 'debit', '2026-09-02', { providerData: { id: 'uuid-1', status: 'completed' } }),
    ])
    expect(settled).toEqual({ created: 0, matched: 0, updated: 1 })
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

    expect(await storeSyncedTransactions(target, [rent])).toEqual({ created: 0, matched: 1, updated: 0 })
    expect(await prisma.bankTransactionMatch.findMany({ select: { bankAccountId: true, externalTransactionId: true, bankTransactionId: true } })).toEqual([
      { bankAccountId: ids.account, externalTransactionId: 't-rent', bankTransactionId: imported.id },
    ])
    // The match is known on the next run: nothing inserted, nothing matched twice
    expect(await storeSyncedTransactions(target, [rent])).toEqual({ created: 0, matched: 0, updated: 0 })
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
    expect(outcome).toEqual({ created: 2, matched: 1, updated: 0 })
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
    expect(outcome).toEqual({ created: 2, matched: 0, updated: 0 })
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
})
