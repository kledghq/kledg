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

/**
 * Kledg posts the bank line of a transaction at its amount, in euros: an
 * operation of an account in another currency is never posted from its
 * amount (#131). 1 000 USD are not 1 000 € (PCG art. 420-5: converted at
 * the rate of the day). The user writes the entry in euros and links it.
 * Prisma filter of the transactions of euro accounts (combine under AND).
 */
export const EURO_ACCOUNT_TRANSACTION_WHERE = { bankAccount: { currency: 'EUR' } }

/** Why a transaction of an account in `currency` is not posted from its amount, in French. */
export function foreignCurrencyMessage(currency: string): string {
  return `Ce compte bancaire est en ${currency}\u00a0: Kledg ne convertit pas les montants. Passez l'écriture en euros dans Saisie (montant réellement débité ou crédité en euros, ou converti au cours du jour, PCG art. 420-5), puis rapprochez l'opération avec cette écriture.`
}

/** Why a transaction cannot be posted, in French. */
export function notPostableMessage(status: string | null | undefined): string {
  if (status === 'pending') {
    return "Cette opération est encore en attente à la banque : elle se comptabilise une fois débitée ou créditée (elle peut encore être refusée ou annulée)."
  }
  return "Cette opération a été refusée ou annulée par la banque : aucun argent n'a bougé, elle ne se comptabilise pas. Marquez-la comme vérifiée sans écriture pour la sortir du rapprochement."
}
