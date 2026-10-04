/**
 * Missing supporting documents (lib/banking/missing-receipts.service.ts)
 * against PostgreSQL (skipped without the server): transactions without an
 * attachment, filtered by fiscal year or period, bank account, threshold
 * and side; declined operations and other companies left out; count and
 * total over every match, the list bounded.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('missing_receipts')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let service: typeof import('../missing-receipts.service')

const ids = {} as Record<string, string>

async function seed() {
  const company = await prisma.company.create({ data: { name: 'Justif', slug: 'justif', siren: '920000001' } })
  const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '920000002' } })
  const fy = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') },
  })
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, login: 'justif', secretKeyEncrypted: 'x' } })
  const otherConnection = await prisma.bankConnection.create({ data: { companyId: other.id, login: 'autre', secretKeyEncrypted: 'x' } })
  const account = (bankConnectionId: string, name: string) => prisma.bankAccount.create({ data: { bankConnectionId, externalAccountId: name, name } })
  const main = await account(connection.id, 'Courant')
  const savings = await account(connection.id, 'Épargne')
  const foreign = await account(otherConnection.id, 'Autre')
  let n = 0
  const tx = (bankAccountId: string, date: string, amount: number, side: 'debit' | 'credit', extra: Record<string, unknown> = {}) =>
    prisma.bankTransaction.create({
      data: { bankAccountId, externalTransactionId: `t${++n}`, amount, date: new Date(`${date}T00:00:00Z`), side, label: `Opération ${n}`, ...extra },
    })
  const rent = await tx(main.id, '2026-02-01', 1200, 'debit', { counterpartyName: 'SCI Les Tilleuls' })
  await tx(main.id, '2026-02-03', 9.9, 'debit')
  await tx(main.id, '2026-03-10', 450, 'credit', { reconciled: true })
  await tx(savings.id, '2026-04-01', 300, 'debit')
  await tx(main.id, '2026-04-02', 80, 'debit', { status: 'declined' })
  await tx(main.id, '2025-12-31', 500, 'debit')
  await tx(foreign.id, '2026-02-01', 999, 'debit')
  const withReceipt = await tx(main.id, '2026-02-05', 60, 'debit')
  await prisma.attachment.create({ data: { companyId: company.id, bankTransactionId: withReceipt.id, fileName: 'facture.pdf' } })
  Object.assign(ids, { company: company.id, fy: fy.id, main: main.id, savings: savings.id, foreign: foreign.id, rent: rent.id })
}

const parse = (query: Record<string, string>) => service.MissingReceiptsQuerySchema.parse(query)

describe.skipIf(!available)('missing receipts (PostgreSQL)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('missing_receipts')
    ;({ prisma } = await import('@/lib/prisma'))
    service = await import('../missing-receipts.service')
  })
  beforeEach(async () => {
    await prepareTestDatabase('missing_receipts')
    await seed()
  })
  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('lists the transactions of the fiscal year without attachment, newest first, declined ones left out', async () => {
    const result = await service.listMissingReceipts(ids.company, parse({ fiscalYearId: ids.fy }))
    expect(result.transactions.map((t) => [t.date, t.amountCents])).toEqual([
      ['2026-04-01', -30_000],
      ['2026-03-10', 45_000],
      ['2026-02-03', -990],
      ['2026-02-01', -120_000],
    ])
    expect(result).toMatchObject({ count: 4, totalCents: 195_990, truncated: false, thresholdCents: 0, period: { startDate: '2026-01-01', endDate: '2026-12-31' } })
    expect(result.transactions[3]).toMatchObject({ id: ids.rent, counterpartyName: 'SCI Les Tilleuls', bankAccount: { name: 'Courant' }, reconciled: false })
  })

  it('filters by threshold, side, bank account and period', async () => {
    const threshold = await service.listMissingReceipts(ids.company, parse({ fiscalYearId: ids.fy, minAmount: '50' }))
    expect(threshold.transactions.map((t) => t.amountCents)).toEqual([-30_000, 45_000, -120_000])
    expect(threshold.thresholdCents).toBe(5_000)

    const decimals = await service.listMissingReceipts(ids.company, parse({ fiscalYearId: ids.fy, minAmount: '9,90', side: 'debit' }))
    expect(decimals.transactions.map((t) => t.amountCents)).toEqual([-30_000, -990, -120_000])

    const savings = await service.listMissingReceipts(ids.company, parse({ bankAccountId: ids.savings }))
    expect(savings.transactions.map((t) => t.amountCents)).toEqual([-30_000])

    const period = await service.listMissingReceipts(ids.company, parse({ startDate: '2026-02-01', endDate: '2026-02-28' }))
    expect(period.count).toBe(2)
    // Without a fiscal year or a period: every year, the 2025 one included
    expect((await service.listMissingReceipts(ids.company, parse({}))).count).toBe(5)
  })

  it('bounds the list but counts every match', async () => {
    const result = await service.listMissingReceipts(ids.company, parse({ fiscalYearId: ids.fy, limit: '2' }))
    expect(result.transactions).toHaveLength(2)
    expect(result).toMatchObject({ count: 4, truncated: true })
  })

  it('refuses a bank account or fiscal year of another company, an inverted period and a bad threshold', async () => {
    await expect(service.listMissingReceipts(ids.company, parse({ bankAccountId: ids.foreign }))).rejects.toThrow('Compte bancaire introuvable')
    await expect(service.listMissingReceipts(ids.company, parse({ fiscalYearId: 'unknown' }))).rejects.toThrow(/Exercice introuvable/)
    await expect(service.listMissingReceipts(ids.company, parse({ startDate: '2026-03-01', endDate: '2026-02-01' }))).rejects.toThrow(/précède/)
    expect(() => parse({ minAmount: '-5' })).toThrow()
    expect(() => parse({ minAmount: '1.234' })).toThrow()
  })
})
