/**
 * Aligns the date of reconciled accounting entries on the date of their bank
 * transaction (e.g. after Qonto switched from settled_at to created_at).
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export interface UpdateEntryDatesResult {
  entriesUpdated: number
}

/**
 * For one company (optionally one of its bank accounts), sets the date of each
 * reconciled entry to its transaction date. Only draft entries of an open
 * fiscal year are touched, and only when the new date stays inside that
 * fiscal year: validated entries and closed years are never rewritten.
 */
export async function updateEntryDatesFromReconciledTransactions(scope: {
  companyId: string
  bankAccountId?: string
}): Promise<UpdateEntryDatesResult> {
  const { companyId, bankAccountId } = scope

  const transactions = await prisma.bankTransaction.findMany({
    where: {
      reconciled: true,
      reconciledWith: { not: null },
      bankAccount: { bankConnection: { companyId } },
      ...(bankAccountId ? { bankAccountId } : {}),
    },
    select: { id: true, date: true, reconciledWith: true },
  })

  let entriesUpdated = 0
  for (const tx of transactions) {
    if (!tx.reconciledWith) continue
    try {
      const result = await prisma.accountingEntry.updateMany({
        where: {
          id: tx.reconciledWith,
          companyId,
          status: 'draft',
          date: { not: tx.date },
          fiscalYear: { isClosed: false, startDate: { lte: tx.date }, endDate: { gte: tx.date } },
        },
        data: { date: tx.date },
      })
      entriesUpdated += result.count
    } catch (error) {
      logger.warn(
        '[updateEntryDatesFromReconciledTransactions] Skip entry %s: %s',
        tx.reconciledWith,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  if (entriesUpdated > 0) {
    logger.debug('[updateEntryDatesFromReconciledTransactions] Entries updated: %d', entriesUpdated)
  }

  return { entriesUpdated }
}
