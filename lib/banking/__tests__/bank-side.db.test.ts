/**
 * KLEDG-R3-QUAL-19: one spelling of the side of a bank transaction.
 * Migration 20261125090000_bank_transaction_side normalises legacy values
 * with the rule of normalizeBankSide, then a check constraint refuses
 * anything but "debit" and "credit". Skipped without the test database.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('bank_side')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { normalizeBankSide } from '@/lib/banking/side'

const available = await testDatabaseAvailable()

const SQL = readFileSync(path.resolve(__dirname, '../../../prisma/migrations/20261125090000_bank_transaction_side/migration.sql'), 'utf8')
const NORMALISE = SQL.slice(SQL.indexOf('UPDATE "bank_transactions"'), SQL.indexOf('ALTER TABLE'))

let prisma: typeof import('@/lib/prisma').prisma

describe.skipIf(!available)('bank transaction side (migration 20261125090000_bank_transaction_side)', () => {
  let bankAccountId = ''

  beforeAll(async () => {
    await prepareTestDatabase('bank_side')
    ;({ prisma } = await import('@/lib/prisma'))
    const company = await prisma.company.create({ data: { name: 'Side', slug: 'side', siren: '123456782' } })
    const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'MANUAL' } })
    bankAccountId = (await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: 'side', name: 'Courant' } })).id
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  const insert = (externalTransactionId: string, side: string) =>
    prisma.bankTransaction.create({ data: { bankAccountId, externalTransactionId, amount: 10, date: new Date('2026-03-01T00:00:00Z'), side } })

  it('refuses any side other than debit and credit', async () => {
    await expect(insert('ok-debit', 'debit')).resolves.toMatchObject({ side: 'debit' })
    await expect(insert('ok-credit', 'credit')).resolves.toMatchObject({ side: 'credit' })
    for (const legacy of ['DEBIT', 'Débit', 'Crédit', 'd', '']) {
      await expect(insert(`bad-${legacy}`, legacy)).rejects.toThrow(/bank_transactions_side_check/)
    }
  })

  it('normalises legacy values like normalizeBankSide, then the constraint holds', async () => {
    const legacy = ['DEBIT', 'Débit', ' debit', 'D', 'Crédit', 'CREDIT', 'c', '']
    await prisma.$executeRawUnsafe('ALTER TABLE "bank_transactions" DROP CONSTRAINT "bank_transactions_side_check"')
    try {
      for (const [i, side] of legacy.entries()) await insert(`legacy-${i}`, side)
      await prisma.$executeRawUnsafe(NORMALISE)
    } finally {
      await prisma.$executeRawUnsafe(SQL.slice(SQL.indexOf('ALTER TABLE')))
    }
    const rows = await prisma.bankTransaction.findMany({ where: { externalTransactionId: { startsWith: 'legacy-' } }, select: { externalTransactionId: true, side: true } })
    const sideOf = new Map(rows.map((r) => [r.externalTransactionId, r.side]))
    expect(legacy.map((_, i) => sideOf.get(`legacy-${i}`))).toEqual(legacy.map((side) => normalizeBankSide(side)))
    expect(legacy.map((side) => normalizeBankSide(side))).toEqual(['debit', 'debit', 'debit', 'debit', 'credit', 'credit', 'credit', 'credit'])
  })
})
