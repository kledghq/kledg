import { prisma } from '@/lib/prisma'
import type { FiscalYear } from '@prisma/client'
import { IS_CLOSING, sqlTimestamp } from './ledger/aggregate'
import { fromCents } from '@/lib/utils/money'
import { isoDateToUtc } from '@/lib/utils/date'
import { todayParis } from '@/lib/accounting/entry-date'

interface DashboardStats {
  totalRevenue: number
  totalExpenses: number
  netResult: number
  revenueChange: number
  expensesChange: number
}

interface MonthlyData {
  month: string
  revenue: number
  expenses: number
}

interface DashboardWindow {
  start: Date
  end: Date
  months: Array<{ year: number; month: number }>
}

export async function resolveDashboardFiscalYear(
  companyId: string,
  fiscalYearId?: string | null,
  now: Date = new Date(),
): Promise<FiscalYear | null> {
  if (fiscalYearId) {
    const fy = await prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId },
    })
    if (fy) return fy
  }

  // Fiscal year bounds are calendar days at midnight UTC: compare with today's
  // day in France, not the current instant (missed on the last day otherwise)
  const today = isoDateToUtc(todayParis(now))
  const active = await prisma.fiscalYear.findFirst({
    where: {
      companyId,
      startDate: { lte: today },
      endDate: { gte: today },
    },
    orderBy: { startDate: 'desc' },
  })
  if (active) return active

  return prisma.fiscalYear.findFirst({
    where: { companyId },
    orderBy: { startDate: 'desc' },
  })
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0))
}

function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999))
}

function referenceDateFor(fy: FiscalYear): Date {
  const now = new Date()
  if (now < fy.startDate) return fy.startDate
  if (now > fy.endDate) return fy.endDate
  return now
}

export function getDashboardWindow(
  fy: FiscalYear,
  months: number
): DashboardWindow {
  const ref = referenceDateFor(fy)
  const fyStart = startOfMonth(fy.startDate)
  const end = endOfMonth(ref)

  let start: Date
  if (months >= 12) {
    start = fyStart
  } else {
    const rawStart = new Date(
      Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - months + 1, 1, 0, 0, 0, 0)
    )
    start = rawStart < fyStart ? fyStart : rawStart
  }

  const monthList: Array<{ year: number; month: number }> = []
  let y = start.getUTCFullYear()
  let m = start.getUTCMonth()
  const endY = end.getUTCFullYear()
  const endM = end.getUTCMonth()
  while (y < endY || (y === endY && m <= endM)) {
    monthList.push({ year: y, month: m })
    m++
    if (m > 11) {
      m = 0
      y++
    }
  }

  return { start, end, months: monthList }
}

function getPreviousWindow(window: DashboardWindow): { start: Date; end: Date } {
  const count = window.months.length
  const end = new Date(
    Date.UTC(window.start.getUTCFullYear(), window.start.getUTCMonth(), 0, 23, 59, 59, 999)
  )
  const start = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - count + 1, 1, 0, 0, 0, 0)
  )
  return { start, end }
}

interface ClassTotals {
  revenue: number
  expenses: number
}

/**
 * Revenue (class 7, credit - debit) and expenses (class 6, debit - credit) of
 * the validated entries dated within [startDate, endDate], closing entries
 * excluded, per calendar month (UTC), summed in cents by PostgreSQL.
 */
export async function monthlyClassTotals(
  companyId: string,
  startDate: Date,
  endDate: Date
): Promise<Map<string, { revenueCents: number; expensesCents: number }>> {
  const rows = await prisma.$queryRaw<Array<{ year: number; month: number; revenue: bigint | null; expenses: bigint | null }>>`
    SELECT EXTRACT(YEAR FROM e."date")::int AS year,
           (EXTRACT(MONTH FROM e."date")::int - 1) AS month,
           SUM(CASE WHEN a."code" LIKE '7%' THEN (l."credit" - l."debit") * 100 ELSE 0 END)::bigint AS revenue,
           SUM(CASE WHEN a."code" LIKE '6%' THEN (l."debit" - l."credit") * 100 ELSE 0 END)::bigint AS expenses
    FROM "entry_lines" l
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    JOIN "journals" j ON j."id" = e."journalId"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE e."companyId" = ${companyId}
      AND e."status" = 'validated'
      AND e."date" >= ${sqlTimestamp(startDate)}
      AND e."date" <= ${sqlTimestamp(endDate)}
      AND (a."code" LIKE '6%' OR a."code" LIKE '7%')
      AND NOT ${IS_CLOSING}
      -- Lines of the company only (their accounts belong to its fiscal years):
      -- lets PostgreSQL read the lines by index instead of scanning every company's.
      AND l."accountFiscalYearId" IN (SELECT fy."id" FROM "fiscal_years" fy WHERE fy."companyId" = ${companyId})
    GROUP BY 1, 2
  `
  return new Map(
    rows.map((r) => [`${r.year}-${r.month}`, { revenueCents: Number(r.revenue ?? 0), expensesCents: Number(r.expenses ?? 0) }])
  )
}

async function getClassTotals(
  companyId: string,
  startDate: Date,
  endDate: Date
): Promise<ClassTotals> {
  let revenueCents = 0
  let expensesCents = 0
  for (const month of (await monthlyClassTotals(companyId, startDate, endDate)).values()) {
    revenueCents += month.revenueCents
    expensesCents += month.expensesCents
  }
  return { revenue: fromCents(revenueCents), expenses: fromCents(expensesCents) }
}

function percentChange(current: number, previous: number): number {
  if (previous === 0) {
    if (current === 0) return 0
    return current > 0 ? 100 : -100
  }
  return ((current - previous) / Math.abs(previous)) * 100
}

export async function getDashboardStats(
  companyId: string,
  window: DashboardWindow
): Promise<DashboardStats> {
  const previous = getPreviousWindow(window)

  const [currentTotals, previousTotals] = await Promise.all([
    getClassTotals(companyId, window.start, window.end),
    getClassTotals(companyId, previous.start, previous.end),
  ])

  return {
    totalRevenue: currentTotals.revenue,
    totalExpenses: currentTotals.expenses,
    netResult: currentTotals.revenue - currentTotals.expenses,
    revenueChange: percentChange(currentTotals.revenue, previousTotals.revenue),
    expensesChange: percentChange(currentTotals.expenses, previousTotals.expenses),
  }
}

export async function getMonthlyData(
  companyId: string,
  window: DashboardWindow
): Promise<MonthlyData[]> {
  const totals = await monthlyClassTotals(companyId, window.start, window.end)
  const buckets = new Map<string, MonthlyData>()
  for (const { year, month } of window.months) {
    const key = `${year}-${month}`
    const d = new Date(Date.UTC(year, month, 1))
    const cents = totals.get(key)
    buckets.set(key, {
      month: d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      revenue: fromCents(cents?.revenueCents ?? 0),
      expenses: fromCents(cents?.expensesCents ?? 0),
    })
  }

  return Array.from(buckets.values())
}
