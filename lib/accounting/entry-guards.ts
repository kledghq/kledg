/**
 * The single guard for writing entries in a fiscal year.
 *
 * Every entry write goes through assertEntryWritableInFiscalYear: creating,
 * editing, validating or deleting a draft, reversing (contre-passation), the
 * FEC import and the MCP tools. Once a fiscal year is closed its accounts are
 * final (Code de commerce art. L123-12 and R123-177 to R123-179; PCG art.
 * 1031-3 for the definitive character of entries): no entry may be added or
 * changed in it, and corrections go to an open year.
 *
 * isFiscalYearClosed below is the one closed-year check: the closing
 * (lib/accounting/fiscal-year-closure) sets isClosed and closedAt in the
 * transaction that books the closing entries, its helpers
 * (assertFiscalYearOpen, assertDateInOpenFiscalYear in lock.ts) use this
 * function, and database triggers refuse any write in a closed year
 * (migration 20261004090000_fiscal_year_closing_lock).
 *
 * Inside an open year, the periods up to periodLockedThrough are closed (PCG
 * art. 1031-4, lib/accounting/period-lock): no entry dated in them may be
 * created, moved there or validated; the operation is booked on the first
 * open day with its real date as piece date. Database trigger of migration
 * 20261108090000_period_lock.
 */

import { ConflictError, NotFoundError, ValidationError } from './errors'
import { isDayWithin, requireDay, type CalendarDay } from './entry-date'
import { addIsoDays, calendarDayOf, formatIsoDateFr } from '@/lib/utils/date'

export interface GuardedFiscalYear {
  id: string
  year: number
  startDate: Date
  endDate: Date
  isClosed: boolean
  /** Set by the closing; a year with a closing date is closed even if the flag was not loaded. */
  closedAt?: Date | null
  /** Last day of the closed periods of the year (PCG art. 1031-4). */
  periodLockedThrough?: Date | null
}

/** Select clause loading what the guard needs. */
export const GUARDED_FISCAL_YEAR_SELECT = {
  id: true,
  year: true,
  startDate: true,
  endDate: true,
  isClosed: true,
  closedAt: true,
  periodLockedThrough: true,
} as const

/** Whether no entry may be written in this fiscal year any more. */
export function isFiscalYearClosed(fiscalYear: GuardedFiscalYear): boolean {
  return fiscalYear.isClosed || (fiscalYear.closedAt !== null && fiscalYear.closedAt !== undefined)
}

/** First and last day of a fiscal year, as calendar days. */
export function fiscalYearDays(fiscalYear: Pick<GuardedFiscalYear, 'startDate' | 'endDate'>): {
  start: CalendarDay
  end: CalendarDay
} {
  return { start: requireDay(fiscalYear.startDate), end: requireDay(fiscalYear.endDate) }
}

export type EntryWriteAction = 'create' | 'update' | 'validate' | 'delete' | 'reverse' | 'import'

const ACTION_LABELS: Record<EntryWriteAction, string> = {
  create: 'créée',
  update: 'modifiée',
  validate: 'validée',
  delete: 'supprimée',
  reverse: 'passée',
  import: 'importée',
}

/**
 * Throws unless an entry dated `date` may be written in `fiscalYear`:
 * the year must be open and the date inside it.
 */
export function assertEntryWritableInFiscalYear(
  fiscalYear: GuardedFiscalYear | null | undefined,
  date: Date | string,
  action: EntryWriteAction = 'create',
): void {
  if (!fiscalYear) throw new NotFoundError('Exercice introuvable pour cette écriture')
  if (isFiscalYearClosed(fiscalYear)) {
    throw new ConflictError(
      `L'exercice ${fiscalYear.year} est clôturé : aucune écriture ne peut y être ${ACTION_LABELS[action]}.`,
    )
  }
  const day = calendarDayOf(date)
  if (!day) throw new ValidationError("Date de l'écriture invalide")
  const { start, end } = fiscalYearDays(fiscalYear)
  if (!isDayWithin(day, start, end)) {
    throw new ValidationError(
      `La date du ${formatIsoDateFr(day)} est hors de l'exercice ${fiscalYear.year} (du ${formatIsoDateFr(start)} au ${formatIsoDateFr(end)}).`,
    )
  }
  const lockedThrough = calendarDayOf(fiscalYear.periodLockedThrough ?? null)
  if (action !== 'delete' && lockedThrough && day <= lockedThrough) {
    throw new ConflictError(closedPeriodMessage(lockedThrough))
  }
}

/** Refusal of an entry dated in a closed period: where to book it instead (PCG art. 1031-4). */
function closedPeriodMessage(lockedThrough: CalendarDay): string {
  return `La période est clôturée jusqu'au ${formatIsoDateFr(lockedThrough)} (PCG art. 1031-4) : datez l'écriture du ${formatIsoDateFr(addIsoDays(lockedThrough, 1))} au plus tôt et indiquez sa date réelle en date de pièce.`
}

/** The fiscal year (among `fiscalYears`) whose days contain `day`. */
export function fiscalYearContaining<T extends Pick<GuardedFiscalYear, 'startDate' | 'endDate'>>(
  fiscalYears: T[],
  day: CalendarDay,
): T | undefined {
  return fiscalYears.find((fy) => {
    const { start, end } = fiscalYearDays(fy)
    return isDayWithin(day, start, end)
  })
}
