/**
 * Fiscal years against PostgreSQL (skipped without the test database server):
 *
 * - lib/accounting/fiscal-year-utils.ts: the active year, the year holding a
 *   date (calendar days, legacy bounds stored at 23:00 UTC);
 * - lib/accounting/active-fiscal-year.service.ts: the year a write creates
 *   from the company's closing day when none is open (through
 *   createFiscalYear, with its chart), never on a read;
 * - lib/accounting/fiscal-year-closure/lock.ts: a closed fiscal year never
 *   changes (PCG art. 1031-4; validated entries definitive, art. 1031-3), in
 *   the service helpers and in the database triggers;
 * - lib/accounting/fiscal-year-closure/validate-fiscal-year-closure.service.ts:
 *   every check that blocks or warns before a closing.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('cov_fiscal_years')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let utils: typeof import('@/lib/accounting/fiscal-year-utils')
let ensure: typeof import('@/lib/accounting/active-fiscal-year.service')
let lock: typeof import('@/lib/accounting/fiscal-year-closure/lock')
let validateFiscalYearClosure: typeof import('@/lib/accounting/fiscal-year-closure/validate-fiscal-year-closure.service').validateFiscalYearClosure
let lifecycle: typeof import('@/lib/accounting/services/entry-lifecycle.service')

const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function company(slug = 'atelier', data: { closingDay?: number; closingMonth?: number } = {}) {
  const created = await prisma.company.create({ data: { name: slug, slug, siren: slug === 'atelier' ? '123456789' : '987654321', ...data } })
  return created.id
}

async function fiscalYear(companyId: string, year: number, start: string, end: string) {
  const created = await prisma.fiscalYear.create({ data: { companyId, year, startDate: day(start), endDate: day(end) } })
  return created.id
}

async function close(fiscalYearId: string) {
  await prisma.fiscalYear.update({ where: { id: fiscalYearId }, data: { isClosed: true, closedAt: day('2026-02-01') } })
}

describe.skipIf(!available)('fiscal years (PostgreSQL)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('cov_fiscal_years')
    ;({ prisma } = await import('@/lib/prisma'))
    utils = await import('@/lib/accounting/fiscal-year-utils')
    ensure = await import('@/lib/accounting/active-fiscal-year.service')
    lock = await import('@/lib/accounting/fiscal-year-closure/lock')
    ;({ validateFiscalYearClosure } = await import('@/lib/accounting/fiscal-year-closure/validate-fiscal-year-closure.service'))
    lifecycle = await import('@/lib/accounting/services/entry-lifecycle.service')
  })
  beforeEach(async () => {
    await prepareTestDatabase('cov_fiscal_years')
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('fiscal-year-utils', () => {
    it('returns the most recent open year, or null', async () => {
      const companyId = await company()
      expect(await utils.getActiveFiscalYear(companyId)).toBeNull()
      const fy2024 = await fiscalYear(companyId, 2024, '2024-01-01', '2024-12-31')
      const fy2025 = await fiscalYear(companyId, 2025, '2025-01-01', '2025-12-31')
      expect((await utils.getActiveFiscalYear(companyId))?.id).toBe(fy2025)
      await close(fy2024)
      await prisma.fiscalYear.update({ where: { id: fy2025 }, data: { isClosed: true } })
      expect(await utils.getActiveFiscalYear(companyId)).toBeNull()
    })

    it('finds the year holding a date by calendar day, legacy bounds at 23:00 UTC included', async () => {
      const companyId = await company()
      const fy2024 = await fiscalYear(companyId, 2024, '2024-01-01', '2024-12-31')
      // Stored at local midnight in Paris by older code: 31/12/2024 23:00 UTC is 01/01/2025
      const legacy = (
        await prisma.fiscalYear.create({
          data: { companyId, year: 2025, startDate: new Date('2024-12-31T23:00:00Z'), endDate: new Date('2025-12-30T23:00:00Z') },
        })
      ).id

      expect(await utils.getFiscalYearForDate(companyId, day('2024-12-31'))).toEqual({ id: fy2024, year: 2024 })
      expect(await utils.getFiscalYearForDate(companyId, day('2025-01-01'))).toEqual({ id: legacy, year: 2025 })
      expect(await utils.getFiscalYearForDate(companyId, day('2025-12-31'))).toEqual({ id: legacy, year: 2025 })
      expect(await utils.getFiscalYearForDate(companyId, day('2026-01-01'))).toBeNull()
      expect(await utils.getFiscalYearForDate(companyId, new Date('invalid'))).toBeNull()
      // getFiscalYearForEntry falls back to the active year
      expect(await utils.getFiscalYearForEntry(companyId, day('2027-05-01'))).toEqual({ id: legacy, year: 2025 })
    })

    it('creates the open year from the closing day and month when none exists', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-03-10T12:00:00Z'))
      const companyId = await company('juin', { closingDay: 30, closingMonth: 6 })

      const created = await ensure.ensureActiveFiscalYear(companyId)

      // Closing on 30/06: on 10/03/2026 the year runs from 01/07/2025 to 30/06/2026
      expect([created.year, created.startDate.toISOString(), created.endDate.toISOString(), created.isClosed]).toEqual([
        2026,
        '2025-07-01T00:00:00.000Z',
        '2026-06-30T00:00:00.000Z',
        false,
      ])
      // Called again: the same year, not a second one
      expect((await ensure.ensureActiveFiscalYear(companyId)).id).toBe(created.id)
      expect(await prisma.fiscalYear.count({ where: { companyId } })).toBe(1)
    })

    it('starts the next year after the closing day has passed, and clamps 31 to the month length', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-03-10T12:00:00Z'))
      const companyId = await company('fevrier', { closingDay: 31, closingMonth: 2 })

      const created = await ensure.ensureActiveFiscalYear(companyId)

      // 28/02/2026 has passed: 01/03/2026 to 28/02/2027
      expect([created.year, created.startDate.toISOString(), created.endDate.toISOString()]).toEqual([
        2027,
        '2026-03-01T00:00:00.000Z',
        '2027-02-28T00:00:00.000Z',
      ])
    })

    it('opens the following year when the year of today is already closed', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-03-10T12:00:00Z'))
      const companyId = await company()
      const fy2026 = await fiscalYear(companyId, 2026, '2026-01-01', '2026-12-31')
      await close(fy2026)

      const created = await ensure.ensureActiveFiscalYear(companyId)

      expect([created.year, created.startDate.toISOString(), created.endDate.toISOString()]).toEqual([
        2027,
        '2027-01-01T00:00:00.000Z',
        '2027-12-31T00:00:00.000Z',
      ])
    })

    it('creates the year through createFiscalYear: its PCG chart is seeded', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-03-10T12:00:00Z'))
      const companyId = await company()
      const created = await ensure.ensureActiveFiscalYear(companyId)
      expect(await prisma.account.count({ where: { companyId, fiscalYearId: created.id, code: '512' } })).toBe(1)
    })

    it('answers a typed French 404 for an unknown company', async () => {
      await expect(ensure.ensureActiveFiscalYear('missing')).rejects.toMatchObject({ statusCode: 404, message: 'Société introuvable' })
    })

    it('finds the current year by calendar day, its last day included (KLEDG-R3-QUAL-15)', async () => {
      const companyId = await company()
      const fy2026 = await fiscalYear(companyId, 2026, '2026-01-01', '2026-12-31')
      await fiscalYear(companyId, 2027, '2027-01-01', '2027-12-31')
      const { resolveDashboardFiscalYear } = await import('@/lib/reports/dashboard')
      const { calculateDepreciationTable } = await import('@/lib/reports/depreciation.service')
      const lastDay = new Date('2026-12-31T10:00:00Z')
      expect((await resolveDashboardFiscalYear(companyId, null, lastDay))?.id).toBe(fy2026)
      expect((await calculateDepreciationTable(companyId, undefined, lastDay)).fiscalYear?.id).toBe(fy2026)
      // 23:30 UTC on 31/12 is already 1 January in France
      expect((await resolveDashboardFiscalYear(companyId, null, new Date('2026-12-31T23:30:00Z')))?.year).toBe(2027)
    })

    it('never creates a year on a read (KLEDG-R3-QUAL-06)', async () => {
      const companyId = await company()
      const { getReconciliationOverview } = await import('@/lib/banking/get-reconciliation-overview.service')
      const { listAccounts } = await import('@/lib/accounting/manage-accounts.service')
      expect(await listAccounts(companyId)).toEqual([])
      const overview = await getReconciliationOverview(companyId, {})
      expect(overview.ledgerAccounts).toEqual([])
      await expect(utils.getFiscalYearForEntry(companyId, day('2026-05-01'))).rejects.toMatchObject({ statusCode: 409 })
      expect(await prisma.fiscalYear.count({ where: { companyId } })).toBe(0)
    })
  })

  describe('closed fiscal year lock (PCG art. 1031-4)', () => {
    beforeEach(async () => {
      const companyId = await company()
      const fy2024 = await fiscalYear(companyId, 2024, '2024-01-01', '2024-12-31')
      const fy2025 = await fiscalYear(companyId, 2025, '2025-01-01', '2025-12-31')
      const journal = await prisma.journal.create({ data: { companyId, code: 'OD', label: 'OD' } })
      const bank = await prisma.account.create({ data: { companyId, fiscalYearId: fy2024, code: '512000', label: 'Banque' } })
      const sales = await prisma.account.create({ data: { companyId, fiscalYearId: fy2024, code: '706000', label: 'Ventes' } })
      const entry = await lifecycle.createEntry({
        companyId,
        journalId: journal.id,
        date: '2024-06-01',
        description: 'Vente',
        status: 'validated',
        lines: [
          { accountId: bank.id, debit: '50.00', credit: 0 },
          { accountId: sales.id, debit: 0, credit: '50.00' },
        ],
      })
      await close(fy2024)
      Object.assign(ids, { company: companyId, fy2024, fy2025, journal: journal.id, bank: bank.id, sales: sales.id, entry: entry.id })
    })

    it('tells a closed year from an open one', async () => {
      expect(await lock.isFiscalYearClosed(ids.fy2024)).toBe(true)
      expect(await lock.isFiscalYearClosed(ids.fy2025)).toBe(false)
      expect(await lock.isFiscalYearClosed('missing')).toBe(false)
      await expect(lock.assertFiscalYearOpen(ids.fy2025)).resolves.toBeUndefined()
      await expect(lock.assertFiscalYearOpen(ids.fy2024)).rejects.toMatchObject({
        statusCode: 409,
        message: "L'exercice 2024 est clôturé : ses écritures ne peuvent plus être créées, modifiées ni supprimées. Passez la correction sur l'exercice ouvert.",
      })
    })

    it('refuses a date of a closed year and accepts a date of an open year or of no year', async () => {
      await expect(lock.assertDateInOpenFiscalYear(ids.company, day('2024-12-31'))).rejects.toMatchObject({ statusCode: 409 })
      await expect(lock.assertDateInOpenFiscalYear(ids.company, day('2025-01-01'))).resolves.toBeUndefined()
      await expect(lock.assertDateInOpenFiscalYear(ids.company, day('2023-06-01'))).resolves.toBeUndefined()
      await expect(lock.assertDateInOpenFiscalYear(ids.company, new Date('invalid'))).resolves.toBeUndefined()
    })

    it('locks the row in a transaction and reports its closed state, only for its company', async () => {
      const locked = await prisma.$transaction((tx) => lock.lockFiscalYearRow(tx, ids.fy2024, ids.company))
      expect(locked).toMatchObject({ id: ids.fy2024, year: 2024, isClosed: true, closed: true })
      expect(await prisma.$transaction((tx) => lock.lockFiscalYearRow(tx, ids.fy2025))).toMatchObject({ closed: false })
      expect(await prisma.$transaction((tx) => lock.lockFiscalYearRow(tx, ids.fy2024, 'other-company'))).toBeNull()
      expect(await prisma.$transaction((tx) => lock.lockFiscalYearRow(tx, 'missing'))).toBeNull()
    })

    it('refuses entries in the closed year through the service and in the database', async () => {
      // Service: a clear 409 before writing
      await expect(
        lifecycle.createEntry({
          companyId: ids.company,
          journalId: ids.journal,
          date: '2024-07-01',
          description: 'Correction',
          lines: [
            { accountId: ids.bank, debit: 1, credit: 0 },
            { accountId: ids.sales, debit: 0, credit: 1 },
          ],
        }),
      ).rejects.toMatchObject({ statusCode: 409 })

      // Database: a direct write is refused by the trigger, whatever the code path
      const direct = prisma.accountingEntry.create({
        data: { companyId: ids.company, journalId: ids.journal, fiscalYearId: ids.fy2024, entryNumber: 'BR-X', date: day('2024-07-01'), description: 'Direct' },
      })
      const error = await direct.then(() => null, (e: unknown) => e)
      expect(lock.isClosedFiscalYearDbError(error)).toBe(true)
      const { handleError } = await import('@/lib/accounting/errors')
      expect(handleError(error)).toMatchObject({ statusCode: 409, message: lock.CLOSED_FISCAL_YEAR_MESSAGE })

      // Reopening is refused too
      const reopen = await prisma.fiscalYear.update({ where: { id: ids.fy2024 }, data: { isClosed: false, closedAt: null } }).then(() => null, (e: unknown) => e)
      expect(lock.isClosedFiscalYearDbError(reopen)).toBe(true)
      expect(await prisma.accountingEntry.count({ where: { fiscalYearId: ids.fy2024 } })).toBe(1)
    })
  })

  describe('validateFiscalYearClosure', () => {
    const now = new Date('2026-02-15T10:00:00Z')

    async function setup() {
      const companyId = await company()
      const fy2025 = await fiscalYear(companyId, 2025, '2025-01-01', '2025-12-31')
      const journal = await prisma.journal.create({ data: { companyId, code: 'OD', label: 'OD' } })
      const account = async (code: string, fiscalYearId = fy2025) =>
        (await prisma.account.create({ data: { companyId, fiscalYearId, code, label: code } })).id
      return { companyId, fy2025, journal: journal.id, account }
    }

    const entry = (companyId: string, journalId: string, date: string, debitAccount: string, creditAccount: string, amount: string, status: 'draft' | 'validated' = 'validated') =>
      lifecycle.createEntry({
        companyId,
        journalId,
        date,
        description: 'Écriture',
        status,
        lines: [
          { accountId: debitAccount, debit: amount, credit: 0 },
          { accountId: creditAccount, debit: 0, credit: amount },
        ],
      })

    it('accepts a finished, clean year', async () => {
      const s = await setup()
      const bank = await s.account('512000')
      const sales = await s.account('706000')
      await entry(s.companyId, s.journal, '2025-05-01', bank, sales, '100.00')

      expect(await validateFiscalYearClosure(s.companyId, s.fy2025, prisma, now)).toEqual({ canClose: true, errors: [], warnings: [] })
    })

    it('reports a missing or already closed year', async () => {
      const s = await setup()
      expect(await validateFiscalYearClosure('other', s.fy2025, prisma, now)).toEqual({ canClose: false, errors: ['Exercice comptable non trouvé'], warnings: [] })
      await close(s.fy2025)
      expect(await validateFiscalYearClosure(s.companyId, s.fy2025, prisma, now)).toEqual({ canClose: false, errors: ['Cet exercice est déjà clôturé'], warnings: [] })
    })

    it('blocks a closing journal entry already in the year, and opening entries in the next year', async () => {
      const s = await setup()
      const fy2026 = await fiscalYear(s.companyId, 2026, '2026-01-01', '2026-12-31')
      const cl = await prisma.journal.create({ data: { companyId: s.companyId, code: 'CL', label: 'Clôture' } })
      const an = await prisma.journal.create({ data: { companyId: s.companyId, code: 'AN', label: 'À-nouveaux' } })
      await entry(s.companyId, cl.id, '2025-12-31', await s.account('120000'), await s.account('706000'), '10.00', 'draft')
      await entry(s.companyId, an.id, '2026-01-01', await s.account('512000', fy2026), await s.account('110000', fy2026), '10.00')

      const result = await validateFiscalYearClosure(s.companyId, s.fy2025, prisma, now)

      expect(result.canClose).toBe(false)
      expect(result.errors).toEqual([
        '1 écriture en brouillon doit être validée ou supprimée avant la clôture.',
        "L'exercice contient déjà 1 écriture du journal de clôture (CL) : supprimez-la avant de clôturer.",
        "L'exercice 2026 contient déjà 1 écriture d'à-nouveaux (journal AN) : supprimez-la pour que la clôture reporte les soldes.",
      ])
    })

    it('blocks when the next year is already closed', async () => {
      const s = await setup()
      const fy2026 = await fiscalYear(s.companyId, 2026, '2026-01-01', '2026-12-31')
      await close(fy2026)

      expect((await validateFiscalYearClosure(s.companyId, s.fy2025, prisma, now)).errors).toEqual(["L'exercice suivant (2026) est déjà clôturé."])
    })

    it('blocks entries dated outside the year bounds', async () => {
      const s = await setup()
      const bank = await s.account('512000')
      const sales = await s.account('706000')
      const outside = await entry(s.companyId, s.journal, '2025-12-31', bank, sales, '5.00')
      // Moved out by the year bounds changing afterwards (an older bug or a manual change)
      await prisma.fiscalYear.update({ where: { id: s.fy2025 }, data: { endDate: day('2025-12-30') } })

      const result = await validateFiscalYearClosure(s.companyId, s.fy2025, prisma, now)

      expect(outside.status).toBe('validated')
      expect(result.errors).toEqual(["1 écriture de l'exercice est datée hors de ses dates de début et de fin."])
    })

    it('warns about class 8 balances, which are not carried forward', async () => {
      const s = await setup()
      await entry(s.companyId, s.journal, '2025-06-01', await s.account('801000'), await s.account('802000'), '1500.50')

      const result = await validateFiscalYearClosure(s.companyId, s.fy2025, prisma, now)

      expect(result.canClose).toBe(true)
      expect(result.warnings).toEqual([
        "Le compte 801000 (classe 8) a un solde de 1 500,50 € : il n'est pas reporté sur l'exercice suivant.",
        "Le compte 802000 (classe 8) a un solde de -1 500,50 € : il n'est pas reporté sur l'exercice suivant.",
      ])
    })

    it('warns about the depreciation of the year that is not booked (PCG art. 214-13)', async () => {
      const s = await setup()
      await prisma.fixedAsset.create({
        data: {
          companyId: s.companyId,
          label: 'Ordinateur',
          acquisitionDate: day('2025-01-01'),
          acquisitionValue: '3000.00',
          depreciationDuration: 3,
          depreciationStartDate: day('2025-01-01'),
          assetAccountId: await s.account('218300'),
          depreciationAccountId: await s.account('281830'),
          expenseAccountId: await s.account('681120'),
        },
      })

      const result = await validateFiscalYearClosure(s.companyId, s.fy2025, prisma, now)

      expect(result.canClose).toBe(true)
      expect(result.warnings).toEqual([
        "1 dotation aux amortissements (1 000,00 €) n'est pas comptabilisée pour cet exercice. Générez-les depuis le tableau des amortissements avant de clôturer si elles ne sont pas déjà passées manuellement.",
      ])
    })
  })
})
