import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { fromCents, toCents } from '@/lib/utils/money'

export interface AccountBalanceEvolutionData {
  month: string
  debit: number
  credit: number
  cumulative: number
}

/**
 * Calcule l'évolution du solde d'un compte comptable par mois sur son exercice fiscal.
 *
 * @param accountId - ID du compte
 * @returns Données mensuelles (débit, crédit, solde cumulé)
 */
export async function getAccountBalanceEvolution(
  accountId: string
): Promise<AccountBalanceEvolutionData[]> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    include: { fiscalYear: true },
  })

  if (!account?.fiscalYearId || !account.fiscalYear) {
    return []
  }

  const { startDate, endDate } = account.fiscalYear

  const where: Prisma.EntryLineWhereInput = {
    accountId,
    accountFiscalYearId: account.fiscalYearId,
    accountingEntry: {
      companyId: account.companyId,
      date: { gte: startDate, lte: endDate },
    },
  }

  const entryLines = await prisma.entryLine.findMany({
    where,
    include: {
      accountingEntry: { select: { date: true } },
    },
    orderBy: {
      accountingEntry: { date: 'asc' },
    },
  })

  // Sums in cents, returned in euros
  const byMonth = new Map<
    string,
    { debit: number; credit: number; balanceDelta: number }
  >()

  for (const line of entryLines) {
    const d = line.accountingEntry.date
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const debit = toCents(line.debit) ?? 0
    const credit = toCents(line.credit) ?? 0

    if (!byMonth.has(key)) {
      byMonth.set(key, { debit: 0, credit: 0, balanceDelta: 0 })
    }
    const row = byMonth.get(key)!
    row.debit += debit
    row.credit += credit
    row.balanceDelta += debit - credit
  }

  const sortedMonths = Array.from(byMonth.keys()).sort()
  const result: AccountBalanceEvolutionData[] = []
  let cumulative = 0

  for (const key of sortedMonths) {
    const row = byMonth.get(key)!
    cumulative += row.balanceDelta
    const [year, month] = key.split('-')
    const monthDate = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, 1))
    result.push({
      month: monthDate.toLocaleDateString('fr-FR', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
      debit: fromCents(row.debit),
      credit: fromCents(row.credit),
      cumulative: fromCents(cumulative),
    })
  }

  return result
}
