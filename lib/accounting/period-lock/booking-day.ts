/**
 * The tax entries Kledg prepares as drafts (VAT settlement, coefficient
 * regularisation, payroll tax, corporate tax, CFE) and closed periods.
 *
 * PCG art. 1031-4 and BOI-BIC-DECLA-30-10-20-40 § 130 and 140: a period is
 * closed "au plus tard avant l'expiration de la période suivante", and an
 * operation that belongs to a closed period "est enregistrée à la date du
 * premier jour de la période non encore clôturée, avec mention expresse de
 * sa date de survenance". So:
 * - a draft whose natural day (the end of the VAT period, 31 December, 31
 *   March...) is in a closed period is dated on the first open day, its
 *   natural day kept as the date of the document (FEC PieceDate)
 *   (bookingDayInTx);
 * - the automatic closing after a VAT filing stops the day before the first
 *   of these drafts still waiting in the period, rather than giving up
 *   (auto-lock.service.ts); the next closing covers the rest once it is
 *   validated, still before the end of the following period.
 */

import type { Prisma } from '@prisma/client'
import { addIsoDays, calendarDayOf, formatIsoDateFr } from '@/lib/utils/date'

/**
 * References of the drafts Kledg prepares: TVA-CA3-2026-09 and TVA-CA12-2026
 * (lib/vat-returns/settlement.ts), COEF-TVA-2026 (lib/vat-deduction/rules.ts),
 * TS-2026 (lib/payroll-tax/rules.ts), IS-2026 and IS-AC-2026-1
 * (lib/corporate-tax), CFE-2026-AC and CFE-2026-SOLDE (lib/local-taxes).
 */
const KLEDG_TAX_DRAFT_REFERENCES = [/^TVA-CA(3|12)-\d{4}/, /^COEF-TVA-\d{4}$/, /^TS-\d{4}$/, /^IS-\d{4}$/, /^IS-AC-\d{4}-\d+$/, /^CFE-\d{4}-(AC|SOLDE)$/]
/** Prefixes to narrow the query before the patterns. */
export const KLEDG_TAX_DRAFT_PREFIXES = ['TVA-CA', 'COEF-TVA-', 'TS-', 'IS-', 'CFE-'] as const

export function isKledgTaxDraftReference(reference: string | null | undefined): boolean {
  return !!reference && KLEDG_TAX_DRAFT_REFERENCES.some((pattern) => pattern.test(reference))
}

export interface BookingDay {
  /** Day of the entry (yyyy-mm-dd): the natural day, or the first open day after a closed period. */
  date: string
  /** The natural day when the entry was moved, kept as the date of the document; null otherwise. */
  pieceDate: string | null
}

/**
 * The day to book an operation of `day` in the fiscal year (read under the
 * caller's row lock of the year, lockFiscalYearRow): `day` itself, or the
 * day after the closed period when `day` is in it. The closed day is always
 * before the last day of the year (lock-period.service.ts), so the result
 * stays in the year.
 */
export async function bookingDayInTx(tx: Pick<Prisma.TransactionClient, 'fiscalYear'>, fiscalYearId: string, day: string): Promise<BookingDay> {
  const year = await tx.fiscalYear.findUnique({ where: { id: fiscalYearId }, select: { periodLockedThrough: true } })
  const lockedThrough = calendarDayOf(year?.periodLockedThrough ?? null)
  if (!lockedThrough || day > lockedThrough) return { date: day, pieceDate: null }
  return { date: addIsoDays(lockedThrough, 1), pieceDate: day }
}

/** The French note added to a draft moved out of a closed period. */
export function movedDraftNote(booking: BookingDay): string | null {
  if (!booking.pieceDate) return null
  return `La période est clôturée jusqu'au ${formatIsoDateFr(addIsoDays(booking.date, -1))} : l'écriture est datée du ${formatIsoDateFr(booking.date)}, premier jour ouvert, avec sa date réelle (${formatIsoDateFr(booking.pieceDate)}) en date de pièce (PCG art. 1031-4).`
}
