/**
 * Reconciling a transaction against PostgreSQL writes its bank line to the
 * 512 account of the transaction's own bank account (BankAccount.
 * ledgerAccountCode, lib/banking/ledger-account.ts), never to the company
 * default when the bank account has a mapping (issue #28: a company with
 * 5121 and 5122 saw every reconciliation land on the same account). The
 * dialog context shows that same account. Skipped when the test database
 * server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('reconciliation_bank_ledger')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let service: typeof import('@/lib/reconciliation/service')
let context: typeof import('@/lib/reconciliation/context')

const ids = {} as Record<string, string>

async function seed() {
  const company = await prisma.company.create({
    data: { name: 'Foncière Lumen', slug: 'fonciere-lumen', siren: '222222222', defaultBankAccountCode: '512100' },
  })
  const fy = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') },
  })
  const account = (code: string, label: string) => prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label } })
  await account('512', 'Banques')
  await account('512100', 'Banque principale')
  await account('512200', 'Banque Qonto')
  const supplies = await account('606100', 'Fournitures')
  const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'BQ', label: 'Banque' } })
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'MANUAL' } })
  const mapped = await prisma.bankAccount.create({
    data: { bankConnectionId: connection.id, externalAccountId: 'manual:qonto', name: 'Compte Qonto', ledgerAccountCode: '512200' },
  })
  const unmapped = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: 'manual:main', name: 'Compte principal' } })
  const transaction = (bankAccountId: string, externalTransactionId: string) =>
    prisma.bankTransaction.create({
      data: { bankAccountId, externalTransactionId, amount: '-12.34', date: new Date('2026-03-06T00:00:00Z'), side: 'debit', label: 'Papeterie' },
    })
  Object.assign(ids, {
    company: company.id,
    journal: journal.id,
    supplies: supplies.id,
    mappedTransaction: (await transaction(mapped.id, 'tx-qonto')).id,
    unmappedTransaction: (await transaction(unmapped.id, 'tx-main')).id,
  })
}

async function bankLineCodeOf(entryId: string) {
  const lines = await prisma.entryLine.findMany({ where: { accountingEntryId: entryId }, include: { account: { select: { code: true } } } })
  return lines.find((l) => l.account.code.startsWith('512'))?.account.code
}

const input = () => ({
  journalId: ids.journal,
  date: '2026-03-06',
  description: 'Papeterie',
  lines: [{ accountId: ids.supplies, debit: 1234, credit: 0 }],
})

describe.skipIf(!available)('reconciliation: bank ledger account of the transaction', () => {
  beforeAll(async () => {
    await prepareTestDatabase('reconciliation_bank_ledger')
    ;({ prisma } = await import('@/lib/prisma'))
    service = await import('@/lib/reconciliation/service')
    context = await import('@/lib/reconciliation/context')
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('reconciliation_bank_ledger')
    await seed()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it("writes the bank line to the bank account's own 512 mapping, not the company default", async () => {
    const entry = await service.reconcileWithNewEntry(ids.company, ids.mappedTransaction, input())
    expect(await bankLineCodeOf(entry.id)).toBe('512200')
  })

  it('falls back to the company default for a bank account without a mapping', async () => {
    const entry = await service.reconcileWithNewEntry(ids.company, ids.unmappedTransaction, input())
    expect(await bankLineCodeOf(entry.id)).toBe('512100')
  })

  it('shows the same account in the reconciliation dialog', async () => {
    const mapped = await context.getReconciliationContext(ids.company, ids.mappedTransaction)
    expect(mapped.bankAccount).toMatchObject({ code: '512200' })
    const unmapped = await context.getReconciliationContext(ids.company, ids.unmappedTransaction)
    expect(unmapped.bankAccount).toMatchObject({ code: '512100' })
  })
})
