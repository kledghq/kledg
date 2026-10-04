/**
 * Amount of a debit or credit cell of an imported CSV or Excel journal, in
 * cents. Text cells are read the French way ("1 234,56", "1234.56"), so a
 * decimal comma is never cut as parseFloat("1234,56") = 1234 did; numeric
 * Excel cells keep their value, floating point noise of a formula
 * (0.1 + 0.2) included. An empty cell is 0; anything else that is not an
 * amount with at most two decimals is null, and the entry is refused.
 */

import { parseAmount, parseCents } from '@/lib/utils/money'

export function importAmountCents(value: unknown): number | null {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return parseCents(value)
  const parsed = parseAmount(String(value), { allowNegative: true })
  if (!parsed.ok) return null
  return parsed.cents ?? 0
}
