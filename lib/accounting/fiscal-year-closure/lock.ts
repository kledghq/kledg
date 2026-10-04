/**
 * A closed fiscal year is locked: no entry can be created, changed or
 * deleted in it. PCG art. 1031-3 and 1031-4 (ANC 2014-03 as amended by ANC
 * 2022-06, formerly art. 921-3 and 921-4): validated entries are definitive
 * and a closing procedure fixes the chronology and guarantees that the
 * entries of a closed period can no longer change; corrections go into the
 * open year.
 *
 * The database enforces it for every code path (triggers of migration
 * 20261004090000_fiscal_year_closing_lock). These helpers give services a
 * clear error before they write, and map the database error.
 *
 * For code outside the closing module (entries, imports, reconciliation):
 *   await assertFiscalYearOpen(fiscalYearId)              // by year
 *   await assertDateInOpenFiscalYear(companyId, date)     // by entry date
 * Both accept a transaction client as last argument.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ClosedFiscalYearError } from '@/lib/accounting/errors'
import { calendarDayOf } from '@/lib/utils/date'
import {
  fiscalYearContaining,
  GUARDED_FISCAL_YEAR_SELECT,
  isFiscalYearClosed as isGuardedYearClosed,
  type GuardedFiscalYear,
} from '@/lib/accounting/entry-guards'

type Client = Pick<Prisma.TransactionClient, 'fiscalYear'>

export {
  CLOSED_FISCAL_YEAR_MARKER,
  CLOSED_FISCAL_YEAR_MESSAGE,
  ClosedFiscalYearError,
  isClosedFiscalYearDbError,
} from '@/lib/accounting/errors'

/** Whether the fiscal year is closed (the one check: entry-guards isFiscalYearClosed). */
export async function isFiscalYearClosed(fiscalYearId: string, client: Client = prisma): Promise<boolean> {
  const fiscalYear = await client.fiscalYear.findUnique({
    where: { id: fiscalYearId },
    select: GUARDED_FISCAL_YEAR_SELECT,
  })
  return fiscalYear ? isGuardedYearClosed(fiscalYear) : false
}

/** Throws a ClosedFiscalYearError (409) when the fiscal year is closed. */
export async function assertFiscalYearOpen(fiscalYearId: string, client: Client = prisma): Promise<void> {
  const fiscalYear = await client.fiscalYear.findUnique({
    where: { id: fiscalYearId },
    select: GUARDED_FISCAL_YEAR_SELECT,
  })
  if (fiscalYear && isGuardedYearClosed(fiscalYear)) throw new ClosedFiscalYearError(fiscalYear.year)
}

/** Throws a ClosedFiscalYearError (409) when `date` falls in a closed fiscal year of the company. */
export async function assertDateInOpenFiscalYear(
  companyId: string,
  date: Date,
  client: Client = prisma
): Promise<void> {
  const day = calendarDayOf(date)
  if (!day) return
  const years = await client.fiscalYear.findMany({ where: { companyId }, select: GUARDED_FISCAL_YEAR_SELECT })
  const fiscalYear = fiscalYearContaining(years, day)
  if (fiscalYear && isGuardedYearClosed(fiscalYear)) throw new ClosedFiscalYearError(fiscalYear.year)
}

/**
 * Locks a fiscal year row until the end of the transaction (SELECT ... FOR
 * UPDATE), so that closings and depreciation postings of a year run one at
 * a time, and returns it with its closed state (the entry-guards rule).
 */
export async function lockFiscalYearRow(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  fiscalYearId: string,
  companyId?: string
): Promise<(GuardedFiscalYear & { closed: boolean }) | null> {
  const rows = await tx.$queryRaw<Array<GuardedFiscalYear & { companyId: string }>>`
    SELECT "id", "companyId", "year", "startDate", "endDate", "isClosed", "closedAt" FROM "fiscal_years"
    WHERE "id" = ${fiscalYearId} FOR UPDATE
  `
  const row = rows[0]
  if (!row || (companyId && row.companyId !== companyId)) return null
  return { ...row, closed: isGuardedYearClosed(row) }
}
