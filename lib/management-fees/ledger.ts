/**
 * What management fees read from the books, through the ledger aggregate of
 * the reports (lib/reports/ledger/aggregate.ts, sumAccountTotals): validated
 * entries only, closing entries excluded, amounts in cents. A period may
 * cross fiscal years: each fiscal year overlapping it is summed over its
 * part of the period, on its own chart of accounts.
 *
 * Each function reads the company of the current row level security scope:
 * the holding's charges in the holding's request, a subsidiary's revenue
 * inside inCompany (lib/management-fees/access.ts).
 */

import { prisma } from '@/lib/prisma'
import { dayToDate } from '@/lib/accounting/entry-date'
import { sumAccountTotals } from '@/lib/reports/ledger/aggregate'
import { calendarDayOf, utcDaysInclusive } from '@/lib/utils/date'
import { isPooledAccount, REVENUE_PREFIX } from './rules'

export interface AccountAmount {
  code: string
  label: string
  /** Debit minus credit for a charge, credit minus debit for revenue. */
  cents: number
}

interface PeriodTotals {
  accounts: AccountAmount[]
  /** Days of the period covered by a fiscal year of the company. */
  coveredDays: number
}

async function accountTotals(companyId: string, start: string, end: string, keep: (code: string) => boolean, sign: 1 | -1): Promise<PeriodTotals> {
  const years = await prisma.fiscalYear.findMany({
    where: { companyId, startDate: { lte: dayToDate(end) }, endDate: { gte: dayToDate(start) } },
    select: { id: true, startDate: true, endDate: true },
    orderBy: { startDate: 'asc' },
    take: 10,
  })
  const byCode = new Map<string, AccountAmount>()
  let coveredDays = 0
  for (const year of years) {
    const yearStart = calendarDayOf(year.startDate) as string
    const yearEnd = calendarDayOf(year.endDate) as string
    const from = yearStart > start ? yearStart : start
    const to = yearEnd < end ? yearEnd : end
    coveredDays += utcDaysInclusive(dayToDate(from), dayToDate(to))
    const [totals, accounts] = await Promise.all([
      sumAccountTotals({ companyId, fiscalYearId: year.id, from: dayToDate(from), to: dayToDate(to), excludeClosingEntries: true }),
      prisma.account.findMany({ where: { companyId, fiscalYearId: year.id }, select: { id: true, code: true, label: true } }),
    ])
    const accountById = new Map(accounts.map((a) => [a.id, a]))
    for (const row of totals) {
      const account = accountById.get(row.accountId)
      if (!account || !keep(account.code)) continue
      const cents = sign * (row.debitCents - row.creditCents)
      const current = byCode.get(account.code)
      byCode.set(account.code, { code: account.code, label: current?.label ?? account.label, cents: (current?.cents ?? 0) + cents })
    }
  }
  const accounts = [...byCode.values()].filter((a) => a.cents !== 0).sort((a, b) => a.code.localeCompare(b.code))
  return { accounts, coveredDays }
}

export interface CostPool extends PeriodTotals {
  totalCents: number
  /** Charges of the period left out by the excluded prefixes, for the user to check the pool. */
  excluded: AccountAmount[]
}

/** Charges of the company over [start, end] (ISO days): the pooled accounts and those left out. */
export async function loadCostPool(companyId: string, start: string, end: string, included: readonly string[], excluded: readonly string[]): Promise<CostPool> {
  const charges = await accountTotals(companyId, start, end, (code) => code.startsWith('6'), 1)
  const pooled = charges.accounts.filter((a) => isPooledAccount(a.code, included, excluded))
  return {
    accounts: pooled,
    excluded: charges.accounts.filter((a) => !isPooledAccount(a.code, included, excluded)),
    totalCents: pooled.reduce((sum, a) => sum + a.cents, 0),
    coveredDays: charges.coveredDays,
  }
}

/** Revenue (class 70, credit minus debit) of the company over [start, end] (ISO days). */
export async function loadRevenue(companyId: string, start: string, end: string): Promise<{ cents: number; coveredDays: number }> {
  const revenue = await accountTotals(companyId, start, end, (code) => code.startsWith(REVENUE_PREFIX), -1)
  return { cents: revenue.accounts.reduce((sum, a) => sum + a.cents, 0), coveredDays: revenue.coveredDays }
}
