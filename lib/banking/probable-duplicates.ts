/**
 * Probable duplicates between two sources of the same bank account's lines
 * (pure, no database).
 *
 * The same operation reaches Kledg from several sources whose labels and
 * ids differ: a CSV then an OFX of the same period, a statement file and the
 * bank API, an aggregator (Ponto) then a direct connection (Qonto, Revolut)
 * for the same IBAN. A new line is a probable duplicate of an existing one
 * when both have the same signed amount in cents (amount and side) and the
 * same booking date, or the same value date when both sides have one. No
 * wider tolerance: a line a day apart is a different operation.
 *
 * Matching is one to one and count aware: N identical new lines against M
 * existing ones match at most min(N, M), two coffees of the same price on
 * the same day stay two operations. Existing lines are consumed in the
 * order given (callers pass them by date, then creation), new lines are
 * matched in their own order.
 *
 * Used by the statement import (lib/banking/import/importer.ts) and the
 * API sync (lib/integrations/sync.ts).
 */

export interface DatedAmount {
  /** Signed amount in cents: debits negative, credits positive. */
  amountCents: number
  /** Booking date, yyyy-mm-dd. */
  day: string
  /** Value date, yyyy-mm-dd, when the source has one. */
  valueDay: string | null
}

export interface ExistingLine extends DatedAmount {
  id: string
}

/**
 * Matches each new line to an unused existing line of the same amount and
 * date. Returns the index of each matched new line with the existing line it
 * duplicates.
 */
export function matchProbableDuplicates<E extends ExistingLine>(
  incoming: readonly DatedAmount[],
  existing: readonly E[],
): Map<number, E> {
  // Existing lines by amount, in the given order: a new line only scans its own amount
  const pool = new Map<number, E[]>()
  for (const line of existing) {
    const list = pool.get(line.amountCents)
    if (list) list.push(line)
    else pool.set(line.amountCents, [line])
  }
  const taken = new Set<string>()
  const matches = new Map<number, E>()
  incoming.forEach((line, index) => {
    const sameAmount = (pool.get(line.amountCents) ?? []).filter((e) => !taken.has(e.id))
    // Booking date first, then value date when both sides have one
    const hit =
      sameAmount.find((e) => e.day === line.day) ??
      (line.valueDay ? sameAmount.find((e) => e.valueDay !== null && e.valueDay === line.valueDay) : undefined)
    if (hit) {
      taken.add(hit.id)
      matches.set(index, hit)
    }
  })
  return matches
}


/** First and last day (yyyy-mm-dd, booking or value) of some lines, to load the existing lines around them. */
export function dayWindow(lines: readonly DatedAmount[]): { first: string; last: string } | null {
  const days = lines.flatMap((l) => [l.day, l.valueDay].filter((d): d is string => !!d)).sort()
  return days.length ? { first: days[0], last: days[days.length - 1] } : null
}
