/**
 * Balance of the bank ledger accounts (512) at the end of each month of a
 * fiscal year, summed in cents by PostgreSQL in one aggregate: the opening
 * balance (journal AN, and any entry dated before the first month), then the
 * net movement of each month. Same scope as the statements: validated
 * entries of the year on the accounts of that year, closing entries
 * excluded (lib/reports/ledger/aggregate.ts).
 */

import { prisma } from '@/lib/prisma'
import { IS_CLOSING, sqlTimestamp } from '@/lib/reports/ledger/aggregate'
import { OPENING_JOURNAL } from '@/lib/accounting/fiscal-year-closure/constants'

export interface CashPoint {
  /** Calendar month, "2026-03". */
  month: string
  /** Balance of the 512 accounts at the end of the month, in cents. */
  balanceCents: number
}

export async function ledgerCashByMonth(params: {
  companyId: string
  fiscalYearId: string
  /** Months of the window (month 0-11), first to last. */
  months: ReadonlyArray<{ year: number; month: number }>
}): Promise<{ openingCents: number; points: CashPoint[] }> {
  const { companyId, fiscalYearId, months } = params
  if (months.length === 0) return { openingCents: 0, points: [] }
  const first = months[0]
  const start = sqlTimestamp(new Date(Date.UTC(first.year, first.month, 1)))
  const rows = await prisma.$queryRaw<Array<{ year: number | null; month: number | null; net: bigint | null }>>`
    SELECT CASE WHEN j."code" = ${OPENING_JOURNAL.code} OR e."date" < ${start} THEN NULL ELSE EXTRACT(YEAR FROM e."date")::int END AS year,
           CASE WHEN j."code" = ${OPENING_JOURNAL.code} OR e."date" < ${start} THEN NULL ELSE EXTRACT(MONTH FROM e."date")::int - 1 END AS month,
           SUM((l."debit" - l."credit") * 100)::bigint AS net
    FROM "entry_lines" l
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    JOIN "journals" j ON j."id" = e."journalId"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE l."accountFiscalYearId" = ${fiscalYearId}
      AND e."companyId" = ${companyId}
      AND e."fiscalYearId" = ${fiscalYearId}
      AND e."status" = 'validated'
      AND a."code" LIKE '512%'
      AND NOT ${IS_CLOSING}
    GROUP BY 1, 2
  `

  let openingCents = 0
  const byMonth = new Map<string, number>()
  for (const row of rows) {
    const net = Number(row.net ?? 0)
    if (row.year === null || row.month === null) openingCents += net
    else byMonth.set(`${row.year}-${row.month}`, net)
  }

  let balance = openingCents
  const points = months.map(({ year, month }) => {
    balance += byMonth.get(`${year}-${month}`) ?? 0
    return { month: `${year}-${String(month + 1).padStart(2, '0')}`, balanceCents: balance }
  })
  return { openingCents, points }
}
