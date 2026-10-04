/**
 * Differential test of the SQL aggregates (lib/reports/ledger/aggregate.ts and
 * the reports built on them) against the line by line implementations they
 * replaced (helpers/line-by-line-reference.ts), on the same generated books
 * (scripts/bench/dataset.ts) plus edge cases: closing entries by journal and by
 * "CL-" reference, an opening entry (AN) in the middle of a year, entries on
 * period boundaries, an unbalanced validated entry, a line with both a debit
 * and a credit, one cent and near-maximum amounts, drafts.
 *
 * Runs with the Node process in America/Los_Angeles and the PostgreSQL
 * session in Pacific/Kiritimati: calendar days must not move with either
 * timezone (docs/conventions.md, Dates).
 *
 * Skipped when the test PostgreSQL server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  process.env.TZ = 'America/Los_Angeles'
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('aggregate_differential')
})

import { Client } from 'pg'
import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { FIRST_YEAR, MAIN_COMPANY_ID, seedDataset, type Profile } from '@/scripts/bench/dataset'
import * as ref from './helpers/line-by-line-reference'

const available = await testDatabaseAvailable()

const PROFILE: Profile = {
  name: 'differential',
  main: { years: 3, entriesPerYear: 1200, transactionsPerYear: 900 },
  others: { count: 2, years: 2, entriesPerYear: 150, transactionsPerYear: 100 },
}
const company = MAIN_COMPANY_ID
const YEARS = [FIRST_YEAR, FIRST_YEAR + 1, FIRST_YEAR + 2]
const OPEN_YEAR = FIRST_YEAR + 2
const fy = (year: number) => `${company}_fy${year}`
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const cents = (n: number) => Math.round(n * 100)

let prisma: typeof import('@/lib/prisma').prisma
let balances: typeof import('@/lib/reports/account-balances')
let ledger: typeof import('@/lib/reports/ledger/ledger.service')
let dashboard: typeof import('@/lib/reports/dashboard')
let treasury: typeof import('@/lib/reports/treasury-evolution')
let journal: typeof import('@/lib/reports/journal/get-journal-report.service')
let fec: typeof import('@/lib/fec/export')
let load: typeof import('@/lib/reports/statements/load')

/** Edge cases on top of the generated books (triggers off: the data is written as is). */
async function addEdgeCases(url: string) {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    await client.query('SET session_replication_role = replica')
    const year = OPEN_YEAR
    const fyId = fy(year)
    const acc = (code: string) => `${fyId}_a${code}`
    const entries: Array<[string, string, string, string, string | null, string, Array<[string, string, string]>]> = [
      // id, number, date, journal, reference, status, lines [account, debit, credit]
      ['edge_cl_ref', '900001', `${year}-03-15`, 'OD', 'CL-ADJUST', 'validated', [['606100', '125.37', '0'], ['512000', '0', '125.37']]],
      ['edge_an_mid', '900002', `${year}-05-10`, 'AN', 'AN-EXTRA', 'validated', [['512000', '0.01', '0'], ['101000', '0', '0.01']]],
      ['edge_h1_end', '900003', `${year}-06-30`, 'VE', null, 'validated', [['411000', '1200.00', '0'], ['706000', '0', '1200.00']]],
      ['edge_h2_start', '900004', `${year}-07-01`, 'VE', null, 'validated', [['411000', '9999999999.99', '0'], ['706000', '0', '9999999999.99']]],
      ['edge_both_sides', '900005', `${year}-07-01`, 'OD', null, 'validated', [['627000', '10.00', '3.33'], ['512000', '0', '6.67']]],
      ['edge_unbalanced', '900006', `${year}-08-01`, 'OD', null, 'validated', [['626000', '50.00', '0'], ['512000', '0', '49.99']]],
      ['edge_draft', 'BR-EDGE', `${year}-07-01`, 'OD', null, 'draft', [['626000', '70.00', '0'], ['512000', '0', '70.00']]],
      ['edge_dec31', '900007', `${year}-12-31`, 'AC', null, 'validated', [['607000', '0.99', '0'], ['401000', '0', '0.99']]],
    ]
    for (const [id, number, date, j, reference, status, lines] of entries) {
      await client.query(
        `INSERT INTO "accounting_entries" ("id", "entryNumber", "date", "journalId", "companyId", "fiscalYearId", "reference", "status", "createdAt", "updatedAt")
         VALUES ($1, $2, $3::timestamp, $4, $5, $6, $7, $8, now(), now())`,
        [id, number, `${date} 00:00:00`, `${company}_j${j}`, company, fyId, reference, status],
      )
      for (const [i, [code, debit, credit]] of lines.entries()) {
        await client.query(
          `INSERT INTO "entry_lines" ("id", "accountingEntryId", "accountingEntryNumber", "accountId", "accountFiscalYearId", "debit", "credit", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, now() + ($8 || ' ms')::interval, now())`,
          [`${id}_l${i}`, id, number, acc(code), fyId, debit, credit, String(i)],
        )
      }
    }
    // Bank transactions on the window boundaries
    for (const [id, date, side, amount] of [
      ['edge_t1', `${year}-01-01 00:00:00`, 'credit', '0.01'],
      ['edge_t2', `${year - 1}-12-31 00:00:00`, 'debit', '12345.67'],
      ['edge_t3', `${year}-12-31 00:00:00`, 'credit', '999.99'],
    ]) {
      await client.query(
        `INSERT INTO "bank_transactions" ("id", "bankAccountId", "externalTransactionId", "amount", "date", "side", "createdAt", "updatedAt")
         VALUES ($1, $2, $1, $3::numeric, $4::timestamp, $5, now(), now())`,
        [id, `${company}_ba`, amount, date, side],
      )
    }
    await client.query('SET session_replication_role = origin')
    // The database session timezone must not matter (timestamp columns hold UTC).
    await client.query(`ALTER DATABASE "${new URL(url).pathname.slice(1)}" SET timezone = 'Pacific/Kiritimati'`)
  } finally {
    await client.end()
  }
}

/** Ledger without line order ties: lines compared as a set (running balances checked separately). */
function comparableLedger(report: Awaited<ReturnType<typeof ref.referenceLedger>>) {
  return {
    ...report,
    accounts: report.accounts.map((a) => ({
      ...a,
      lines: [...a.lines].map(({ runningBalance: _r, ...line }) => line).sort((x, y) => x.id.localeCompare(y.id)), // eslint-disable-line @typescript-eslint/no-unused-vars
    })),
  }
}

describe.skipIf(!available)('SQL aggregates match the line by line reports', () => {
  beforeAll(async () => {
    const url = await prepareTestDatabase('aggregate_differential')
    await seedDataset(url, PROFILE)
    await addEdgeCases(url)
    ;({ prisma } = await import('@/lib/prisma'))
    balances = await import('@/lib/reports/account-balances')
    ledger = await import('@/lib/reports/ledger/ledger.service')
    dashboard = await import('@/lib/reports/dashboard')
    treasury = await import('@/lib/reports/treasury-evolution')
    journal = await import('@/lib/reports/journal/get-journal-report.service')
    fec = await import('@/lib/fec/export')
    load = await import('@/lib/reports/statements/load')
    // A new connection picks up the database timezone set by addEdgeCases.
    const [{ timezone }] = await prisma.$queryRaw<Array<{ timezone: string }>>`SELECT current_setting('TimeZone') AS timezone`
    expect(timezone).toBe('Pacific/Kiritimati')
  }, 120_000)

  afterAll(async () => {
    if (prisma) await prisma.$disconnect()
  })

  it('account balances (statements): every year, with and without closing entries, full year and partial periods', async () => {
    for (const year of YEARS) {
      const periods = [
        undefined,
        { startDate: day(`${year}-01-01`), endDate: day(`${year}-12-31`) },
        { startDate: day(`${year}-07-01`), endDate: day(`${year}-12-31`) },
        { startDate: day(`${year}-06-30`), endDate: day(`${year}-07-01`) },
      ]
      for (const period of periods) {
        for (const excludeClosing of [false, true]) {
          const expected = await ref.referenceAccountBalances(company, period, fy(year), excludeClosing)
          const actual = await balances.getAllAccountBalances(company, period, fy(year), excludeClosing)
          expect(actual, `${year} ${JSON.stringify(period)} ${excludeClosing}`).toEqual(expected)
        }
      }
      // Fiscal year found from the period
      const period = { startDate: day(`${year}-02-01`), endDate: day(`${year}-02-28`) }
      expect(await balances.getAllAccountBalances(company, period)).toEqual(await ref.referenceAccountBalances(company, period))
    }
    const nonZero = (await balances.getAllAccountBalances(company, undefined, fy(OPEN_YEAR))).filter((b) => b.debit || b.credit)
    expect(nonZero.length).toBeGreaterThan(10)
  })

  it('single account balance', async () => {
    const accountId = `${fy(OPEN_YEAR)}_a512000`
    const all = await ref.referenceAccountBalances(company, undefined, fy(OPEN_YEAR))
    expect(await balances.getAccountBalance(company, accountId)).toBe(all.find((b) => b.accountId === accountId)!.balance)
  })

  it('trial balance and grand livre: opening balances, movements, closing, lines', async () => {
    for (const year of YEARS) {
      const queries = [
        { companyId: company, fiscalYearId: fy(year) },
        { companyId: company, startDate: day(`${year}-07-01`), endDate: day(`${year}-12-31`) },
        { companyId: company, startDate: day(`${year}-06-30`), endDate: day(`${year}-06-30`) },
        { companyId: company, startDate: day(`${year}-07-01`), endDate: day(`${year}-07-01`) },
      ]
      for (const query of queries) {
        for (const withLines of [false, true]) {
          const expected = await ref.referenceLedger({ ...query, withLines })
          const actual = await ledger.getLedger({ ...query, withLines })
          expect(comparableLedger(actual), `${year} ${JSON.stringify(query)} ${withLines}`).toEqual(comparableLedger(expected))
          if (withLines) {
            for (const account of actual.accounts) {
              const last = account.lines[account.lines.length - 1]
              if (last) expect(cents(last.runningBalance)).toBe(cents(account.closing.balance))
            }
          }
        }
      }
    }
  })

  it('dashboard: revenue, expenses and monthly figures to the cent', async () => {
    const fiscalYear = await prisma.fiscalYear.findUniqueOrThrow({ where: { id: fy(OPEN_YEAR) } })
    for (const months of [1, 3, 6, 12]) {
      const window = dashboard.getDashboardWindow(fiscalYear, months)
      const stats = await dashboard.getDashboardStats(company, window)
      const expected = await ref.referenceClassTotals(company, window.start, window.end)
      expect(cents(stats.totalRevenue)).toBe(cents(expected.revenue))
      expect(cents(stats.totalExpenses)).toBe(cents(expected.expenses))
      const monthly = await dashboard.getMonthlyData(company, window)
      const expectedMonthly = await ref.referenceMonthlyData(company, window)
      expect(monthly.map((m) => [m.month, cents(m.revenue), cents(m.expenses)])).toEqual(
        expectedMonthly.map((m) => [m.month, cents(m.revenue), cents(m.expenses)]),
      )
    }
    // A window across two fiscal years (the previous window of the dashboard)
    const across = { start: day(`${OPEN_YEAR - 1}-10-01`), end: new Date(Date.UTC(OPEN_YEAR, 2, 31, 23, 59, 59, 999)) }
    const expected = await ref.referenceClassTotals(company, across.start, across.end)
    const months = Array.from({ length: 6 }, (_, i) => ({ year: OPEN_YEAR - 1 + Math.floor((9 + i) / 12), month: (9 + i) % 12 }))
    const stats = await dashboard.getDashboardStats(company, { ...across, months })
    expect(cents(stats.totalRevenue)).toBe(cents(expected.revenue))
    expect(cents(stats.totalExpenses)).toBe(cents(expected.expenses))
  })

  it('treasury evolution: balance before the window, monthly flows, cumulative', async () => {
    const fiscalYear = await prisma.fiscalYear.findUniqueOrThrow({ where: { id: fy(OPEN_YEAR) } })
    for (const months of [1, 12]) {
      const window = dashboard.getDashboardWindow(fiscalYear, months)
      const actual = await treasury.getTreasuryEvolutionFromTransactions(company, window)
      const expected = await ref.referenceTreasury(company, window)
      const view = (rows: typeof actual) => rows.map((r) => [r.month, cents(r.inflows), cents(r.outflows), cents(r.cumulative)])
      expect(view(actual)).toEqual(view(expected))
    }
  })

  it('journal report: entries, lines and totals per journal', async () => {
    const journals = await prisma.journal.findMany({ where: { companyId: company }, select: { id: true } })
    for (const year of YEARS) {
      const params = [
        { companyId: company, journalId: 'all', startDate: day(`${year}-01-01`), endDate: day(`${year}-12-31`) },
        { companyId: company, journalId: journals[0].id, startDate: day(`${year}-06-30`), endDate: day(`${year}-07-01`) },
        { companyId: company, journalId: null },
      ]
      for (const p of params) {
        const view = (report: Awaited<ReturnType<typeof journal.getJournalReport>>) => ({
          journals: report.journals.map((j) => ({
            journal: j.journal,
            totals: [cents(j.totals.debit), cents(j.totals.credit)],
            entries: [...j.entries]
              .map((e) => ({
                ...e,
                totalDebit: cents(e.totalDebit),
                totalCredit: cents(e.totalCredit),
                lines: [...e.lines].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
              }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          })),
          grandTotals: [cents(report.grandTotals.debit), cents(report.grandTotals.credit)],
        })
        expect(view(await journal.getJournalReport(p))).toEqual(view(await ref.referenceJournal(p)))
      }
    }
  })

  it('FEC: the same file, byte for byte', async () => {
    for (const year of YEARS) {
      const actual = fec.buildFec(await fec.loadFecLedger(company, fy(year)))
      const expected = fec.buildFec(await ref.referenceFecLedger(company, fy(year)))
      expect(actual).toBe(expected)
      expect(actual.split('\r\n').length).toBeGreaterThan(1000)
    }
  })

  it('unbalanced entries diagnostic', async () => {
    const actual = await load.findUnbalancedEntries(company, fy(OPEN_YEAR))
    const expected = await ref.referenceUnbalancedEntries(company, fy(OPEN_YEAR))
    expect(actual).toHaveLength(1)
    expect([...actual].sort((a, b) => a.entryId.localeCompare(b.entryId))).toEqual(
      [...expected].sort((a, b) => a.entryId.localeCompare(b.entryId)),
    )
  })
})
