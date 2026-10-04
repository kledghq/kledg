/**
 * What the user says about a VAT return filed on impots.gouv.fr: the day
 * and the amounts declared (vat_return_filings). Kledg never files; the
 * record drives the checks of the next period (load-vat-return.service.ts:
 * the payment booked on 4455, the credit carried on 44567). One record per
 * period, replaced when saved again.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { calendarDay, centsField } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { calendarDayOf, todayUtc } from '@/lib/utils/date'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import { buildVatReturn } from './load-vat-return.service'
import { PERIOD_KEY_PATTERN, periodOfKey } from './periods'

const periodField = z.string({ error: 'La période est requise' }).regex(PERIOD_KEY_PATTERN, 'Période invalide : aaaa-mm, aaaa-Tn ou aaaa.')

export const VatFilingBodySchema = z.object({
  period: periodField,
  filedOn: calendarDay('Date de dépôt invalide'),
  /** Amount paid with the return (CA3 line 28, CA12 line 33), in cents. */
  amountDueCents: centsField({ min: 0, negative: 'Le montant à payer ne peut pas être négatif' }),
  /** Credit carried forward (CA3 line 27, CA12 line 35), in cents. */
  creditCents: centsField({ min: 0, negative: 'Le crédit ne peut pas être négatif' }),
})
export type VatFilingBody = z.infer<typeof VatFilingBodySchema>

export const VatFilingQuerySchema = z.object({ period: periodField })

export interface VatFilingSaved {
  period: string
  filedOn: string
  amountDueCents: number
  creditCents: number
}

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

export async function recordVatFiling(companyId: string, body: VatFilingBody, options: { userId?: string; now?: Date } = {}): Promise<VatFilingSaved> {
  // The period must be one of the company's returns (regime and settings), as the worksheet lists them.
  const { view } = await buildVatReturn(companyId, body.period, options.now)
  const period = view.period ?? periodOfKey(body.period)
  if (view.status !== 'ready' || !period) throw new ValidationError('Aucune déclaration de TVA sur cette période.')
  if (body.amountDueCents > 0 && body.creditCents > 0) {
    throw new ValidationError('Une déclaration fait apparaître soit un montant à payer, soit un crédit : laissez l’un des deux à zéro.')
  }
  if (body.filedOn < period.start) {
    throw new ValidationError('La date de dépôt précède la période déclarée.')
  }
  const today = calendarDayOf(todayUtc(options.now)) as string
  if (body.filedOn > today) throw new ValidationError('La date de dépôt ne peut pas être dans le futur.')

  const data = {
    form: period.form,
    periodStart: utc(period.start),
    periodEnd: utc(period.end),
    filedOn: utc(body.filedOn),
    amountDue: centsToDecimal(body.amountDueCents),
    creditAmount: centsToDecimal(body.creditCents),
    createdById: options.userId ?? null,
  }
  const saved = await prisma.vatReturnFiling.upsert({
    where: { companyId_periodKey: { companyId, periodKey: period.key } },
    create: { companyId, periodKey: period.key, ...data },
    update: data,
    select: { periodKey: true, filedOn: true, amountDue: true, creditAmount: true },
  })
  await writeAuditLog('info', `VAT return ${period.form} ${period.key} recorded as filed`, {
    action: 'RECORD_VAT_FILING',
    companyId,
    metadata: { period: period.key, form: period.form, filedOn: body.filedOn, amountDueCents: body.amountDueCents, creditCents: body.creditCents },
  })
  return {
    period: saved.periodKey,
    filedOn: calendarDayOf(saved.filedOn) as string,
    amountDueCents: parseCents(saved.amountDue) ?? 0,
    creditCents: parseCents(saved.creditAmount) ?? 0,
  }
}

export async function deleteVatFiling(companyId: string, periodKey: string): Promise<{ period: string }> {
  const deleted = await prisma.vatReturnFiling.deleteMany({ where: { companyId, periodKey } })
  if (deleted.count === 0) throw new NotFoundError('Aucun dépôt enregistré pour cette période.')
  await writeAuditLog('info', `VAT return ${periodKey} filing record removed`, { action: 'DELETE_VAT_FILING', companyId, metadata: { period: periodKey } })
  return { period: periodKey }
}
