/**
 * Account totals of a fiscal year computed by PostgreSQL (GROUP BY account,
 * SUM in cents), instead of loading every entry line into the server.
 *
 * Exactness: amounts are Decimal(15, 2); `SUM(x * 100)` over them is an exact
 * integer numeric, cast to bigint (exact up to 9.2e18 cents) and read as a JS
 * number (exact up to 2^53 cents, 90 trillion euros). No floating point
 * euros are ever summed.
 *
 * Semantics shared by every report (and checked against the line by line
 * implementation by lib/reports/__tests__/aggregate-differential.db.test.ts):
 * - only validated entries of the fiscal year count, on the accounts of that
 *   fiscal year (accounts and entries belong to one fiscal year);
 * - dates are calendar days stored at midnight UTC: bounds are compared as
 *   UTC timestamps (startOfDay / endOfDay), never through the session timezone;
 * - closing entries (journal CL or a "CL-" reference, see
 *   lib/accounting/fiscal-year-closure/constants.ts) are excluded on request;
 * - opening balances (ledger): the opening entry (journal AN) and every entry
 *   dated before the period.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { CLOSING_JOURNAL, OPENING_JOURNAL } from '@/lib/accounting/fiscal-year-closure/constants'

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>

/**
 * A UTC instant as a `timestamp(3)` literal. Prisma stores DateTime columns as
 * timestamp without time zone holding UTC; casting the ISO text keeps the
 * comparison independent of the database session timezone.
 */
export function sqlTimestamp(date: Date): Prisma.Sql {
  return Prisma.sql`CAST(${date.toISOString().slice(0, 23)} AS timestamp(3))`
}

/** SQL condition: the entry `e` (joined with its journal `j`) is a closing entry (isClosingEntry). */
export const IS_CLOSING = Prisma.sql`(j."code" = ${CLOSING_JOURNAL.code} OR COALESCE(e."reference", '') LIKE 'CL-%')`

const toNumber = (value: bigint | number | null): number => (value === null ? 0 : Number(value))

export interface AccountTotalsCents {
  accountId: string
  debitCents: number
  creditCents: number
}

interface ValidatedLinesFilter {
  companyId: string
  fiscalYearId: string
  from?: Date
  to?: Date
  excludeClosingEntries?: boolean
  /** Only this account. */
  accountId?: string
}

/**
 * FROM and WHERE of every account total: the lines `l` of the validated
 * entries `e` (journal `j`) of the fiscal year, on its accounts, dated within
 * [from, to] (both optional, inclusive). One definition, so the yearly and
 * the monthly totals can never disagree.
 */
function validatedLines({ companyId, fiscalYearId, from, to, excludeClosingEntries, accountId }: ValidatedLinesFilter): Prisma.Sql {
  return Prisma.sql`
    FROM "entry_lines" l
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    JOIN "journals" j ON j."id" = e."journalId"
    WHERE l."accountFiscalYearId" = ${fiscalYearId}
      AND e."companyId" = ${companyId}
      AND e."fiscalYearId" = ${fiscalYearId}
      AND e."status" = 'validated'
      ${accountId ? Prisma.sql`AND l."accountId" = ${accountId}` : Prisma.empty}
      ${from ? Prisma.sql`AND e."date" >= ${sqlTimestamp(from)}` : Prisma.empty}
      ${to ? Prisma.sql`AND e."date" <= ${sqlTimestamp(to)}` : Prisma.empty}
      ${excludeClosingEntries ? Prisma.sql`AND NOT ${IS_CLOSING}` : Prisma.empty}
  `
}

/**
 * Debit and credit totals per account of the fiscal year, in cents, over the
 * validated entries dated within [from, to] (both optional, inclusive).
 * Accounts without a line are absent.
 */
export async function sumAccountTotals(params: ValidatedLinesFilter, db: Db = prisma): Promise<AccountTotalsCents[]> {
  const rows = await db.$queryRaw<Array<{ accountId: string; debit: bigint | null; credit: bigint | null }>>`
    SELECT l."accountId" AS "accountId",
           SUM(l."debit" * 100)::bigint AS debit,
           SUM(l."credit" * 100)::bigint AS credit
    ${validatedLines(params)}
    GROUP BY l."accountId"
  `
  return rows.map((r) => ({ accountId: r.accountId, debitCents: toNumber(r.debit), creditCents: toNumber(r.credit) }))
}

export interface MonthlyAccountTotalsCents extends AccountTotalsCents {
  /** Calendar month of the entries, `yyyy-mm`. */
  month: string
}

/**
 * The totals of sumAccountTotals split by calendar month of the entry date
 * (budget against the books, lib/budgets). Dates are stored at midnight UTC
 * in a timestamp without time zone, so the month read by `to_char` is the
 * calendar day's month whatever the session timezone. The months of an
 * account add up to its sumAccountTotals row.
 */
export async function sumAccountTotalsByMonth(params: ValidatedLinesFilter, db: Db = prisma): Promise<MonthlyAccountTotalsCents[]> {
  const rows = await db.$queryRaw<Array<{ accountId: string; month: string; debit: bigint | null; credit: bigint | null }>>`
    SELECT l."accountId" AS "accountId",
           to_char(e."date", 'YYYY-MM') AS month,
           SUM(l."debit" * 100)::bigint AS debit,
           SUM(l."credit" * 100)::bigint AS credit
    ${validatedLines(params)}
    GROUP BY 1, 2
  `
  return rows.map((r) => ({ accountId: r.accountId, month: r.month, debitCents: toNumber(r.debit), creditCents: toNumber(r.credit) }))
}

export interface LedgerTotalsCents {
  accountId: string
  /** Opening balance (debit - credit): journal AN and entries before the period. */
  openingCents: number
  /** Movements of the period (journal AN excluded). */
  debitCents: number
  creditCents: number
}

/**
 * Opening balance and period movements per account of the fiscal year, for
 * the period [periodStart, periodEnd]: what the trial balance needs, in one
 * aggregate. Accounts with at least one validated line up to periodEnd are
 * present (as in the line by line ledger), even when their totals are zero.
 */
export async function sumLedgerTotals(
  params: { companyId: string; fiscalYearId: string; periodStart: Date; periodEnd: Date },
  db: Db = prisma,
): Promise<LedgerTotalsCents[]> {
  const { companyId, fiscalYearId, periodStart, periodEnd } = params
  const opening = Prisma.sql`(j."code" = ${OPENING_JOURNAL.code} OR e."date" < ${sqlTimestamp(periodStart)})`
  const rows = await db.$queryRaw<Array<{ accountId: string; opening: bigint | null; debit: bigint | null; credit: bigint | null }>>`
    SELECT l."accountId" AS "accountId",
           SUM(CASE WHEN ${opening} THEN (l."debit" - l."credit") * 100 ELSE 0 END)::bigint AS opening,
           SUM(CASE WHEN ${opening} THEN 0 ELSE l."debit" * 100 END)::bigint AS debit,
           SUM(CASE WHEN ${opening} THEN 0 ELSE l."credit" * 100 END)::bigint AS credit
    FROM "entry_lines" l
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    JOIN "journals" j ON j."id" = e."journalId"
    WHERE l."accountFiscalYearId" = ${fiscalYearId}
      AND e."companyId" = ${companyId}
      AND e."fiscalYearId" = ${fiscalYearId}
      AND e."status" = 'validated'
      AND e."date" <= ${sqlTimestamp(periodEnd)}
    GROUP BY l."accountId"
  `
  return rows.map((r) => ({
    accountId: r.accountId,
    openingCents: toNumber(r.opening),
    debitCents: toNumber(r.debit),
    creditCents: toNumber(r.credit),
  }))
}
