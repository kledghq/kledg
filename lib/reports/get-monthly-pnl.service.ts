/**
 * Profit and loss of a company month by month (MCP get_monthly_pnl): per
 * calendar month, the produits (class 7, credit minus debit) and the charges
 * (class 6, debit minus credit) of PCG art. 821-1, the chiffre d'affaires
 * (accounts 70, cerfa 2052 line FL) and the result (produits minus charges).
 *
 * The totals are those of the dashboard chart "Produits et charges par mois"
 * (monthlyClassTotals, lib/reports/dashboard.ts): validated entries only,
 * closing entries excluded, like the income statement and the SIG; a draft
 * entry does not count until it is validated. Months may span several fiscal
 * years; a month without any entry is zero.
 */

import { ValidationError } from '@/lib/accounting/errors'
import { todayParis } from '@/lib/accounting/entry-date'
import { addMonths, monthIndex, monthKeyOfDay, monthsBetween, type MonthKey } from '@/lib/budgets/months'
import { endOfDay, utcDate } from '@/lib/utils/date'
import { monthlyClassTotals } from './dashboard'

/** Months one call covers at most, and by default. */
export const MAX_PNL_MONTHS = 24
const DEFAULT_PNL_MONTHS = 12

export interface MonthlyPnlRow {
  month: MonthKey
  revenueCents: number
  chiffreAffairesCents: number
  expensesCents: number
  resultCents: number
}

/**
 * The months asked, both included. `to` defaults to the last full month in
 * France (`from` when it is later), `from` to eleven months before `to`: the
 * last twelve full months when neither is given.
 */
export function pnlMonths(query: { from?: MonthKey; to?: MonthKey }, today: string): MonthKey[] {
  const lastFull = addMonths(monthKeyOfDay(today), -1)
  const to = query.to ?? (query.from && monthIndex(query.from) > monthIndex(lastFull) ? query.from : lastFull)
  const from = query.from ?? addMonths(to, -(DEFAULT_PNL_MONTHS - 1))
  if (monthIndex(from) > monthIndex(to)) throw new ValidationError(`Le mois de début (${from}) est après le mois de fin (${to}).`)
  const months = monthsBetween(from, to)
  if (months.length > MAX_PNL_MONTHS) {
    throw new ValidationError(`${MAX_PNL_MONTHS} mois au plus par appel\u00a0: de ${from} à ${to}, il y en a ${months.length}. Découpez la période.`)
  }
  return months
}

const yearMonth = (key: MonthKey) => key.split('-').map(Number) as [number, number]

export async function getMonthlyPnl(companyId: string, query: { from?: MonthKey; to?: MonthKey }, now: Date = new Date()): Promise<MonthlyPnlRow[]> {
  const months = pnlMonths(query, todayParis(now))
  const [firstYear, firstMonth] = yearMonth(months[0])
  const [lastYear, lastMonth] = yearMonth(months[months.length - 1])
  // Day 0 of the next month is the last day of this one.
  const totals = await monthlyClassTotals(companyId, utcDate(firstYear, firstMonth, 1), endOfDay(utcDate(lastYear, lastMonth + 1, 0)))
  return months.map((month) => {
    const [year, m] = yearMonth(month)
    const cents = totals.get(`${year}-${m - 1}`)
    const revenueCents = cents?.revenueCents ?? 0
    const expensesCents = cents?.expensesCents ?? 0
    return { month, revenueCents, chiffreAffairesCents: cents?.turnoverCents ?? 0, expensesCents, resultCents: revenueCents - expensesCents }
  })
}
