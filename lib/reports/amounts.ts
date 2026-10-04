/**
 * Arithmetic on report amounts. Reports compute in integer cents and return
 * euros as numbers (fromCents); when a report adds, subtracts or rounds
 * those euros again (subtotals, variations, spreadsheet cells), it goes back
 * to cents so the result is exact: 0.1 + 0.2 is 0.3, not
 * 0.30000000000000004 (docs/conventions.md#money).
 */

import { fromCents, toCents } from '@/lib/utils/money'

const centsOf = (euros: number): number => toCents(euros) ?? 0

/** A report amount rounded to the cent (half away from zero), e.g. for a spreadsheet cell. */
export function roundEuros(euros: number): number {
  return fromCents(centsOf(euros))
}

/** a + b, computed in cents. */
export function addEuros(a: number, b: number): number {
  return fromCents(centsOf(a) + centsOf(b))
}

/** a - b, computed in cents. */
export function subtractEuros(a: number, b: number): number {
  return fromCents(centsOf(a) - centsOf(b))
}
