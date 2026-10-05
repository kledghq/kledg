/**
 * The threshold alert of the cash forecast (docs/prevision-tresorerie.md):
 * the first day the projected balance goes under the company's minimum
 * within the horizon. Pure: the API, the dashboard card, the simple home
 * and the page derive it from the same projection.
 */

import type { Projection } from './projection'

export interface CashForecastAlert {
  thresholdCents: number
  horizonMonths: number
  /** First day under the threshold (today when the balance already is), and the balance that day. */
  day: string
  balanceCents: number
  already: boolean
  /** Lowest balance of the horizon and its day. */
  lowest: { day: string; cents: number }
}

/** Null when no threshold is set or the projection stays above it. */
export function alertOf({ projection }: { projection: Projection }): CashForecastAlert | null {
  if (projection.thresholdCents === null || projection.firstBelow === null) return null
  return {
    thresholdCents: projection.thresholdCents,
    horizonMonths: projection.horizonMonths,
    day: projection.firstBelow.day,
    balanceCents: projection.firstBelow.balanceCents,
    already: projection.firstBelow.already,
    lowest: projection.lowest,
  }
}
