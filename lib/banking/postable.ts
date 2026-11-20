/**
 * Which bank transactions can be posted. A Qonto line is stored whatever
 * its status (lib/banking/providers/types.ts, shouldStoreTransaction) so
 * the user sees it, but only a completed operation moved money: a pending
 * card payment may still be declined or reversed, and a declined or
 * reversed one never left the account. Those are never posted, by a rule,
 * the reconciliation dialog, simple mode or an assistant (#118). Statement
 * lines and the other providers store booked operations only (status null
 * or "completed").
 *
 * A transaction can still be marked as checked without an entry (pointage),
 * which is how a declined line leaves the reconciliation queue.
 *
 * Pure, no imports: usable on the client.
 */

export const NOT_POSTABLE_STATUSES = ['pending', 'declined', 'reversed'] as const

export function isPostableTransaction(transaction: { status?: string | null }): boolean {
  return !transaction.status || !(NOT_POSTABLE_STATUSES as readonly string[]).includes(transaction.status)
}

/** Prisma filter of the postable transactions; combine it under AND, it holds an OR. */
export const POSTABLE_TRANSACTION_WHERE = {
  OR: [{ status: null }, { status: { notIn: [...NOT_POSTABLE_STATUSES] } }],
}

/** Why a transaction cannot be posted, in French. */
export function notPostableMessage(status: string | null | undefined): string {
  if (status === 'pending') {
    return "Cette opération est encore en attente à la banque : elle se comptabilise une fois débitée ou créditée (elle peut encore être refusée ou annulée)."
  }
  return "Cette opération a été refusée ou annulée par la banque : aucun argent n'a bougé, elle ne se comptabilise pas. Marquez-la comme vérifiée sans écriture pour la sortir du rapprochement."
}
