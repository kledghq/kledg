/**
 * What the user says about a VAT return filed on impots.gouv.fr: the day
 * and the amounts declared (vat_return_filings). Kledg never files; the
 * record drives the checks of the next period (load-vat-return.service.ts:
 * the payment booked on 4455, the credit carried on 44567). One record per
 * period, replaced when saved again.
 *
 * Refund of a CA3 credit (#173): the amount requested on form 3519 is CA3
 * line 26, and line 27 carries the rest (line 25 - line 26, notice
 * 3310-NOT-CA3-SD n° 50449#29). So the refund is in whole euros, as every
 * line of the form, it comes only with a credit, never with an amount due,
 * and never exceeds the credit of the period (line 25). The settlement
 * entry then books it on 44583 instead of 44567 (settlement.ts). The
 * minimum amounts of a request (760 € for a month or a quarter, 150 € for
 * December or the fourth quarter: notice 3310-NOT-CA3-SD, line 26;
 * BOI-TVA-DED-50-20-10 § 40 to 60) are shown, not enforced: the
 * administration rules on the request. On the CA12 the request is made on
 * the return itself (cadre VII), not recorded here.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { calendarDay, centsField } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { calendarDayOf, todayUtc } from '@/lib/utils/date'
import { centsToDecimal, formatCentsFr, parseCents } from '@/lib/utils/money'
import { buildVatReturn } from './load-vat-return.service'
import { parseDeadlineSettings } from '@/lib/deadlines/settings'
import { lockOpenYearsThrough, type AutoLockResult } from '@/lib/accounting/period-lock/auto-lock.service'
import { PERIOD_KEY_PATTERN, periodOfKey, type VatForm } from './periods'
import type { VatReturnComputation } from './compute'

const periodField = z.string({ error: 'La période est requise' }).regex(PERIOD_KEY_PATTERN, 'Période invalide : aaaa-mm, aaaa-Tn ou aaaa.')

export const VatFilingBodySchema = z.object({
  period: periodField,
  filedOn: calendarDay('Date de dépôt invalide'),
  /** Amount paid with the return (CA3 line 28, CA12 line 33), in cents. */
  amountDueCents: centsField({ min: 0, negative: 'Le montant à payer ne peut pas être négatif' }),
  /** Credit carried forward (CA3 line 27, CA12 line 35), in cents. */
  creditCents: centsField({ min: 0, negative: 'Le crédit ne peut pas être négatif' }),
  /** CA3 line 26: refund of the credit requested on form 3519, in cents of whole euros; 0 when none. */
  refundCents: centsField({ min: 0, negative: 'Le remboursement demandé ne peut pas être négatif' }).default(0),
})
export type VatFilingBody = z.infer<typeof VatFilingBodySchema>
/** What the service takes: the parsed body, the refund optional (0 when none). */
export type VatFilingInput = Omit<VatFilingBody, 'refundCents'> & { refundCents?: number }

export const VatFilingQuerySchema = z.object({ period: periodField })

export interface VatFilingSaved {
  period: string
  filedOn: string
  amountDueCents: number
  creditCents: number
  refundCents: number
  /** Periods closed with the filing (automatic period closing "after_vat_filing"), null when off. */
  periodLock: AutoLockResult | null
}

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

export async function recordVatFiling(companyId: string, input: VatFilingInput, options: { userId?: string; now?: Date } = {}): Promise<VatFilingSaved> {
  const body: VatFilingBody = { ...input, refundCents: input.refundCents ?? 0 }
  // The period must be one of the company's returns (regime and settings), as the worksheet lists them.
  const { view } = await buildVatReturn(companyId, body.period, options.now)
  const period = view.period ?? periodOfKey(body.period)
  if (view.status !== 'ready' || !period) throw new ValidationError('Aucune déclaration de TVA sur cette période.')
  if (body.amountDueCents > 0 && (body.creditCents > 0 || body.refundCents > 0)) {
    throw new ValidationError('Une déclaration fait apparaître soit un montant à payer, soit un crédit : laissez l’un des deux à zéro.')
  }
  if (body.refundCents > 0) refundRule(period.form, body.refundCents, view.computation)
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
    refundAmount: centsToDecimal(body.refundCents),
    createdById: options.userId ?? null,
  }
  const saved = await prisma.vatReturnFiling.upsert({
    where: { companyId_periodKey: { companyId, periodKey: period.id } },
    create: { companyId, periodKey: period.id, ...data },
    update: data,
    select: { periodKey: true, filedOn: true, amountDue: true, creditAmount: true, refundAmount: true },
  })
  await writeAuditLog('info', `VAT return ${period.form} ${period.id} recorded as filed`, {
    action: 'RECORD_VAT_FILING',
    companyId,
    metadata: { period: period.id, form: period.form, filedOn: body.filedOn, amountDueCents: body.amountDueCents, creditCents: body.creditCents, refundCents: body.refundCents },
  })
  // Automatic period closing after a VAT filing (lib/deadlines/settings.ts, PCG art. 1031-4)
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { deadlineSettings: true } })
  const periodLock =
    parseDeadlineSettings(company?.deadlineSettings).periodAutoLock === 'after_vat_filing'
      ? await lockOpenYearsThrough(companyId, period.end, options.userId, { beforeKledgTaxDrafts: true })
      : null
  return {
    periodLock,
    period: saved.periodKey,
    filedOn: calendarDayOf(saved.filedOn) as string,
    amountDueCents: parseCents(saved.amountDue) ?? 0,
    creditCents: parseCents(saved.creditAmount) ?? 0,
    refundCents: parseCents(saved.refundAmount) ?? 0,
  }
}

/** The credit of the period on line 25, whole euros: line 26 (refund) plus line 27 (carried). */
function periodCreditEuros(computation: Pick<VatReturnComputation, 'result'>): number {
  return computation.result.creditEuros + computation.result.refundEuros
}

/**
 * A refund requested on form 3519 (CA3 line 26): a CA3 only, whole euros,
 * at most the credit of the period (line 25), the rest carried on line 27
 * (notice 3310-NOT-CA3-SD n° 50449#29; BOI-TVA-DED-50-20-10).
 */
function refundRule(form: VatForm, refundCents: number, computation: Pick<VatReturnComputation, 'result'> | null): void {
  if (form !== 'CA3') {
    throw new ValidationError('Le remboursement demandé sur le formulaire 3519 se déclare ligne 26 de la CA3. Sur la CA12, la demande se fait sur la déclaration elle-même.')
  }
  if (refundCents % 100 !== 0) {
    throw new ValidationError('Le remboursement demandé se déclare en euros entiers, comme la ligne 26 de la CA3.')
  }
  const creditEuros = computation ? periodCreditEuros(computation) : 0
  if (refundCents > creditEuros * 100) {
    throw new ValidationError(
      creditEuros > 0
        ? `Le remboursement demandé (${formatCentsFr(refundCents)}) dépasse le crédit de TVA de la période (ligne 25 : ${formatCentsFr(creditEuros * 100)}). Le crédit non remboursé se reporte ligne 27.`
        : 'La déclaration de cette période ne fait pas apparaître de crédit de TVA (ligne 25) : il n’y a rien à rembourser.',
    )
  }
}

export async function deleteVatFiling(companyId: string, periodKey: string): Promise<{ period: string }> {
  const deleted = await prisma.vatReturnFiling.deleteMany({ where: { companyId, periodKey } })
  if (deleted.count === 0) throw new NotFoundError('Aucun dépôt enregistré pour cette période.')
  await writeAuditLog('info', `VAT return ${periodKey} filing record removed`, { action: 'DELETE_VAT_FILING', companyId, metadata: { period: periodKey } })
  return { period: periodKey }
}
