/**
 * Bulk actions on bank transactions (transactions table): delete, reconcile
 * without entry (pointage) and undo reconciliations. Used by
 * /api/transactions/bulk-*.
 *
 * Only transactions of the company are processed; ids of other companies are
 * reported per item as not found, like missing ones. Each transaction is
 * processed on its own (the reconciliation services lock and re-check it), so
 * one failure is reported without stopping the batch, and running the same
 * batch twice changes nothing the second time.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handleError } from '@/lib/accounting/errors'
import { idList } from '@/lib/api/zod-fields'
import { transactionOfCompany } from '@/lib/api/resources'
import { logger } from '@/lib/logger'
import { reconcileWithExistingEntry, unreconcileTransaction } from '@/lib/reconciliation/service'
import { MAX_TRANSACTIONS_PAGE } from './list-transactions.service'

export const TRANSACTION_NOT_FOUND_MESSAGE = 'Transaction introuvable'

/** Body of POST /api/transactions/bulk-*: the transactions, and optionally their company (id or slug). */
export const BulkTransactionsSchema = z.object({
  companyId: z.string().optional(),
  transactionIds: idList(MAX_TRANSACTIONS_PAGE, 'Sélectionnez au moins une transaction.'),
})

export interface BulkOutcome {
  results: Array<{ transactionId: string; success: true }>
  errors: Array<{ transactionId: string; error: string }>
}

type Owned = { id: string; reconciled: boolean }

/**
 * Runs `action` on each transaction of the company, in the given order. An
 * action returns an error message to skip a transaction (state check), or
 * throws: the error is reported through handleError (French message, never
 * internal detail) and the batch goes on.
 */
async function forEachOwned(
  companyId: string,
  transactionIds: string[],
  label: string,
  action: (transaction: Owned) => Promise<string | void>,
): Promise<BulkOutcome> {
  const owned = new Map(
    (
      await prisma.bankTransaction.findMany({
        where: { id: { in: transactionIds }, ...transactionOfCompany(companyId) },
        select: { id: true, reconciled: true },
      })
    ).map((t) => [t.id, t]),
  )

  const outcome: BulkOutcome = { results: [], errors: [] }
  for (const transactionId of transactionIds) {
    const transaction = owned.get(transactionId)
    if (!transaction) {
      outcome.errors.push({ transactionId, error: TRANSACTION_NOT_FOUND_MESSAGE })
      continue
    }
    try {
      const skipped = await action(transaction)
      if (skipped) outcome.errors.push({ transactionId, error: skipped })
      else outcome.results.push({ transactionId, success: true })
    } catch (error) {
      outcome.errors.push({ transactionId, error: handleError(error).message })
      logger.error(`Bulk ${label} failed for transaction ${transactionId}:`, error)
    }
  }
  return outcome
}

/** Deletes the transactions (their reconciliation entries stay, unlinked). */
export function deleteTransactions(companyId: string, transactionIds: string[]): Promise<BulkOutcome> {
  return forEachOwned(companyId, transactionIds, 'delete', async ({ id }) => {
    await prisma.bankTransaction.delete({ where: { id } })
  })
}

/** Marks the unreconciled transactions reconciled without entry (pointage). */
export function reconcileTransactions(companyId: string, transactionIds: string[]): Promise<BulkOutcome> {
  return forEachOwned(companyId, transactionIds, 'reconcile', async ({ id, reconciled }) => {
    if (reconciled) return 'Transaction déjà rapprochée'
    // Conditional update: a concurrent reconciliation makes this one fail (409)
    await reconcileWithExistingEntry(companyId, id, null)
  })
}

/** Undoes the reconciliations: deletes the draft entries they created, keeps entries that were only linked. */
export function unreconcileTransactions(companyId: string, transactionIds: string[]): Promise<BulkOutcome> {
  return forEachOwned(companyId, transactionIds, 'unreconcile', async ({ id, reconciled }) => {
    if (!reconciled) return 'Transaction non rapprochée'
    await unreconcileTransaction(companyId, id)
  })
}
