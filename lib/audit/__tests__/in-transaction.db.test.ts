/**
 * #161: a period lock and a draft deletion write their audit row in their
 * own transaction, so the row exists whenever the operation committed.
 * Skipped without the test database.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('audit_in_transaction')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let lifecycle: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let periodLock: typeof import('@/lib/accounting/period-lock/lock-period.service')

describe.skipIf(!available)('audit rows in the transaction of the operation (PostgreSQL)', () => {
  const ids = {} as Record<string, string>

  beforeAll(async () => {
    await prepareTestDatabase('audit_in_transaction')
    ;({ prisma } = await import('@/lib/prisma'))
    lifecycle = await import('@/lib/accounting/services/entry-lifecycle.service')
    periodLock = await import('@/lib/accounting/period-lock/lock-period.service')
    const company = await prisma.company.create({ data: { name: 'Audit', slug: 'audit', siren: '123456782' } })
    const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') } })
    const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'OD' } })
    const bank = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '512000', label: 'Banque' } })
    const sales = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '706000', label: 'Ventes' } })
    Object.assign(ids, { company: company.id, fy: fy.id, journal: journal.id, bank: bank.id, sales: sales.id })
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('records the deletion of a draft', async () => {
    const draft = await lifecycle.createEntry({
      companyId: ids.company,
      journalId: ids.journal,
      date: '2026-05-04',
      description: 'Brouillon à supprimer',
      lines: [
        { accountId: ids.bank, debit: '10.00', credit: 0 },
        { accountId: ids.sales, debit: 0, credit: '10.00' },
      ],
    })
    await lifecycle.deleteDraftEntry(ids.company, draft.id)
    const rows = await prisma.auditLog.findMany({ where: { companyId: ids.company, action: 'DELETE_ACCOUNTING_ENTRY' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ level: 'INFO', metadata: { entryId: draft.id, description: 'Brouillon à supprimer' } })
  })

  it('records a period lock', async () => {
    await periodLock.lockPeriod(ids.company, ids.fy, '2026-03-31', 'u-audit')
    const rows = await prisma.auditLog.findMany({ where: { companyId: ids.company, action: 'PERIOD_LOCKED' } })
    expect(rows).toHaveLength(1)
    expect(rows[0].metadata).toMatchObject({ fiscalYearId: ids.fy, through: '2026-03-31', previous: null })
  })
})
