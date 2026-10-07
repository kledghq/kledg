/**
 * Automatic matching of a bank line of an entry (account class 51) with a
 * bank transaction: the same amount to the cent, the opposite side, within
 * one calendar day. Used by the FEC import and the auto-reconcile action,
 * both through reconcileBankEntries (lib/services/banking/reconciliation-service.ts).
 *
 * Amounts compare as integer cents (docs/conventions.md#money) and the date
 * window is built on UTC calendar days, so a transaction of 1 March is found
 * for an entry of 28 February whatever the server timezone.
 */

import { isDebitSide } from '@/lib/banking/side'
import { startOfDay } from '@/lib/utils/date'
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

/** An entry to reconcile: its day and its lines with their account code. */
export interface BankEntryToMatch {
  id: string
  date: Date
  lines: ReadonlyArray<{ accountCode: string; debit: AmountInput; credit: AmountInput }>
}

/** An unreconciled transaction that may match, with the 512 mapping of its bank account when set. */
export interface CandidateTransaction {
  id: string
  date: Date
  amount: AmountInput
  side: string | null | undefined
  ledgerAccountCode: string | null
}

/** Whether a line books on a bank account (class 51, PCG art. 932-1). */
export const isBankLineCode = (code: string): boolean => code.startsWith('51')

const DAY_MS = 86_400_000
/** Calendar days between two dates, each read as its calendar day (calendarDayOf). */
const dayGap = (a: Date, b: Date) => Math.abs(Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY_MS))
const byDateThenId = (a: { id: string; date: Date }, b: { id: string; date: Date }) =>
  a.date.getTime() - b.date.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Pairs entries with transactions, in memory and one to one: each entry gets
 * at most one transaction and each transaction at most one entry. For each
 * entry (by date), its bank lines are tried in order; a transaction matches
 * a line when `transactionMatchesBankLine` holds, its day is within one
 * calendar day of the entry's, and its bank account is mapped to the line's
 * account or not mapped at all. Among the matches the closest day wins,
 * then the earliest transaction, then its id: the result does not depend on
 * the order rows came from the database.
 */
export function matchBankEntries(
  entries: readonly BankEntryToMatch[],
  transactions: readonly CandidateTransaction[],
): Array<{ entryId: string; transactionId: string }> {
  // Candidates by the line amount they would match (see transactionMatchesBankLine), oldest first
  const byLineCents = new Map<number, CandidateTransaction[]>()
  for (const transaction of [...transactions].sort(byDateThenId)) {
    const amount = centsOf(transaction.amount)
    if (amount === null) continue
    const key = isDebitSide(transaction.side) ? -amount : amount
    const list = byLineCents.get(key)
    if (list) list.push(transaction)
    else byLineCents.set(key, [transaction])
  }
  const taken = new Set<string>()
  const pairs: Array<{ entryId: string; transactionId: string }> = []
  for (const entry of [...entries].sort(byDateThenId)) {
    for (const line of entry.lines) {
      if (!isBankLineCode(line.accountCode)) continue
      const cents = bankLineCents(line)
      let best: CandidateTransaction | null = null
      for (const transaction of byLineCents.get(cents) ?? []) {
        if (taken.has(transaction.id)) continue
        const gap = dayGap(transaction.date, entry.date)
        if (gap > 1) continue
        if (transaction.ledgerAccountCode && transaction.ledgerAccountCode !== line.accountCode) continue
        if (!transactionMatchesBankLine(cents, transaction)) continue
        if (!best || gap < dayGap(best.date, entry.date)) best = transaction
      }
      if (best) {
        taken.add(best.id)
        pairs.push({ entryId: entry.id, transactionId: best.id })
        break
      }
    }
  }
  return pairs
}
