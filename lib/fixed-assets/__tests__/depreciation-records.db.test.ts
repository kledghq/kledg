/**
 * Depreciation records against PostgreSQL (#135): a record booked by a
 * validated entry stays as booked (no replacing, deleting or unlinking, so
 * no second allowance and no register that disagrees with the ledger), a
 * record links only to a depreciation allowance (68 debit, 28 credit, PCG
 * art. 214-13), and an amount has two decimals at most. Skipped without the
 * test database server.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('depreciation_records')
})

vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(async () => {}) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let records: typeof import('../manage-depreciation-records.service')
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const ids = {} as Record<string, string>

describe.skipIf(!available)('depreciation records (PostgreSQL)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('depreciation_records')
    ;({ prisma } = await import('@/lib/prisma'))
    records = await import('../manage-depreciation-records.service')
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')

    const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
    const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
    const accounts: Record<string, string> = {}
    for (const [code, label] of [['218300', 'Matériel informatique'], ['281830', 'Amortissements'], ['681120', 'Dotations'], ['606400', 'Fournitures'], ['512000', 'Banque']]) {
      accounts[code] = (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label } })).id
    }
    const od = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'Opérations diverses' } })
    const asset = await prisma.fixedAsset.create({
      data: {
        companyId: company.id,
        label: 'Ordinateur',
        acquisitionDate: day('2025-01-01'),
        acquisitionValue: 3000,
        depreciationStartDate: day('2025-01-01'),
        depreciationDuration: 3,
        assetAccountId: accounts['218300'],
        depreciationAccountId: accounts['281830'],
        expenseAccountId: accounts['681120'],
      },
    })
    const other = await svc.createEntry({
      companyId: company.id,
      journalId: od.id,
      date: '2025-06-01',
      description: 'Fournitures',
      status: 'validated',
      lines: [
        { accountId: accounts['606400'], debit: '10', credit: '0' },
        { accountId: accounts['512000'], debit: '0', credit: '10' },
      ],
    })
    Object.assign(ids, { company: company.id, fy: fy.id, asset: asset.id, other: other.id })
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('keeps a booked record as booked, links only to an allowance and refuses a third decimal', async () => {
    await expect(records.saveDepreciationRecord(ids.company, ids.asset, { fiscalYearId: ids.fy, periodType: 'year', amount: 1000.005 })).rejects.toThrow(/deux décimales/)

    const record = await records.saveDepreciationRecord(ids.company, ids.asset, { fiscalYearId: ids.fy, periodType: 'year' })
    expect(record.amount.toString()).toBe('1000')
    // An entry that is not an allowance (606 / 512) is refused
    await expect(records.linkDepreciationRecord(ids.company, ids.asset, record.id, ids.other)).rejects.toThrow(/compte 68/)

    // Booked by a validated entry: not replaced, deleted or unlinked any more
    await records.postDepreciationRecord(ids.company, ids.asset, record.id)
    const booked = await prisma.fixedAssetDepreciation.findUniqueOrThrow({ where: { id: record.id } })
    expect(booked.accountingEntryId).not.toBeNull()
    await expect(records.saveDepreciationRecord(ids.company, ids.asset, { fiscalYearId: ids.fy, periodType: 'year', amount: 500 })).rejects.toThrow(/écriture validée/)
    await expect(records.linkDepreciationRecord(ids.company, ids.asset, record.id, null)).rejects.toThrow(/écriture validée/)
    await expect(records.deleteDepreciationRecord(ids.company, ids.asset, record.id)).rejects.toThrow(/écriture validée/)
    // Linking it again to its own entry changes nothing and is accepted
    await records.linkDepreciationRecord(ids.company, ids.asset, record.id, booked.accountingEntryId)
    expect((await prisma.fixedAssetDepreciation.findUniqueOrThrow({ where: { id: record.id } })).amount.toString()).toBe('1000')
  })
})
