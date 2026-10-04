/**
 * Amount columns of the trial balance (balance générale) on narrow screens.
 * The six amount columns (à-nouveaux, mouvements, soldes, each debit and
 * credit) do not fit a phone or a small tablet: below 1024px each account is
 * a row with one pair of amounts, and a toggle switches between the pairs.
 * From 1024px the full table shows every column.
 */

export type TrialBalanceColumnPair = 'opening' | 'movement' | 'closing'

export const TRIAL_BALANCE_PAIRS: ReadonlyArray<{ value: TrialBalanceColumnPair; label: string }> = [
  { value: 'closing', label: 'Soldes' },
  { value: 'movement', label: 'Mouvements' },
  { value: 'opening', label: 'À-nouveaux' },
]

interface TrialBalanceAmounts {
  openingDebit: number
  openingCredit: number
  movementDebit: number
  movementCredit: number
  closingDebit: number
  closingCredit: number
}

interface TrialBalanceTotals {
  opening: { debit: number; credit: number }
  movements: { debit: number; credit: number }
  closing: { debit: number; credit: number }
}

/** Debit and credit of an account for the pair shown. */
export function pairAmounts(row: TrialBalanceAmounts, pair: TrialBalanceColumnPair): { debit: number; credit: number } {
  if (pair === 'opening') return { debit: row.openingDebit, credit: row.openingCredit }
  if (pair === 'movement') return { debit: row.movementDebit, credit: row.movementCredit }
  return { debit: row.closingDebit, credit: row.closingCredit }
}

/** Totals of the pair shown. */
export function pairTotals(totals: TrialBalanceTotals, pair: TrialBalanceColumnPair): { debit: number; credit: number } {
  if (pair === 'opening') return totals.opening
  if (pair === 'movement') return totals.movements
  return totals.closing
}

/** Column headings of the pair: "Solde débiteur" / "Solde créditeur" for the balances. */
export function pairHeadings(pair: TrialBalanceColumnPair): { debit: string; credit: string } {
  if (pair === 'opening') return { debit: 'À-nouveaux débit', credit: 'À-nouveaux crédit' }
  if (pair === 'movement') return { debit: 'Mouvements débit', credit: 'Mouvements crédit' }
  return { debit: 'Solde débiteur', credit: 'Solde créditeur' }
}
