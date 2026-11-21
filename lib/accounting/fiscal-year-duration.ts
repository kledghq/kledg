/**
 * Length of an exercice (#139). The accounts are closed "au moins une fois
 * tous les douze mois" (Code de commerce, art. L123-12); the first exercice,
 * or one after a change of closing date, may be longer, and the practice of
 * the greffes caps it at 24 months. Pure: used by the fiscal year service
 * and the FEC import.
 */

import { ValidationError } from '@/lib/accounting/errors'
import { formatIsoDateFr, periodEnd } from '@/lib/utils/date'

/** Longest exercice accepted, in months. */
export const FISCAL_YEAR_MAX_MONTHS = 24

/** Refuses (400) an exercice from `startDay` to `endDay` (ISO days) longer than 24 months. */
export function assertFiscalYearDuration(startDay: string, endDay: string): void {
  const latest = periodEnd(startDay, FISCAL_YEAR_MAX_MONTHS)
  if (endDay > latest) {
    throw new ValidationError(
      `Un exercice ne peut pas dépasser ${FISCAL_YEAR_MAX_MONTHS} mois : commencé le ${formatIsoDateFr(startDay)}, il se termine le ${formatIsoDateFr(latest)} au plus tard (Code de commerce, art. L123-12).`,
    )
  }
}
