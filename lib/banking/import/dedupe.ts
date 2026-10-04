/**
 * Stable identifiers for imported bank lines, so re-importing the same file
 * or an overlapping period never creates duplicates.
 *
 * key = sha256(bank account, booking date, amount in cents, normalized label,
 *              bank reference when present) + occurrence index
 *
 * The occurrence index tells apart genuine identical lines (two coffees of
 * the same price on the same day): the first is #0, the second #1. An
 * overlapping file that contains the same day numbers them the same way.
 * A bank reference (FITID, AcctSvcrRef, transaction id) is unique by
 * definition: a second line carrying it in the same file is a duplicate.
 *
 * The key is stored in BankTransaction.externalTransactionId, which is
 * unique per bank account in the database.
 */

import { createHash } from 'crypto'
import type { ParsedTransaction } from './types'

export const IMPORT_ID_PREFIX = 'import:'

export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

export interface KeyedTransaction {
  transaction: ParsedTransaction
  externalId: string
  /** Same bank reference earlier in the same file. */
  repeatedInFile: boolean
}

export function importKeys(bankAccountId: string, transactions: ParsedTransaction[]): KeyedTransaction[] {
  const occurrences = new Map<string, number>()
  return transactions.map((transaction) => {
    const base = createHash('sha256')
      .update(
        JSON.stringify([
          bankAccountId,
          transaction.bookingDate,
          transaction.amountCents,
          normalizeLabel(transaction.label),
          transaction.bankReference ?? '',
        ]),
      )
      .digest('hex')
      .slice(0, 40)
    const n = occurrences.get(base) ?? 0
    occurrences.set(base, n + 1)
    if (transaction.bankReference) {
      return { transaction, externalId: `${IMPORT_ID_PREFIX}${base}:0`, repeatedInFile: n > 0 }
    }
    return { transaction, externalId: `${IMPORT_ID_PREFIX}${base}:${n}`, repeatedInFile: false }
  })
}
