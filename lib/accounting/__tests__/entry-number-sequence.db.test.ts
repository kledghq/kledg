/**
 * KLEDG-R3-QUAL-17: the next definitive entry number comes from one indexed
 * query (kledg_entry_sequence, migration 20261125100000_entry_number_sequence)
 * instead of reading every validated entry of the fiscal year per
 * validation. The SQL function reads numbers exactly like sequentialPartOf,
 * the index serves max(), and concurrent bulk validations still give a
 * continuous sequence (BOI-CF-IOR-60-40-20 § 100). Skipped without the test
 * database.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('entry_number_sequence')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { sequentialPartOf } from '@/lib/accounting/services/generate-next-entry-number.service'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let lifecycle: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let numbering: typeof import('@/lib/accounting/services/generate-next-entry-number.service')

const NUMBERS = ['42', '2026-2', 'OD-0042', 'OD-42', '001', '010', '0', '000', 'AN-0007', '999999999', '0000999999999', '1000000000', '1727000000', 'TR-1727000000000', 'OD', 'invalid', 'BR-000000000042', 'BR-ABCDEF123456', 'VE-2026-0012/3', '٣']

describe.skipIf(!available)('entry number sequence (PostgreSQL)', () => {
  const ids = {} as Record<string, string>

  beforeAll(async () => {
    await prepareTestDatabase('entry_number_sequence')
    ;({ prisma } = await import('@/lib/prisma'))
    lifecycle = await import('@/lib/accounting/services/entry-lifecycle.service')
    numbering = await import('@/lib/accounting/services/generate-next-entry-number.service')
    const company = await prisma.company.create({ data: { name: 'Numéros', slug: 'numeros', siren: '123456782' } })
    const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') } })
    const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'OD' } })
    const bank = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '512000', label: 'Banque' } })
    const sales = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '706000', label: 'Ventes' } })
    Object.assign(ids, { company: company.id, fy: fy.id, journal: journal.id, bank: bank.id, sales: sales.id })
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('reads entry numbers exactly like sequentialPartOf', async () => {
    const rows = await prisma.$queryRaw<Array<{ n: string; s: bigint | null }>>`
      SELECT n, kledg_entry_sequence(n) AS s FROM unnest(${NUMBERS}::text[]) AS n`
    expect(rows.map((r) => [r.n, r.s === null ? null : Number(r.s)])).toEqual(NUMBERS.map((n) => [n, sequentialPartOf(n)]))
  })

  it('serves max() from the partial expression index', async () => {
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off')
      return tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        `EXPLAIN SELECT max(kledg_entry_sequence("entryNumber")) FROM "accounting_entries" WHERE "fiscalYearId" = '${ids.fy}' AND "status" = 'validated'`,
      )
    })
    expect(plan.map((r) => r['QUERY PLAN']).join('\n')).toContain('accounting_entries_validated_sequence_idx')
  })

  it('numbers concurrent bulk validations as one continuous sequence after legacy numbers', async () => {
    const draft = (i: number) =>
      lifecycle.createEntry({
        companyId: ids.company,
        journalId: ids.journal,
        date: '2026-03-01',
        description: `Vente ${i}`,
        lines: [
          { accountId: ids.bank, debit: '10.00', credit: 0 },
          { accountId: ids.sales, debit: 0, credit: '10.00' },
        ],
      })
    // Validated entries with legacy numbers: only "OD-0007" is part of the sequence
    for (const [i, entryNumber] of ['OD-0007', 'TR-1727000000000'].entries()) {
      const entry = await draft(100 + i)
      await prisma.accountingEntry.update({ where: { id: entry.id }, data: { status: 'validated', entryNumber, validatedAt: new Date() } })
    }
    const drafts = []
    for (let i = 0; i < 30; i++) drafts.push((await draft(i)).id)

    const [a, b] = await Promise.all([
      lifecycle.validateEntries(ids.company, drafts.slice(0, 15)),
      lifecycle.validateEntries(ids.company, drafts.slice(15)),
    ])
    expect([...a.errors, ...b.errors]).toEqual([])
    const numbers = (await prisma.accountingEntry.findMany({ where: { id: { in: drafts } }, select: { entryNumber: true } })).map((e) => Number(e.entryNumber))
    expect(numbers.sort((x, y) => x - y)).toEqual(Array.from({ length: 30 }, (_, i) => 8 + i))
    expect(await numbering.nextDefinitiveEntryNumber(ids.fy)).toBe('38')
  })
})
