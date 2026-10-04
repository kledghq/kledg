/**
 * Backfill of migration 20261003180000_entry_validation_and_fec_fields
 * against PostgreSQL: entries validated before the migration get their last
 * update time as validation date (the FEC ValidDate, LPF art. A47 A-1, best
 * known value); drafts and entries that already have a validation date are
 * left alone, and running it twice changes nothing. Skipped without the test
 * database server.
 *
 * The statement is read from the migration file. In the migration it runs
 * before the guard triggers are created (validated entries are definitive
 * afterwards, PCG art. 1031-3), so the test runs it with the guard disabled
 * inside one transaction, as it ran then.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('cov_validated_at_backfill')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../../../prisma/migrations/20261003180000_entry_validation_and_fec_fields/migration.sql'),
  'utf8',
)
const BACKFILL = MIGRATION.match(/^UPDATE "accounting_entries" SET "validatedAt" = [^;]+;$/m)?.[0]

let prisma: typeof import('@/lib/prisma').prisma

async function runBackfill() {
  await prisma.$transaction([
    prisma.$executeRawUnsafe('ALTER TABLE "accounting_entries" DISABLE TRIGGER "accounting_entries_guard"'),
    prisma.$executeRawUnsafe(BACKFILL!),
    prisma.$executeRawUnsafe('ALTER TABLE "accounting_entries" ENABLE TRIGGER "accounting_entries_guard"'),
  ])
}

describe.skipIf(!available)('migration 20261003180000_entry_validation_and_fec_fields: validatedAt backfill', () => {
  beforeAll(async () => {
    await prepareTestDatabase('cov_validated_at_backfill')
    ;({ prisma } = await import('@/lib/prisma'))
  })
  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('reads one UPDATE statement from the migration', () => {
    expect(BACKFILL).toBe(`UPDATE "accounting_entries" SET "validatedAt" = "updatedAt" WHERE "status" = 'validated' AND "validatedAt" IS NULL;`)
  })

  it('sets validatedAt to updatedAt for validated entries without one, once', async () => {
    const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
    const fy = await prisma.fiscalYear.create({
      data: { companyId: company.id, year: 2024, startDate: new Date('2024-01-01T00:00:00Z'), endDate: new Date('2024-12-31T00:00:00Z') },
    })
    const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'OD' } })
    const row = (entryNumber: string, status: string, updatedAt: string, validatedAt: string | null) =>
      prisma.accountingEntry.create({
        data: {
          companyId: company.id,
          journalId: journal.id,
          fiscalYearId: fy.id,
          entryNumber,
          status,
          date: new Date('2024-05-01T00:00:00Z'),
          description: entryNumber,
          updatedAt: new Date(updatedAt),
          validatedAt: validatedAt ? new Date(validatedAt) : null,
        },
      })
    // Rows as released versions left them: inserted directly, before validation dates existed
    const legacy = await row('1', 'validated', '2024-06-15T09:30:00.000Z', null)
    const alreadyDated = await row('2', 'validated', '2024-07-01T10:00:00.000Z', '2024-06-20T08:00:00.000Z')
    const draft = await row('BR-1', 'draft', '2024-08-01T10:00:00.000Z', null)

    await runBackfill()
    const first = await prisma.accountingEntry.findMany({ orderBy: { entryNumber: 'asc' }, select: { id: true, validatedAt: true, updatedAt: true } })
    await runBackfill()
    const second = await prisma.accountingEntry.findMany({ orderBy: { entryNumber: 'asc' }, select: { id: true, validatedAt: true, updatedAt: true } })

    const byId = new Map(first.map((e) => [e.id, e.validatedAt?.toISOString() ?? null]))
    expect(byId.get(legacy.id)).toBe('2024-06-15T09:30:00.000Z')
    expect(byId.get(alreadyDated.id)).toBe('2024-06-20T08:00:00.000Z')
    expect(byId.get(draft.id)).toBeNull()
    // Idempotent, and updatedAt itself untouched
    expect(second).toEqual(first)
    expect(first.find((e) => e.id === legacy.id)?.updatedAt.toISOString()).toBe('2024-06-15T09:30:00.000Z')

    // The guard is back: the backfilled entry is definitive again
    await expect(prisma.accountingEntry.update({ where: { id: legacy.id }, data: { validatedAt: null } })).rejects.toThrow(/KLEDG_IMMUTABLE_ENTRY/)
  })
})
