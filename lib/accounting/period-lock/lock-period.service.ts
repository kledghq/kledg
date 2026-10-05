/**
 * Period closing (clôture des périodes) inside an open fiscal year.
 *
 * PCG art. 1031-4 (règlement ANC n° 2014-03 as amended by n° 2022-06): "une
 * procédure de clôture destinée à figer la chronologie et à garantir
 * l'intangibilité des enregistrements est mise en œuvre au plus tard avant
 * l'expiration de la période suivante"; an operation dated in a closed period
 * is booked on the first day of the open period, with its real date stated.
 * BOI-BIC-DECLA-30-10-20-40 § 130 and 140. Validation makes each entry
 * definitive (art. 1031-3); the period closing freezes the chronology: after
 * it, nothing can be inserted before the closed day.
 *
 * Invariants owned here (and by the triggers of migration
 * 20261108090000_period_lock, for every code path):
 * - the closed day only moves forward and stays before the last day of the
 *   year (closing the last period is closing the year,
 *   lib/accounting/fiscal-year-closure);
 * - a period is closed only once every entry dated in it is validated or
 *   deleted: no draft is left behind a closed day;
 * - entries dated in a closed period are refused by the single entry guard
 *   (assertEntryWritableInFiscalYear, lib/accounting/entry-guards.ts).
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { calendarDay } from '@/lib/api/zod-fields'
import { dayToDate } from '@/lib/accounting/entry-date'
import { lockFiscalYearRow } from '@/lib/accounting/fiscal-year-closure/lock'
import { writeAuditLog } from '@/lib/audit'
import { addIsoDays, calendarDayOf, formatIsoDateFr } from '@/lib/utils/date'

/** Body of POST /api/companies/[id]/fiscal-years/[fiscalYearId]/period-lock. */
export const LockPeriodBodySchema = z.object({
  /** Last day of the period to close, included. */
  through: calendarDay('Indiquez le dernier jour de la période à clôturer'),
})
export type LockPeriodBody = z.infer<typeof LockPeriodBodySchema>

export interface PeriodLock {
  fiscalYearId: string
  /** Last closed day (yyyy-mm-dd), null while no period is closed. */
  periodLockedThrough: string | null
  /** First day entries may still be dated (yyyy-mm-dd). */
  firstOpenDay: string
}

/** Closes the periods of a fiscal year up to `through` (included). */
export async function lockPeriod(companyId: string, fiscalYearId: string, through: string, userId: string): Promise<PeriodLock> {
  const result = await prisma.$transaction(async (tx) => {
    // Same row lock as the closing and the depreciation postings of the year: lock, then read.
    const locked = await lockFiscalYearRow(tx, fiscalYearId, companyId)
    const fiscalYear = locked
      ? await tx.fiscalYear.findFirst({
          where: { id: fiscalYearId, companyId },
          select: { id: true, year: true, startDate: true, endDate: true, isClosed: true, periodLockedThrough: true },
        })
      : null
    if (!fiscalYear) throw new NotFoundError('Exercice introuvable pour cette société.')
    if (fiscalYear.isClosed) throw new ConflictError(`L'exercice ${fiscalYear.year} est clôturé : toutes ses périodes le sont.`)

    const start = calendarDayOf(fiscalYear.startDate)!
    const end = calendarDayOf(fiscalYear.endDate)!
    if (through < start || through >= end) {
      throw new ValidationError(
        `La fin de la période doit être comprise entre le ${formatIsoDateFr(start)} et le ${formatIsoDateFr(addIsoDays(end, -1))} : le dernier jour de l'exercice se clôture avec l'exercice.`,
      )
    }
    const current = calendarDayOf(fiscalYear.periodLockedThrough)
    if (current && through <= current) {
      throw new ConflictError(`La période est déjà clôturée jusqu'au ${formatIsoDateFr(current)} : une période clôturée ne se rouvre pas (PCG art. 1031-4).`)
    }

    const drafts = await tx.accountingEntry.count({
      where: { companyId, fiscalYearId: fiscalYear.id, status: 'draft', date: { lte: dayToDate(through) } },
    })
    if (drafts > 0) {
      throw new ConflictError(
        `${drafts === 1 ? 'Une écriture en brouillon est datée' : `${drafts} écritures en brouillon sont datées`} dans la période : validez-les ou supprimez-les avant de la clôturer.`,
      )
    }

    await tx.fiscalYear.update({
      where: { id: fiscalYear.id },
      data: { periodLockedThrough: dayToDate(through), periodLockedAt: new Date(), periodLockedById: userId },
    })
    return { year: fiscalYear.year, previous: current }
  })

  await writeAuditLog('info', `Period closed through ${through}`, {
    action: 'PERIOD_LOCKED',
    companyId,
    metadata: { fiscalYearId, through, previous: result.previous },
  })
  return { fiscalYearId, periodLockedThrough: through, firstOpenDay: addIsoDays(through, 1) }
}
