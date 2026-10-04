import { prisma } from '@/lib/prisma'
import { sqlTimestamp } from './ledger/aggregate'
import { fromCents } from '@/lib/utils/money'

export interface TreasuryEvolutionData {
  month: string
  inflows: number
  outflows: number
  cumulative: number
}

interface TreasuryWindow {
  start: Date
  end: Date
  months: Array<{ year: number; month: number }>
}

/**
 * Treasury evolution from the bank transactions of the company: the balance
 * before the window (credits minus debits), then inflows, outflows and the
 * cumulative balance per calendar month (UTC) of the window.
 *
 * Summed in cents by PostgreSQL: the server never loads the transactions (a
 * company with several years of bank history has tens of thousands).
 */
export async function getTreasuryEvolutionFromTransactions(
  companyId: string,
  window: TreasuryWindow
): Promise<TreasuryEvolutionData[]> {
  const start = sqlTimestamp(window.start)
  const rows = await prisma.$queryRaw<
    Array<{ year: number | null; month: number | null; inflows: bigint | null; outflows: bigint | null }>
  >`
    SELECT CASE WHEN t."date" < ${start} THEN NULL ELSE EXTRACT(YEAR FROM t."date")::int END AS year,
           CASE WHEN t."date" < ${start} THEN NULL ELSE EXTRACT(MONTH FROM t."date")::int - 1 END AS month,
           SUM(CASE WHEN t."side" = 'credit' THEN t."amount" * 100 ELSE 0 END)::bigint AS inflows,
           SUM(CASE WHEN t."side" = 'debit' THEN t."amount" * 100 ELSE 0 END)::bigint AS outflows
    FROM "bank_transactions" t
    JOIN "bank_accounts" a ON a."id" = t."bankAccountId"
    JOIN "bank_connections" c ON c."id" = a."bankConnectionId"
    WHERE c."companyId" = ${companyId}
      AND t."date" <= ${sqlTimestamp(window.end)}
    GROUP BY 1, 2
  `

  let initialCents = 0
  const monthly = new Map<string, { inflows: number; outflows: number }>()
  for (const row of rows) {
    const inflows = Number(row.inflows ?? 0)
    const outflows = Number(row.outflows ?? 0)
    if (row.year === null || row.month === null) initialCents += inflows - outflows
    else monthly.set(`${row.year}-${row.month}`, { inflows, outflows })
  }

  const data: TreasuryEvolutionData[] = []
  let cumulative = initialCents
  for (const { year, month } of window.months) {
    const cents = monthly.get(`${year}-${month}`) ?? { inflows: 0, outflows: 0 }
    cumulative += cents.inflows - cents.outflows
    data.push({
      month: new Date(Date.UTC(year, month, 1)).toLocaleDateString('fr-FR', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
      inflows: fromCents(cents.inflows),
      outflows: fromCents(cents.outflows),
      cumulative: fromCents(cumulative),
    })
  }
  return data
}
