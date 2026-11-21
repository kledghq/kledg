/**
 * #161: an entry inserted directly as validated is refused by the database
 * (accounting_entries_guard, migration 20261223090000): the validation
 * checks (definitive number, balance, content hash) only run on the draft
 * to validated update. Skipped without the test database.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('validated_insert_guard')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma

describe.skipIf(!available)('insert of a validated entry (PostgreSQL)', () => {
  const ids = {} as Record<string, string>

  beforeAll(async () => {
    await prepareTestDatabase('validated_insert_guard')
    ;({ prisma } = await import('@/lib/prisma'))
    const company = await prisma.company.create({ data: { name: 'Garde', slug: 'garde', siren: '123456782' } })
    const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') } })
    const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'OD' } })
    Object.assign(ids, { company: company.id, fy: fy.id, journal: journal.id })
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  const row = (status: 'draft' | 'validated', entryNumber: string) => ({
    companyId: ids.company,
    fiscalYearId: ids.fy,
    journalId: ids.journal,
    entryNumber,
    date: new Date('2026-02-02T00:00:00Z'),
    description: 'Insertion directe',
    status,
  })

  it('refuses an insert as validated and accepts a draft', async () => {
    await expect(prisma.accountingEntry.create({ data: row('validated', '1') })).rejects.toThrow(/KLEDG_INVALID_ENTRY: une écriture se crée en brouillon/)
    await expect(prisma.accountingEntry.createMany({ data: [row('validated', '2')] })).rejects.toThrow(/KLEDG_INVALID_ENTRY/)
    await expect(prisma.accountingEntry.create({ data: row('draft', 'BR-1') })).resolves.toMatchObject({ status: 'draft' })
    expect(await prisma.accountingEntry.count({ where: { companyId: ids.company, status: 'validated' } })).toBe(0)
  })
})
