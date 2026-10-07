/**
 * Automatic matching of a bank line of an entry (account class 51) with a
 * bank transaction: the same amount to the cent, the opposite side, within
 * one calendar day. Used by the FEC import and the auto-reconcile action.
 *
 * Amounts compare as integer cents (docs/conventions.md#money) and the date
 * window is built on UTC calendar days, so a transaction of 1 March is found
 * for an entry of 28 February whatever the server timezone.
 */

import { isDebitSide } from '@/lib/banking/side'
import { addUtcDays } from '@/lib/utils/date'
import { toCents, type AmountInput } from '@/lib/utils/money'

const centsOf = (value: AmountInput): number | null => toCents(value ?? 0)

/** Signed cents a bank line moves: debit minus credit (positive = money in). */
export function bankLineCents(line: { debit: AmountInput; credit: AmountInput }): number {
  return (centsOf(line.debit) ?? 0) - (centsOf(line.credit) ?? 0)
}

/**
 * Whether `transaction` is the bank side of a line moving `lineCents`.
 * A debit on the bank account (money in) is a credit transaction and the
 * reverse: the transaction amount, negated for a debit transaction, equals
 * the line amount to the cent.
 */
export function transactionMatchesBankLine(
  lineCents: number,
  transaction: { amount: AmountInput; side: string | null | undefined },
): boolean {
  const amount = centsOf(transaction.amount)
  if (amount === null) return false
  const isDebit = isDebitSide(transaction.side)
  if (lineCents > 0 && isDebit) return false
  if (lineCents < 0 && !isDebit) return false
  return (isDebit ? -amount : amount) === lineCents
}

/** Date filter of the transactions that may match an entry: its day plus or minus one calendar day. */
export function reconciliationWindow(entryDate: Date): { gte: Date; lte: Date } {
  return { gte: addUtcDays(entryDate, -1), lte: addUtcDays(entryDate, 1) }
}
