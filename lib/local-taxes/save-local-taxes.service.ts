/**
 * What the user enters on the local taxes page (local_taxes): the CFE avis
 * d'imposition of a year (total, acompte asked, date, note) and the manual
 * adjustments of the CVAE value added. One row per company and year,
 * created on first save; only the parts sent change; a row left empty is
 * deleted. Kledg never files nor pays.
 */

import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { centsField, optionalCalendarDay, optionalText } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { calendarDayOf, todayUtc } from '@/lib/utils/date'
import { centsToDecimal } from '@/lib/utils/money'
import { CvaeAdjustmentSchema } from './load-local-taxes.service'

export const SaveLocalTaxesBodySchema = z.object({
  year: z.number({ error: 'L’année est requise' }).int('Année invalide').min(2010, 'Année invalide').max(2100, 'Année invalide'),
  /** The CFE avis; null removes it. */
  cfe: z
    .object({
      totalCents: centsField({ min: 0, negative: 'Le montant de la CFE ne peut pas être négatif' }),
      acompteCents: centsField({ min: 0, negative: 'L’acompte ne peut pas être négatif' }).nullable().optional(),
      noticeOn: optionalCalendarDay('Date de l’avis invalide'),
      note: optionalText(500),
    })
    .nullable()
    .optional(),
  cvaeAdjustments: z.array(CvaeAdjustmentSchema).max(30, 'Au plus 30 ajustements').optional(),
})
export type SaveLocalTaxesBody = z.infer<typeof SaveLocalTaxesBodySchema>

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

export async function saveLocalTaxes(companyId: string, body: SaveLocalTaxesBody, options: { userId?: string; now?: Date } = {}): Promise<{ year: number; saved: string[] }> {
  if (body.cfe) {
    if (body.cfe.acompteCents !== null && body.cfe.acompteCents !== undefined && body.cfe.acompteCents > body.cfe.totalCents) {
      throw new ValidationError('L’acompte ne peut pas dépasser le montant total de la CFE.')
    }
    if (body.cfe.noticeOn && body.cfe.noticeOn > (calendarDayOf(todayUtc(options.now)) as string)) {
      throw new ValidationError('La date de l’avis ne peut pas être dans le futur.')
    }
  }
  if (body.cvaeAdjustments && new Set(body.cvaeAdjustments.map((a) => a.id)).size !== body.cvaeAdjustments.length) {
    throw new ValidationError('Deux ajustements ont le même identifiant.')
  }

  const data: Pick<Prisma.LocalTaxYearUncheckedCreateInput, 'cfeTotal' | 'cfeAcompte' | 'cfeNoticeOn' | 'cfeNote' | 'cvaeAdjustments'> = {}
  if (body.cfe !== undefined) {
    data.cfeTotal = body.cfe ? centsToDecimal(body.cfe.totalCents) : null
    data.cfeAcompte = body.cfe?.acompteCents === null || body.cfe?.acompteCents === undefined ? null : centsToDecimal(body.cfe.acompteCents)
    data.cfeNoticeOn = body.cfe?.noticeOn ? utc(body.cfe.noticeOn) : null
    data.cfeNote = body.cfe?.note ?? null
  }
  if (body.cvaeAdjustments !== undefined) data.cvaeAdjustments = body.cvaeAdjustments

  await prisma.$transaction(async (tx) => {
    const saved = await tx.localTaxYear.upsert({
      where: { companyId_year: { companyId, year: body.year } },
      create: { ...data, companyId, year: body.year, createdById: options.userId ?? null },
      update: data,
      select: { id: true, cfeTotal: true, cvaeAdjustments: true },
    })
    const adjustments = Array.isArray(saved.cvaeAdjustments) ? saved.cvaeAdjustments : []
    if (saved.cfeTotal === null && adjustments.length === 0) await tx.localTaxYear.delete({ where: { id: saved.id } })
  })
  await writeAuditLog('info', `Local taxes of ${body.year} saved`, {
    action: 'SAVE_LOCAL_TAXES',
    companyId,
    metadata: { year: body.year, fields: Object.keys(data), cfeTotalCents: body.cfe?.totalCents ?? null },
  })
  return { year: body.year, saved: Object.keys(data) }
}
