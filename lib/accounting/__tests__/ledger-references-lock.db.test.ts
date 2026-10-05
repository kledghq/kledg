/**
 * Journals and accounts referenced by the books (PostgreSQL, skipped without
 * the test database server).
 *
 * A validated entry is definitive (PCG art. 1031-3) and the FEC must give
 * back the books as they were recorded (LPF art. A47 A-1: JournalCode,
 * JournalLib, CompteNum, CompteLib of each line). The entry stores the
 * journal and the account by id, so changing the code of a journal or an
 * account that validated entries use would rewrite those entries: refused,
 * by the services (French 409) and by the database (triggers of migration
 * 20261107090000_ledger_references_lock). Labels stay editable while the
 * fiscal year is open, and freeze with it (PCG art. 1031-4).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('ledger_references')
})

vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let journals: typeof import('@/lib/accounting/manage-journals.service')
let accounts: typeof import('@/lib/accounting/manage-accounts.service')
let handleError: typeof import('@/lib/accounting/errors').handleError
const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function entry(status: 'draft' | 'validated', fiscalYearId: string, accountIds: [string, string], number: string) {
  const created = await prisma.accountingEntry.create({
    data: {
      companyId: ids.company,
      journalId: ids.journal,
      fiscalYearId,
      entryNumber: `BR-${number}`,
      date: day('2025-06-30'),
      description: 'Vente',
      lines: {
        create: [
          { accountId: accountIds[0], accountFiscalYearId: fiscalYearId, debit: 100 },
          { accountId: accountIds[1], accountFiscalYearId: fiscalYearId, credit: 100 },
        ],
      },
    },
  })
  if (status === 'validated') {
    await prisma.accountingEntry.update({ where: { id: created.id }, data: { status: 'validated', entryNumber: number } })
  }
  return created.id
}

describe.skipIf(!available)('journals and accounts used by validated entries', () => {
  beforeAll(async () => {
    await prepareTestDatabase('ledger_references')
    ;({ prisma } = await import('@/lib/prisma'))
    journals = await import('@/lib/accounting/manage-journals.service')
    accounts = await import('@/lib/accounting/manage-accounts.service')
    ;({ handleError } = await import('@/lib/accounting/errors'))
  })

  beforeEach(async () => {
    await prepareTestDatabase('ledger_references')
    const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
    const fy = await prisma.fiscalYear.create({
      data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') },
    })
    const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'VT', label: 'Ventes' } })
    const bank = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '512100', label: 'Banque' } })
    const sales = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '706100', label: 'Prestations' } })
    Object.assign(ids, { company: company.id, fy: fy.id, journal: journal.id, bank: bank.id, sales: sales.id })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('keeps journal and account codes editable while only drafts use them', async () => {
    await entry('draft', ids.fy, [ids.bank, ids.sales], '1')
    await expect(journals.updateJournal(ids.company, ids.journal, { code: 'VE' })).resolves.toMatchObject({ code: 'VE' })
    await expect(accounts.updateAccount(ids.company, ids.sales, { code: '706200' })).resolves.toMatchObject({ account: { code: '706200' } })
  })

  it('refuses a new code for a journal holding validated entries (service and database)', async () => {
    await entry('validated', ids.fy, [ids.bank, ids.sales], '1')
    await expect(journals.updateJournal(ids.company, ids.journal, { code: 'VE' })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('écritures validées'),
    })
    const direct = await prisma.journal.update({ where: { id: ids.journal }, data: { code: 'VE' } }).catch((e: unknown) => e)
    expect(handleError(direct)).toMatchObject({ statusCode: 409, message: expect.stringContaining('PCG art. 1031-3') })
    expect((await prisma.journal.findUniqueOrThrow({ where: { id: ids.journal } })).code).toBe('VT')
    // The label of an open year's journal may still be corrected
    await expect(journals.updateJournal(ids.company, ids.journal, { label: 'Journal des ventes' })).resolves.toMatchObject({ label: 'Journal des ventes' })
  })

  it('refuses a new number for an account carrying validated lines (service and database)', async () => {
    await entry('validated', ids.fy, [ids.bank, ids.sales], '1')
    await expect(accounts.updateAccount(ids.company, ids.sales, { code: '706200' })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('écritures validées'),
    })
    const direct = await prisma.account.update({ where: { id: ids.sales }, data: { code: '706200' } }).catch((e: unknown) => e)
    expect(handleError(direct)).toMatchObject({ statusCode: 409 })
    expect((await prisma.account.findUniqueOrThrow({ where: { id: ids.sales } })).code).toBe('706100')
    await expect(accounts.updateAccount(ids.company, ids.sales, { label: 'Prestations de services' })).resolves.toMatchObject({
      account: { label: 'Prestations de services' },
    })
  })

  it('freezes labels with the closed fiscal year', async () => {
    await entry('validated', ids.fy, [ids.bank, ids.sales], '1')
    await prisma.fiscalYear.update({ where: { id: ids.fy }, data: { isClosed: true, closedAt: day('2026-03-01') } })

    await expect(accounts.updateAccount(ids.company, ids.sales, { label: 'Autre' })).rejects.toMatchObject({ statusCode: 409 })
    await expect(journals.updateJournal(ids.company, ids.journal, { label: 'Autre' })).rejects.toMatchObject({ statusCode: 409 })
    const directAccount = await prisma.account.update({ where: { id: ids.sales }, data: { label: 'Autre' } }).catch((e: unknown) => e)
    expect(handleError(directAccount)).toMatchObject({ statusCode: 409 })
    const directJournal = await prisma.journal.update({ where: { id: ids.journal }, data: { label: 'Autre' } }).catch((e: unknown) => e)
    expect(handleError(directJournal)).toMatchObject({ statusCode: 409 })
  })
})
