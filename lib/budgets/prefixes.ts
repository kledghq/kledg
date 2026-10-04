/**
 * Accounts of a budget line. A line names the start of an account number
 * (PCG art. 932-1: the first digit is the class, each following digit
 * subdivides it): "62" is every account of Autres services extérieurs,
 * "6226" only Honoraires. A budget covers the charges (class 6) and the
 * produits (class 7), the two classes of the compte de résultat
 * (PCG art. 821-1).
 *
 * Lines may overlap ("62" and "6226"): an account goes to the line with the
 * longest prefix it starts with, so no amount is counted twice and "62"
 * keeps what "6226" does not take.
 *
 * Pure, no imports: usable on both sides.
 */

/** A class 6 or 7 account number or the start of one: 1 to 12 digits (same rule as the migration's check). */
export const ACCOUNT_PREFIX = /^[67][0-9]{0,11}$/

export type BudgetSide = 'charges' | 'produits'

export const SIDE_LABELS: Record<BudgetSide, string> = { charges: 'Charges', produits: 'Produits' }

/** Charges for class 6, produits for class 7, null for any other account. */
export function sideOfAccount(code: string): BudgetSide | null {
  if (code.startsWith('6')) return 'charges'
  if (code.startsWith('7')) return 'produits'
  return null
}

/** The longest of `prefixes` that `code` starts with, or null when none does. */
export function matchPrefix(code: string, prefixes: readonly string[]): string | null {
  let best: string | null = null
  for (const prefix of prefixes) {
    if (code.startsWith(prefix) && (best === null || prefix.length > best.length)) best = prefix
  }
  return best
}
