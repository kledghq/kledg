/**
 * Direction of a bank transaction. The amount of a bank transaction is
 * absolute; `side` says whether money left the account ("debit") or came in
 * ("credit"). The database only holds these two values (check constraint
 * `bank_transactions_side_check`, migration
 * 20261125090000_bank_transaction_side); providers and statement files go
 * through `normalizeBankSide` before a row is written, and every reader
 * uses these helpers rather than its own comparison.
 *
 * Pure, no imports: usable on the client.
 */

export type BankSide = 'debit' | 'credit'

/**
 * The one reading of a side from any source: a value starting with "d" (any
 * case, "debit", "DEBIT", "Débit", "D") is money out, anything else money in.
 */
export function normalizeBankSide(side: string | null | undefined): BankSide {
  return /^\s*d/i.test(side ?? '') ? 'debit' : 'credit'
}

/** Whether a side means money out (see `normalizeBankSide`). */
export function isDebitSide(side: string | null | undefined): boolean {
  return normalizeBankSide(side) === 'debit'
}

/** Signed cents of an absolute amount: negative for money out. */
export function signedBankCents(absoluteCents: number, side: string | null | undefined): number {
  return isDebitSide(side) ? -Math.abs(absoluteCents) : Math.abs(absoluteCents)
}
