/**
 * Ledger integrity against PostgreSQL (#147): the database hashes an entry
 * at validation, a period lock and a closing seal the fiscal year, and
 * verifyLedger tells an entry or a seal changed in the database outside
 * Kledg. Skipped without the test database server.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('ledger_integrity')
})

vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(async () => {}) }))

import { prepareTestDatabase, queryAsOwner, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let integrity: typeof import('../ledger-integrity.service')

const ids = {} as Record<string, string>

describe.skipIf(!available)('ledger integrity (PostgreSQL)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('ledger_integrity')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    integrity = await import('../ledger-integrity.service')
    const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
    const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') } })
    const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'OD' } })
    const bank = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '512000', label: 'Banque' } })
    const sales = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '706000', label: 'Ventes' } })
    Object.assign(ids, { company: company.id, fy: fy.id, journal: journal.id, bank: bank.id, sales: sales.id })
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  const book = (date: string, amount: string) =>
    svc.createEntry({
      companyId: ids.company,
      journalId: ids.journal,
      date,
      description: `Vente du ${date}`,
      status: 'validated',
      lines: [
        { accountId: ids.bank, debit: amount, credit: 0 },
        { accountId: ids.sales, debit: 0, credit: amount },
      ],
    })

  it('hashes entries at validation, seals the year at a period lock, and finds a change made in the database', async () => {
    const first = await book('2026-01-10', '100.00')
    const stored = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: first.id } })
    expect(stored.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.hashedAt).toBeInstanceOf(Date)
    // The hash never changes once written
    await expect(prisma.accountingEntry.update({ where: { id: first.id }, data: { contentHash: 'f'.repeat(64) } })).rejects.toThrow(/KLEDG_IMMUTABLE_ENTRY/)

    const { lockPeriod } = await import('@/lib/accounting/period-lock/lock-period.service')
    await lockPeriod(ids.company, ids.fy, '2026-01-31', 'user-1')
    const seal = await prisma.ledgerSeal.findFirstOrThrow({ where: { fiscalYearId: ids.fy } })
    expect(seal).toMatchObject({ reason: 'period_lock', entryCount: 1 })
    await expect(prisma.ledgerSeal.delete({ where: { id: seal.id } })).rejects.toThrow(/KLEDG_IMMUTABLE_SEAL/)

    // Entries validated after the seal do not break it
    await book('2026-02-10', '50.00')
    expect(integrity.verificationProblems(await integrity.verifyLedger(ids.company, ids.fy))).toEqual([])

    // Someone with the database itself changes a validated line, past the triggers
    await queryAsOwner('ledger_integrity', `
      ALTER TABLE "entry_lines" DISABLE TRIGGER USER;
      UPDATE "entry_lines" SET "debit" = 1000, "credit" = 0 WHERE "accountingEntryId" = '${first.id}' AND "debit" > 0;
      UPDATE "entry_lines" SET "credit" = 1000 WHERE "accountingEntryId" = '${first.id}' AND "credit" > 0;
      ALTER TABLE "entry_lines" ENABLE TRIGGER USER;`)
    const verification = await integrity.verifyLedger(ids.company, ids.fy)
    expect(verification.alteredEntries).toEqual([stored.entryNumber])
    expect(verification.brokenSeals).toHaveLength(0) // the seal covers the hashes, the hash shows the change
    expect(integrity.verificationProblems(verification).join(' ')).toContain('modifiées dans la base de données')

    // Deleting a sealed entry outright breaks the seal
    await queryAsOwner('ledger_integrity', `
      ALTER TABLE "accounting_entries" DISABLE TRIGGER USER; ALTER TABLE "entry_lines" DISABLE TRIGGER USER;
      DELETE FROM "entry_lines" WHERE "accountingEntryId" = '${first.id}';
      DELETE FROM "accounting_entries" WHERE "id" = '${first.id}';
      ALTER TABLE "accounting_entries" ENABLE TRIGGER USER; ALTER TABLE "entry_lines" ENABLE TRIGGER USER;`)
    expect((await integrity.verifyLedger(ids.company, ids.fy)).brokenSeals).toHaveLength(1)
  })
})
