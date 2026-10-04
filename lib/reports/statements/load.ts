/**
 * Loads what the annual statements of a fiscal year are computed from: the
 * balances of its accounts over the year, closing entries excluded.
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { getAllAccountBalances } from '../account-balances'
import type { ImbalanceDiagnostic } from '../balance-sheet/types'
import { fromCents, toCents } from '@/lib/utils/money'
import type { AccountTotals } from './allocation'

function requireCents(euros: number): number {
  const cents = toCents(euros)
  if (cents === null) throw new RangeError(`Invalid account balance: ${euros}`)
  return cents
}

export async function loadFiscalYearOf(companyId: string, fiscalYearId: string) {
  const fiscalYear = await prisma.fiscalYear.findUnique({ where: { id: fiscalYearId } })
  if (!fiscalYear || fiscalYear.companyId !== companyId) {
    throw new NotFoundError('Exercice fiscal introuvable')
  }
  return fiscalYear
}

/**
 * Balances of every account of the fiscal year from its validated entries,
 * in cents, without the year's closing entries (journal CL): the statements
 * of a closed year show its real result, not the zeroed accounts.
 */
export async function loadStatementAccounts(
  companyId: string,
  fiscalYear: { id: string; startDate: Date; endDate: Date }
): Promise<AccountTotals[]> {
  const balances = await getAllAccountBalances(
    companyId,
    { startDate: fiscalYear.startDate, endDate: fiscalYear.endDate },
    fiscalYear.id,
    true
  )
  // Balances are sums of cents divided by 100: toCents gives those cents back.
  return balances.map((b) => ({
    accountId: b.accountId,
    code: b.code,
    label: b.label,
    debitCents: requireCents(b.debit),
    creditCents: requireCents(b.credit),
  }))
}

/** Validated entries of the year whose debits and credits differ (a cause of an unbalanced bilan). */
export async function findUnbalancedEntries(
  companyId: string,
  fiscalYearId: string
): Promise<ImbalanceDiagnostic['causes']['unbalancedEntries']> {
  // Summed by PostgreSQL in cents (no line loading); same rule as before:
  // an entry is listed when its debits and credits differ.
  const rows = await prisma.$queryRaw<
    Array<{ id: string; reference: string | null; entryNumber: string; date: Date; debit: bigint; credit: bigint }>
  >`
    SELECT e."id", e."reference", e."entryNumber", e."date",
           SUM(l."debit" * 100)::bigint AS debit, SUM(l."credit" * 100)::bigint AS credit
    FROM "accounting_entries" e
    JOIN "entry_lines" l ON l."accountingEntryId" = e."id"
    WHERE e."companyId" = ${companyId} AND e."fiscalYearId" = ${fiscalYearId} AND e."status" = 'validated'
    GROUP BY e."id"
    HAVING SUM(l."debit") <> SUM(l."credit")
    ORDER BY e."date", e."id"
  `
  return rows.map((row) => {
    const debit = Number(row.debit)
    const credit = Number(row.credit)
    return {
      entryId: row.id,
      reference: row.reference || row.entryNumber,
      date: row.date,
      debitTotal: fromCents(debit),
      creditTotal: fromCents(credit),
      difference: fromCents(debit - credit),
      link: `/${companyId}/entries/${row.id}`,
    }
  })
}
