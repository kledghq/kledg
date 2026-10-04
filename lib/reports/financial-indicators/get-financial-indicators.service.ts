/**
 * Financial indicators of a fiscal year and of the one before it (N and
 * N-1), from the same account totals as the income statement and the
 * balance sheet (loadStatementAccounts: validated entries of the year,
 * closing entries excluded), so the SIG end on the result of the income
 * statement and the BFR components are balance sheet lines.
 *
 * The rules are in indicators.ts, sig.ts and balance-indicators.ts (pure);
 * this module only loads the totals of a year and its VAT movements.
 */

import { z } from 'zod'
import type { FiscalYear } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { resolveDashboardFiscalYear } from '@/lib/reports/dashboard'
import { sumLedgerTotals } from '@/lib/reports/ledger/aggregate'
import { loadStatementAccounts } from '@/lib/reports/statements/load'
import { calendarDayOf, todayUtc, utcDaysInclusive } from '@/lib/utils/date'
import { computeFinancialIndicators, vatFlowsOf, type FinancialIndicators } from './indicators'

export const FISCAL_YEAR_NOT_FOUND = 'Exercice introuvable pour cette société.'
export const NO_FISCAL_YEAR = "Aucun exercice pour cette société : créez d'abord un exercice."

/** ?fiscalYearId= (the page, its exports, the assistants); the current fiscal year by default. */
export const FinancialIndicatorsQuerySchema = z.object({
  fiscalYearId: z.string().max(64).optional(),
})
export type FinancialIndicatorsQuery = z.infer<typeof FinancialIndicatorsQuerySchema>

export interface IndicatorsFiscalYear {
  id: string
  year: number
  startDate: string
  endDate: string
  isClosed: boolean
  /** Last day counted by the payment delays: today within an open year, its last day once over. */
  asOf: string
}

export interface FinancialIndicatorsReport {
  fiscalYear: IndicatorsFiscalYear
  current: FinancialIndicators
  /** The fiscal year just before, over its whole length; null for the first year. */
  previous: { fiscalYear: IndicatorsFiscalYear; indicators: FinancialIndicators } | null
}

type YearRow = Pick<FiscalYear, 'id' | 'year' | 'startDate' | 'endDate' | 'isClosed'>

/** Today within the fiscal year: its first day before it starts, its last day once over. */
function referenceDay(fy: YearRow, now: Date): Date {
  const today = todayUtc(now)
  if (today < fy.startDate) return todayUtc(fy.startDate)
  if (today > fy.endDate) return todayUtc(fy.endDate)
  return today
}

function refOf(fy: YearRow, asOf: Date): IndicatorsFiscalYear {
  return {
    id: fy.id,
    year: fy.year,
    startDate: calendarDayOf(fy.startDate) as string,
    endDate: calendarDayOf(fy.endDate) as string,
    isClosed: fy.isClosed,
    asOf: calendarDayOf(asOf) as string,
  }
}

/**
 * The indicators of one fiscal year: its account totals, the VAT recorded on
 * its flows (movements of the year without the opening entry) and the days
 * from its first day to `asOf`.
 */
export async function computeFiscalYearIndicators(companyId: string, fy: YearRow, asOf: Date): Promise<FinancialIndicators> {
  const [accounts, movements] = await Promise.all([
    loadStatementAccounts(companyId, fy),
    sumLedgerTotals({ companyId, fiscalYearId: fy.id, periodStart: fy.startDate, periodEnd: fy.endDate }),
  ])
  const codeOf = new Map(accounts.map((a) => [a.accountId, a.code]))
  const vat = vatFlowsOf(
    movements.flatMap((m) => {
      const code = codeOf.get(m.accountId)
      return code ? [{ code, debitCents: m.debitCents, creditCents: m.creditCents }] : []
    }),
  )
  return computeFinancialIndicators({ accounts, vat, days: Math.max(1, utcDaysInclusive(fy.startDate, asOf)) })
}

async function resolveFiscalYear(companyId: string, fiscalYearId: string | undefined): Promise<FiscalYear> {
  if (fiscalYearId) {
    const named = await prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId } })
    if (!named) throw new NotFoundError(FISCAL_YEAR_NOT_FOUND)
    return named
  }
  const fy = await resolveDashboardFiscalYear(companyId, null)
  if (!fy) throw new ValidationError(NO_FISCAL_YEAR)
  return fy
}

/** The indicators of a fiscal year (the current one by default) and of the previous one. */
export async function getFinancialIndicators(
  companyId: string,
  query: FinancialIndicatorsQuery,
  now: Date = new Date(),
): Promise<FinancialIndicatorsReport> {
  const fy = await resolveFiscalYear(companyId, query.fiscalYearId)
  const previousYear = await prisma.fiscalYear.findFirst({
    where: { companyId, startDate: { lt: fy.startDate } },
    orderBy: { startDate: 'desc' },
  })
  const asOf = referenceDay(fy, now)
  const [current, previous] = await Promise.all([
    computeFiscalYearIndicators(companyId, fy, asOf),
    previousYear ? computeFiscalYearIndicators(companyId, previousYear, todayUtc(previousYear.endDate)) : Promise.resolve(null),
  ])
  return {
    fiscalYear: refOf(fy, asOf),
    current,
    previous: previousYear && previous ? { fiscalYear: refOf(previousYear, todayUtc(previousYear.endDate)), indicators: previous } : null,
  }
}
