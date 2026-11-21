/**
 * #148: a draft created while a period is being closed. The entry guard
 * takes a share lock on the fiscal year row, so it waits for the period
 * lock (FOR UPDATE) to commit and then sees the closed period, instead of
 * reading the old limit and landing a draft that can no longer be
 * validated behind a closed day (PCG art. 1031-4). Skipped without the test
 * database.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('period_lock_race')
})

vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(async () => {}) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let lifecycle: typeof import('@/lib/accounting/services/entry-lifecycle.service')

describe.skipIf(!available)('period lock against a concurrent draft (PostgreSQL)', () => {
  const ids = {} as Record<string, string>

  beforeAll(async () => {
    await prepareTestDatabase('period_lock_race')
    ;({ prisma } = await import('@/lib/prisma'))
    lifecycle = await import('@/lib/accounting/services/entry-lifecycle.service')
    const company = await prisma.company.create({ data: { name: 'Course', slug: 'course', siren: '123456782' } })
    const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') } })
    const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'OD' } })
    const bank = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '512000', label: 'Banque' } })
    const sales = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '706000', label: 'Ventes' } })
    Object.assign(ids, { company: company.id, fy: fy.id, journal: journal.id, bank: bank.id, sales: sales.id })
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('refuses a draft dated in the period closed while it was being written', async () => {
    let created: Promise<unknown> = Promise.resolve(null)
    await prisma.$transaction(async (tx) => {
      // The period lock: row lock, then the new limit, not committed yet
      await tx.$queryRaw`SELECT 1 FROM "fiscal_years" WHERE "id" = ${ids.fy} FOR UPDATE`
      await tx.fiscalYear.update({ where: { id: ids.fy }, data: { periodLockedThrough: new Date('2026-03-31T00:00:00Z'), periodLockedAt: new Date() } })
      created = lifecycle
        .createEntry({
          companyId: ids.company,
          journalId: ids.journal,
          date: '2026-03-15',
          description: 'Brouillon concurrent',
          lines: [
            { accountId: ids.bank, debit: '10.00', credit: 0 },
            { accountId: ids.sales, debit: 0, credit: '10.00' },
          ],
        })
        .catch((error: unknown) => error)
      await new Promise((resolve) => setTimeout(resolve, 500))
    })
    const outcome = await created
    expect(outcome).toBeInstanceOf(Error)
    expect(String((outcome as Error).message)).toMatch(/clôtur/)
    expect(await prisma.accountingEntry.count({ where: { fiscalYearId: ids.fy } })).toBe(0)
  })
})
