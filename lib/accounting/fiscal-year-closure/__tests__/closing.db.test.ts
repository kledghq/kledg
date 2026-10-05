/**
 * Fiscal year closing against PostgreSQL (lib/__tests__/helpers/test-db.ts):
 * closing entry to 120 / 129, à-nouveaux in the next year, statements of the
 * closed year, atomicity, idempotency, concurrent closings, the lock of the
 * closed year, and the depreciation entries. Skipped without the test
 * database.
 *
 * Sources: PCG art. 941-12 (result in 120 / 129 until its allocation),
 * Code de commerce art. L. 123-19 (opening balance sheet = closing balance
 * sheet of the previous year), PCG art. 1031-3 and 1031-4 (entries of a
 * closed period are definitive), PCG art. 214-13 and BOFiP
 * BOI-BIC-AMT-20-20-20-10 (depreciation prorata temporis).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const failures = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('closing')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  return { copyChart: false }
})

// Lets a test make the closing fail after its closing entry is written.
vi.mock('../ledger', async (importOriginal) => {
  const original = await importOriginal<typeof import('../ledger')>()
  return {
    ...original,
    copyChartOfAccounts: async (...args: Parameters<typeof original.copyChartOfAccounts>) => {
      if (failures.copyChart) throw new Error('simulated failure')
      return original.copyChartOfAccounts(...args)
    },
  }
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
let prisma: Prisma
let closeFiscalYear: typeof import('../close-fiscal-year.service').closeFiscalYear
let simulateFiscalYearClosure: typeof import('../simulate-fiscal-year-closure.service').simulateFiscalYearClosure
let generateBalanceSheet: typeof import('@/lib/reports/balance-sheet/generate-balance-sheet.service').generateBalanceSheet
let generateIncomeStatement: typeof import('@/lib/reports/income-statement/generate-income-statement.service').generateIncomeStatement
let generateDepreciationEntries: typeof import('@/lib/fixed-assets/depreciation-entries').generateDepreciationEntries
let handleError: typeof import('@/lib/accounting/errors').handleError
let deleteCompany: typeof import('@/lib/companies/archive-company.service').deleteCompany
let createEntry: typeof import('@/lib/accounting/services/entry-lifecycle.service').createEntry

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

const CHART: Array<[string, string]> = [
  ['101', 'Capital'],
  ['2183', 'Matériel de bureau et matériel informatique'],
  ['28183', 'Amortissements du matériel de bureau et informatique'],
  ['401', 'Fournisseurs'],
  ['411', 'Clients'],
  ['44566', 'TVA sur autres biens et services'],
  ['44571', 'TVA collectée'],
  ['512', 'Banques'],
  ['606', 'Achats non stockés de matières et fournitures'],
  ['6811', 'Dotations aux amortissements sur immobilisations'],
  ['706', 'Prestations de services'],
]

let seq = 0

interface Company {
  id: string
  fy2025: string
  accounts: Map<string, string>
  journals: Map<string, string>
}

async function createCompany(): Promise<Company> {
  seq += 1
  const company = await prisma.company.create({
    data: { name: `Société ${seq}`, slug: `societe-${seq}`, siren: String(100000000 + seq), closingDay: 31, closingMonth: 12 },
  })
  const fy = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') },
  })
  const accounts = new Map<string, string>()
  for (const [code, label] of CHART) {
    const a = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label, isPCG: true } })
    accounts.set(code, a.id)
  }
  const journals = new Map<string, string>()
  for (const code of ['VE', 'AC', 'BQ', 'OD', 'AN']) {
    const j = await prisma.journal.create({ data: { companyId: company.id, code, label: code } })
    journals.set(code, j.id)
  }
  return { id: company.id, fy2025: fy.id, accounts, journals }
}

/** Books an entry through the shared entry life cycle (draft, then validation and definitive number). */
async function book(
  c: Company,
  journal: string,
  date: string,
  lines: Array<[string, number, number]>,
  options: { status?: 'draft' | 'validated'; fiscalYearId?: string; accounts?: Map<string, string> } = {}
) {
  const accounts = options.accounts ?? c.accounts
  return createEntry({
    companyId: c.id,
    fiscalYearId: options.fiscalYearId ?? c.fy2025,
    journalId: c.journals.get(journal)!,
    date: day(date),
    description: `Écriture du ${date}`,
    status: options.status ?? 'validated',
    lines: lines.map(([code, debit, credit]) => ({ accountId: accounts.get(code)!, debit, credit })),
  })
}

/** Writes a draft directly in the database, past the application checks (to test the triggers). */
async function rawDraft(c: Company, date: string, lines: Array<[string, number, number]>) {
  const number = `BR-RAW-${Math.random().toString(36).slice(2)}`
  return prisma.accountingEntry.create({
    data: {
      companyId: c.id,
      fiscalYearId: c.fy2025,
      journalId: c.journals.get('OD')!,
      entryNumber: number,
      date: day(date),
      description: 'Brouillon direct',
      status: 'draft',
      lines: {
        create: lines.map(([code, debit, credit]) => ({
          account: { connect: { id_fiscalYearId: { id: c.accounts.get(code)!, fiscalYearId: c.fy2025 } } },
          debit,
          credit,
        })),
      },
    },
  })
}

/** 2025: capital 10 000, sales 12 000 HT, purchases 3 000 HT, a computer depreciated 400. */
async function bookYear(c: Company) {
  await book(c, 'BQ', '2025-01-02', [['512', 10000, 0], ['101', 0, 10000]])
  await book(c, 'VE', '2025-03-10', [['411', 14400, 0], ['706', 0, 12000], ['44571', 0, 2400]])
  await book(c, 'BQ', '2025-04-10', [['512', 14400, 0], ['411', 0, 14400]])
  await book(c, 'AC', '2025-06-01', [['606', 3000, 0], ['44566', 600, 0], ['401', 0, 3600]])
  await book(c, 'AC', '2025-07-01', [['2183', 2000, 0], ['401', 0, 2000]])
  // Dated 31/12: must stay in 2025 whatever the timezone.
  await book(c, 'OD', '2025-12-31', [['6811', 400, 0], ['28183', 0, 400]])
}
const RESULT_2025 = 12000 - 3000 - 400

describe.skipIf(!available)('fiscal year closing', () => {
  beforeAll(async () => {
    await prepareTestDatabase('closing')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ closeFiscalYear } = await import('../close-fiscal-year.service'))
    ;({ simulateFiscalYearClosure } = await import('../simulate-fiscal-year-closure.service'))
    ;({ generateBalanceSheet } = await import('@/lib/reports/balance-sheet/generate-balance-sheet.service'))
    ;({ generateIncomeStatement } = await import('@/lib/reports/income-statement/generate-income-statement.service'))
    ;({ generateDepreciationEntries } = await import('@/lib/fixed-assets/depreciation-entries'))
    ;({ handleError } = await import('@/lib/accounting/errors'))
    ;({ deleteCompany } = await import('@/lib/companies/archive-company.service'))
    ;({ createEntry } = await import('@/lib/accounting/services/entry-lifecycle.service'))
  })

  beforeEach(() => {
    failures.copyChart = false
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('books the result in 120, opens the next year with the closing balances and keeps the real figures', async () => {
    const c = await createCompany()
    await bookYear(c)

    const simulation = await simulateFiscalYearClosure(c.id, c.fy2025)
    expect(simulation.success).toBe(true)
    expect(simulation.simulation?.closingEntries.result).toMatchObject({ amount: RESULT_2025, accountCode: '120' })

    const result = await closeFiscalYear(c.id, c.fy2025, { userId: 'user-1' })
    expect(result).toMatchObject({ success: true, result: RESULT_2025 })

    const fy = await prisma.fiscalYear.findUniqueOrThrow({ where: { id: c.fy2025 } })
    expect(fy.isClosed).toBe(true)
    expect(fy.closedById).toBe('user-1')
    expect(fy.closedAt).toBeInstanceOf(Date)
    const next = await prisma.fiscalYear.findUniqueOrThrow({ where: { id: result.nextFiscalYearId! } })
    expect(next.year).toBe(2026)
    expect(next.startDate.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(next.endDate.toISOString()).toBe('2026-12-31T00:00:00.000Z')

    // Closing entry: CL journal on 31/12, classes 6 and 7 to zero, result in 120.
    const closing = await prisma.accountingEntry.findFirstOrThrow({
      where: { fiscalYearId: c.fy2025, journal: { code: 'CL' } },
      include: { lines: { include: { account: true } } },
    })
    expect(closing.date.toISOString()).toBe('2025-12-31T00:00:00.000Z')
    expect(closing.status).toBe('validated')
    const closingLine = (code: string) => closing.lines.find((l) => l.account.code === code)!
    expect(Number(closingLine('120').credit)).toBe(RESULT_2025)
    expect(Number(closingLine('706').debit)).toBe(12000)
    expect(Number(closingLine('606').credit)).toBe(3000)

    // Statements of the closed year: closing entry excluded, real result.
    for (const variant of ['simplified', 'complete'] as const) {
      const sheet = await generateBalanceSheet(c.id, c.fy2025, variant)
      const statement = await generateIncomeStatement(c.id, c.fy2025, variant)
      expect(statement.netResult).toBe(RESULT_2025)
      expect(sheet.netResult).toBe(RESULT_2025)
      expect(sheet.imbalance).toBeUndefined()
      expect(sheet.actifTotal).toBe(10000 + 14400 - 14400 + 14400 + 2000 - 400 + 600)
    }

    // Opening entry: AN journal on 01/01/2026, one line per balance sheet account.
    const opening = await prisma.accountingEntry.findFirstOrThrow({
      where: { fiscalYearId: next.id, journal: { code: 'AN' } },
      include: { lines: { include: { account: true } } },
    })
    expect(opening.date.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    const openingBalance = (code: string) => {
      const l = opening.lines.find((x) => x.account.code === code)
      return l ? Number(l.debit) - Number(l.credit) : 0
    }
    expect(openingBalance('512')).toBe(24400)
    expect(openingBalance('2183')).toBe(2000)
    expect(openingBalance('28183')).toBe(-400)
    expect(openingBalance('401')).toBe(-5600)
    expect(openingBalance('101')).toBe(-10000)
    expect(openingBalance('120')).toBe(-RESULT_2025)
    expect(opening.lines.some((l) => /^[67]/.test(l.account.code))).toBe(false)

    // 2026 opening balance sheet = 2025 closing balance sheet.
    const sheet2025 = await generateBalanceSheet(c.id, c.fy2025, 'complete')
    const sheet2026 = await generateBalanceSheet(c.id, next.id, 'complete')
    expect(sheet2026.actifTotal).toBe(sheet2025.actifTotal)
    expect(sheet2026.passifTotal).toBe(sheet2025.passifTotal)
    expect(sheet2026.netResult).toBe(0)
  })

  it('leaves the closing entry out of the FEC of the closed year (LPF art. A47 A-1)', async () => {
    // "hors écritures de centralisation et hors écritures de solde des comptes
    // de charges et de produits": the FEC of a closed year must still give the
    // result as the balance of classes 6 and 7.
    const c = await createCompany()
    await bookYear(c)
    expect((await closeFiscalYear(c.id, c.fy2025)).success).toBe(true)
    const { exportFec } = await import('@/lib/fec/export')
    const { validateFec } = await import('@/lib/fec/validator')
    const fec = await exportFec(c.id, c.fy2025)
    const rows = fec.content.trim().split('\r\n').slice(1).map((row) => row.split('\t'))
    expect(rows.some((r) => r[0] === 'CL')).toBe(false)
    const cents = (v: string) => Math.round(Number(v.replace(',', '.')) * 100)
    const result = rows.filter((r) => /^[67]/.test(r[4])).reduce((sum, r) => sum + cents(r[12]) - cents(r[11]), 0)
    expect(result).toBe(RESULT_2025 * 100)
    const report = validateFec(fec.content, { fileName: fec.fileName, closingDate: '20251231' })
    expect(report.errors).toEqual([])
    expect(report.warnings).toEqual([])
  })

  it('is idempotent: a second closing changes nothing', async () => {
    const c = await createCompany()
    await bookYear(c)
    expect((await closeFiscalYear(c.id, c.fy2025)).success).toBe(true)
    const entries = await prisma.accountingEntry.count({ where: { companyId: c.id } })

    const again = await closeFiscalYear(c.id, c.fy2025)
    expect(again).toMatchObject({ success: false, alreadyClosed: true })
    expect(await prisma.accountingEntry.count({ where: { companyId: c.id } })).toBe(entries)
  })

  it('closes once when several closings run at the same time', async () => {
    const c = await createCompany()
    await bookYear(c)
    const results = await Promise.all([1, 2, 3, 4].map(() => closeFiscalYear(c.id, c.fy2025)))
    expect(results.filter((r) => r.success)).toHaveLength(1)
    expect(results.filter((r) => r.alreadyClosed)).toHaveLength(3)
    expect(await prisma.accountingEntry.count({ where: { companyId: c.id, journal: { code: 'CL' } } })).toBe(1)
    expect(await prisma.accountingEntry.count({ where: { companyId: c.id, journal: { code: 'AN' } } })).toBe(1)
    expect(await prisma.fiscalYear.count({ where: { companyId: c.id } })).toBe(2)
  })

  it('writes nothing when the closing fails half way', async () => {
    const c = await createCompany()
    await bookYear(c)
    failures.copyChart = true
    const result = await closeFiscalYear(c.id, c.fy2025)
    expect(result.success).toBe(false)
    expect(await prisma.accountingEntry.count({ where: { companyId: c.id, journal: { code: 'CL' } } })).toBe(0)
    expect(await prisma.fiscalYear.count({ where: { companyId: c.id } })).toBe(1)
    expect((await prisma.fiscalYear.findUniqueOrThrow({ where: { id: c.fy2025 } })).isClosed).toBe(false)
  })

  it('books a loss in 129', async () => {
    const c = await createCompany()
    await book(c, 'BQ', '2025-01-02', [['512', 1000, 0], ['101', 0, 1000]])
    await book(c, 'AC', '2025-05-02', [['606', 700, 0], ['512', 0, 700]])
    const result = await closeFiscalYear(c.id, c.fy2025)
    expect(result).toMatchObject({ success: true, result: -700 })
    const line = await prisma.entryLine.findFirstOrThrow({
      where: { accountingEntry: { fiscalYearId: c.fy2025, journal: { code: 'CL' } }, account: { code: '129' } },
    })
    expect(Number(line.debit)).toBe(700)
    const sheet = await generateBalanceSheet(c.id, c.fy2025, 'simplified')
    expect(sheet.netResult).toBe(-700)
    expect(sheet.imbalance).toBeUndefined()
  })

  it('refuses to close with draft entries or an earlier open year', async () => {
    const c = await createCompany()
    await bookYear(c)
    await book(c, 'OD', '2025-08-01', [['606', 10, 0], ['401', 0, 10]], { status: 'draft' })
    const drafts = await closeFiscalYear(c.id, c.fy2025)
    expect(drafts.success).toBe(false)
    expect(drafts.errors?.join(' ')).toMatch(/brouillon/)

    const d = await createCompany()
    await prisma.fiscalYear.create({
      data: { companyId: d.id, year: 2024, startDate: day('2024-01-01'), endDate: day('2024-12-31') },
    })
    const earlier = await closeFiscalYear(d.id, d.fy2025)
    expect(earlier.success).toBe(false)
    expect(earlier.errors?.join(' ')).toMatch(/2024 doit être clôturé/)
  })

  it('refuses to close a year that is not over', async () => {
    const c = await createCompany()
    const future = await prisma.fiscalYear.create({
      data: { companyId: c.id, year: 2099, startDate: day('2099-01-01'), endDate: day('2099-12-31') },
    })
    await prisma.fiscalYear.update({ where: { id: c.fy2025 }, data: { isClosed: true } })
    const result = await closeFiscalYear(c.id, future.id)
    expect(result.success).toBe(false)
    expect(result.errors?.join(' ')).toMatch(/après sa date de fin \(31\/12\/2099\)/)
  })

  it('locks the closed year in the database', async () => {
    const c = await createCompany()
    await bookYear(c)
    const anEntry = await prisma.accountingEntry.findFirstOrThrow({ where: { fiscalYearId: c.fy2025 }, include: { lines: true } })
    expect((await closeFiscalYear(c.id, c.fy2025)).success).toBe(true)

    const refused = async (write: () => Promise<unknown>) => {
      const error = await write().then(() => null, (e: unknown) => e)
      expect(error).not.toBeNull()
      expect(handleError(error).statusCode).toBe(409)
    }
    await refused(() => book(c, 'OD', '2025-06-30', [['606', 1, 0], ['512', 0, 1]]))
    await refused(() => rawDraft(c, '2025-06-30', [['606', 1, 0], ['512', 0, 1]]))
    await refused(() => prisma.entryLine.update({ where: { id: anEntry.lines[0].id }, data: { debit: 1 } }))
    await refused(() => prisma.accountingEntry.update({ where: { id: anEntry.id }, data: { date: day('2025-06-15') } }))
    await refused(() => prisma.accountingEntry.update({ where: { id: anEntry.id }, data: { status: 'draft' } }))
    await refused(() => prisma.accountingEntry.delete({ where: { id: anEntry.id } }))
    await refused(() => prisma.fiscalYear.update({ where: { id: c.fy2025 }, data: { isClosed: false } }))
    await refused(() => prisma.fiscalYear.update({ where: { id: c.fy2025 }, data: { endDate: day('2025-11-30') } }))
    await refused(() => prisma.fiscalYear.delete({ where: { id: c.fy2025 } }))

    // The open year still accepts entries; the company keeps its books 10 years
    // (Code de commerce art. L123-22): it can be archived, never deleted.
    const next = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: c.id, year: 2026 } })
    const accounts2026 = new Map(
      (await prisma.account.findMany({ where: { fiscalYearId: next.id } })).map((a) => [a.code, a.id])
    )
    await book(c, 'OD', '2026-02-01', [['606', 5, 0], ['512', 0, 5]], { fiscalYearId: next.id, accounts: accounts2026 })
    await refused(() => deleteCompany(c.id, { id: 'u-admin', email: 'admin@test.local' }))
    await refused(() => prisma.company.delete({ where: { id: c.id } }))
    expect(await prisma.fiscalYear.count({ where: { companyId: c.id } })).toBe(2)
  })

  it('keeps 31/12 in its year whatever the server timezone', async () => {
    const c = await createCompany()
    await bookYear(c)
    const original = process.env.TZ
    try {
      for (const zone of ['Pacific/Kiritimati', 'America/Los_Angeles']) {
        process.env.TZ = zone
        const statement = await generateIncomeStatement(c.id, c.fy2025, 'complete')
        expect(statement.netResult, zone).toBe(RESULT_2025)
      }
      process.env.TZ = 'America/Los_Angeles'
      expect((await closeFiscalYear(c.id, c.fy2025)).result).toBe(RESULT_2025)
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })
})

describe.skipIf(!available)('depreciation entries', () => {
  async function companyWithAsset() {
    const c = await createCompany()
    await prisma.fixedAsset.create({
      data: {
        companyId: c.id,
        label: 'Ordinateur',
        acquisitionDate: day('2025-07-01'),
        acquisitionValue: 3650,
        amortizableAmount: 3650,
        depreciationDuration: 5,
        depreciationMethod: 'linear',
        depreciationStartDate: day('2025-07-01'),
        assetAccountId: c.accounts.get('2183')!,
        depreciationAccountId: c.accounts.get('28183')!,
        expenseAccountId: c.accounts.get('6811')!,
      },
    })
    return c
  }

  it('books the allowance of the year once, prorata temporis', async () => {
    const c = await companyWithAsset()
    const first = await generateDepreciationEntries(c.id, c.fy2025)
    // 3650 x 20 % x 184 / 365 days = 368.00
    expect(first).toMatchObject({ count: 1, totalCents: 36800 })
    const entry = await prisma.accountingEntry.findUniqueOrThrow({
      where: { id: first.entries[0].entryId },
      include: { lines: { include: { account: true } }, journal: true },
    })
    expect(entry.journal.code).toBe('OD')
    expect(entry.date.toISOString()).toBe('2025-12-31T00:00:00.000Z')
    expect(entry.lines.map((l) => [l.account.code, Number(l.debit), Number(l.credit)])).toEqual([
      ['6811', 368, 0],
      ['28183', 0, 368],
    ])
    const record = await prisma.fixedAssetDepreciation.findFirstOrThrow({ where: { fiscalYearId: c.fy2025 } })
    expect(record.accountingEntryId).toBe(entry.id)
    expect(Number(record.amount)).toBe(368)

    expect(await generateDepreciationEntries(c.id, c.fy2025)).toMatchObject({ count: 0 })
  })

  it('books once when generated twice at the same time', async () => {
    const c = await companyWithAsset()
    const results = await Promise.all([1, 2, 3].map(() => generateDepreciationEntries(c.id, c.fy2025)))
    expect(results.reduce((s, r) => s + r.count, 0)).toBe(1)
    expect(await prisma.accountingEntry.count({ where: { companyId: c.id, journal: { code: 'OD' } } })).toBe(1)
  })

  it('refuses to delete an asset whose depreciation is booked, until it is reversed', async () => {
    const { deleteFixedAsset } = await import('@/lib/fixed-assets/delete-fixed-asset.service')
    const { reverseEntry } = await import('@/lib/accounting/services/entry-lifecycle.service')
    const c = await companyWithAsset()
    const asset = await prisma.fixedAsset.findFirstOrThrow({ where: { companyId: c.id } })
    const booked = await generateDepreciationEntries(c.id, c.fy2025)
    const error = await deleteFixedAsset(c.id, asset.id).then(() => null, (e: unknown) => e)
    expect(handleError(error).statusCode).toBe(409)
    expect(handleError(error).message).toMatch(/contre-passez/)
    expect(await prisma.fixedAsset.count({ where: { id: asset.id } })).toBe(1)

    await reverseEntry(c.id, booked.entries[0].entryId)
    expect(await deleteFixedAsset(c.id, asset.id)).toBe(0)
    expect(await prisma.fixedAsset.count({ where: { id: asset.id } })).toBe(0)
  })

  it('is refused on a closed year', async () => {
    const c = await companyWithAsset()
    await book(c, 'BQ', '2025-01-02', [['512', 1000, 0], ['101', 0, 1000]])
    expect((await closeFiscalYear(c.id, c.fy2025)).success).toBe(true)
    const error = await generateDepreciationEntries(c.id, c.fy2025).then(() => null, (e: unknown) => e)
    expect(handleError(error).statusCode).toBe(409)
  })
})

describe.skipIf(!available)('general ledger and trial balance', () => {
  let getLedger: typeof import('@/lib/reports/ledger/ledger.service').getLedger
  let getTrialBalanceFor: typeof import('@/lib/reports/trial-balance/get-trial-balance.service').getTrialBalanceFor

  beforeAll(async () => {
    ;({ getLedger } = await import('@/lib/reports/ledger/ledger.service'))
    ;({ getTrialBalanceFor } = await import('@/lib/reports/trial-balance/get-trial-balance.service'))
  })

  it('brings forward the opening balances and agrees with the balance', async () => {
    const c = await createCompany()
    await bookYear(c)
    const closing = await closeFiscalYear(c.id, c.fy2025)
    const next = closing.nextFiscalYearId!
    const accounts2026 = new Map(
      (await prisma.account.findMany({ where: { fiscalYearId: next } })).map((a) => [a.code, a.id])
    )
    const in2026 = { fiscalYearId: next, accounts: accounts2026 }
    await book(c, 'VE', '2026-01-15', [['411', 1200, 0], ['706', 0, 1000], ['44571', 0, 200]], in2026)
    await book(c, 'BQ', '2026-02-10', [['512', 1200, 0], ['411', 0, 1200]], in2026)

    // Whole year: the AN entry is the opening balance, not a movement.
    const year = await getLedger({ companyId: c.id, fiscalYearId: next, withLines: true })
    const bank = year.accounts.find((a) => a.account.code === '512')!
    expect(bank.opening.balance).toBe(24400)
    expect(bank.movements).toEqual({ debit: 1200, credit: 0 })
    expect(bank.closing.balance).toBe(25600)
    expect(bank.lines.map((l) => l.runningBalance)).toEqual([25600])
    expect(year.accounts.find((a) => a.account.code === '120')!.opening.credit).toBe(RESULT_2025)

    // February: January's entries join the opening balance.
    const february = await getLedger({
      companyId: c.id,
      startDate: day('2026-02-01'),
      endDate: day('2026-02-28'),
      withLines: true,
    })
    const customers = february.accounts.find((a) => a.account.code === '411')!
    expect(customers.opening.balance).toBe(1200)
    expect(customers.movements).toEqual({ debit: 0, credit: 1200 })
    expect(customers.closing.balance).toBe(0)
    expect(february.accounts.find((a) => a.account.code === '706')!.movements).toEqual({ debit: 0, credit: 0 })

    for (const ledger of [year, february]) {
      // Balanced: opening, movements and closing totals.
      expect(ledger.totals.opening.debit).toBe(ledger.totals.opening.credit)
      expect(ledger.totals.movements.debit).toBe(ledger.totals.movements.credit)
      expect(ledger.totals.closing.debit).toBe(ledger.totals.closing.credit)
      for (const a of ledger.accounts) {
        expect(Math.round((a.opening.balance + a.movements.debit - a.movements.credit) * 100), a.account.code).toBe(
          Math.round(a.closing.balance * 100)
        )
      }
      // The balance shows the same figures as the ledger.
      const balance = await getTrialBalanceFor({
        companyId: c.id,
        startDate: new Date(ledger.period.startDate),
        endDate: new Date(ledger.period.endDate),
      })
      expect(balance.totals.opening).toEqual(ledger.totals.opening)
      expect(balance.totals.movements).toEqual(ledger.totals.movements)
      expect(balance.totals.closing).toEqual(ledger.totals.closing)
      for (const row of balance.balances) {
        const a = ledger.accounts.find((x) => x.account.id === row.accountId)!
        expect(row.balance).toBe(a.closing.balance)
        expect(row.movementDebit).toBe(a.movements.debit)
      }
    }

    // The 2026 opening balances are the 2025 balances after closing.
    const end2025 = await getTrialBalanceFor({ companyId: c.id, fiscalYearId: c.fy2025 })
    for (const row of year.accounts.filter((a) => /^[1-5]/.test(a.account.code))) {
      const before = end2025.balances.find((b) => b.code === row.account.code)
      expect(row.opening.balance, row.account.code).toBe(before?.balance ?? 0)
    }
  })
})

describe.skipIf(!available)('stored statement layouts', () => {
  it('recognizes the stored default layouts and upgrades an untouched previous default once', async () => {
    const { createDefaultBalanceSheetConfig } = await import('@/lib/reports/balance-sheet/config/create-default-pcg-config.service')
    const { createDefaultIncomeStatementConfig } = await import('@/lib/reports/income-statement/config/create-default-pcg-config.service')
    const { PREVIOUS_DEFAULT_FINGERPRINTS, upgradeLayoutIfUntouched } = await import('@/lib/reports/statements/layout-upgrade')
    const { layoutFingerprint } = await import('@/lib/reports/statements/layout-fingerprint')
    const c = await createCompany()

    // The rows createDefault*Config stores have the fingerprint of the default entries.
    for (const variant of ['complete', 'simplified'] as const) {
      await createDefaultBalanceSheetConfig(c.id, variant)
      await createDefaultIncomeStatementConfig(c.id, variant)
      expect(await upgradeLayoutIfUntouched(c.id, 'balance-sheet', variant)).toBe('default')
      expect(await upgradeLayoutIfUntouched(c.id, 'income-statement', variant)).toBe('default')
    }

    // A previous default (here: 646 missing from "Cotisations sociales") is replaced.
    const line = await prisma.incomeStatementLineConfig.findFirstOrThrow({
      where: { companyId: c.id, reportVariant: 'complete', lineLabel: 'Cotisations sociales' },
    })
    await prisma.incomeStatementLineConfig.update({ where: { id: line.id }, data: { accountCodes: ['645', '647'] } })
    const old = layoutFingerprint(
      await prisma.incomeStatementLineConfig.findMany({ where: { companyId: c.id, reportVariant: 'complete' } })
    )
    PREVIOUS_DEFAULT_FINGERPRINTS['income-statement:complete'].push(old)
    const count = await prisma.incomeStatementLineConfig.count({ where: { companyId: c.id, reportVariant: 'complete' } })
    const statuses = await Promise.all([1, 2, 3].map(() => upgradeLayoutIfUntouched(c.id, 'income-statement', 'complete')))
    expect(new Set(statuses)).toEqual(new Set(['upgraded']))
    expect(await prisma.incomeStatementLineConfig.count({ where: { companyId: c.id, reportVariant: 'complete' } })).toBe(count)
    expect(await upgradeLayoutIfUntouched(c.id, 'income-statement', 'complete')).toBe('default')

    // A layout the user changed is kept.
    const label = await prisma.balanceSheetLineConfig.findFirstOrThrow({ where: { companyId: c.id, reportVariant: 'simplified' } })
    await prisma.balanceSheetLineConfig.update({ where: { id: label.id }, data: { lineLabel: 'Ma ligne' } })
    expect(await upgradeLayoutIfUntouched(c.id, 'balance-sheet', 'simplified')).toBe('customized')
    expect(await prisma.balanceSheetLineConfig.count({ where: { companyId: c.id, lineLabel: 'Ma ligne' } })).toBe(1)
  })
})

describe.skipIf(!available)('result allocation (affectation du résultat)', () => {
  let allocateResult: typeof import('@/lib/accounting/result-allocation/allocate-result.service').allocateResult

  beforeAll(async () => {
    ;({ allocateResult } = await import('@/lib/accounting/result-allocation/allocate-result.service'))
  })

  async function closedSas() {
    const c = await createCompany()
    await prisma.company.update({ where: { id: c.id }, data: { legalType: 'SAS' } })
    await bookYear(c)
    const closing = await closeFiscalYear(c.id, c.fy2025)
    return { c, next: closing.nextFiscalYearId! }
  }

  it('books the legal reserve, dividends and report à nouveau once (L. 232-10, L. 232-11)', async () => {
    const { c, next } = await closedSas()
    const input = { date: '2026-06-15', dividendsCents: 500_000, otherReservesCents: 0 }
    const results = await Promise.allSettled([1, 2, 3].map(() => allocateResult(c.id, next, input)))
    const done = results.filter((r) => r.status === 'fulfilled')
    expect(done).toHaveLength(1)
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect(handleError((r as PromiseRejectedResult).reason).statusCode).toBe(409)
    }

    const entry = await prisma.accountingEntry.findFirstOrThrow({
      where: { fiscalYearId: next, reference: 'AFF-2025' },
      include: { lines: { include: { account: true } } },
    })
    expect(entry.status).toBe('validated')
    expect(entry.date.toISOString()).toBe('2026-06-15T00:00:00.000Z')
    const amounts = Object.fromEntries(
      entry.lines.map((l) => [l.account.code, Number(l.debit) - Number(l.credit)])
    )
    // Profit 8 600: 5 % = 430 to the legal reserve (capital 10 000, ceiling 1 000).
    expect(amounts).toEqual({ '120': 8600, '1061': -430, '457': -5000, '110': -3170 })

    // The balance sheet of 2026 no longer carries the 2025 result.
    const sheet = await generateBalanceSheet(c.id, next, 'simplified')
    expect(sheet.imbalance).toBeUndefined()
    const again = await allocateResult(c.id, next, input).then(() => null, (e: unknown) => e)
    expect(handleError(again).message).toMatch(/déjà été affecté/)
  })

  it('refuses dividends above the distributable profit', async () => {
    const { c, next } = await closedSas()
    const error = await allocateResult(c.id, next, { date: '2026-06-15', dividendsCents: 900_000, otherReservesCents: 0 }).then(
      () => null,
      (e: unknown) => e
    )
    expect(handleError(error).statusCode).toBe(400)
    expect(handleError(error).message).toMatch(/distribuable/)
    expect(await prisma.accountingEntry.count({ where: { fiscalYearId: next, reference: 'AFF-2025' } })).toBe(0)
  })
})
