/**
 * What the user says about the impôt sur les sociétés of a fiscal year
 * (corporate_tax_returns): the answers to the reduced rate questions, the
 * deficits carried forward, the manual lines, the acomptes paid, and the
 * return filed on impots.gouv.fr. Kledg never files; the filing drives the
 * deficits history and the acomptes of the next year
 * (load-corporate-tax.service.ts). One row per fiscal year, created on
 * first save; only the fields sent change.
 */

import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { calendarDay, centsField } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { loadDeadlineContext } from '@/lib/deadlines/load-deadlines.service'
import { calendarDayOf, todayUtc } from '@/lib/utils/date'
import { centsToDecimal } from '@/lib/utils/money'
import { AcomptePaidSchema, corporateTaxStatusOf, ManualLineSchema } from './load-corporate-tax.service'

const fiscalYearField = z.string({ error: 'L’exercice est requis' }).min(1, 'L’exercice est requis').max(100)

export const CorporateTaxInputsBodySchema = z.object({
  fiscalYearId: fiscalYearField,
  capitalPaidUp: z.boolean().nullable().optional(),
  naturalPersons75: z.boolean().nullable().optional(),
  /** Deficits carried forward at the start of the year, in cents; null: derived from the year before. */
  deficitsOpeningCents: centsField({ min: 0, negative: 'Les déficits reportables ne peuvent pas être négatifs' }).nullable().optional(),
  manualLines: z.array(ManualLineSchema).max(50, 'Au plus 50 lignes').optional(),
  acomptesPaid: z.array(AcomptePaidSchema).max(8, 'Au plus 8 acomptes').optional(),
})
export type CorporateTaxInputsBody = z.infer<typeof CorporateTaxInputsBodySchema>

export const CorporateTaxFilingBodySchema = z.object({
  fiscalYearId: fiscalYearField,
  filedOn: calendarDay('Date de dépôt invalide'),
  /** Résultat fiscal avant imputation des déficits, negative for a deficit (2033-B 352/354, 2058-A XI/XJ). */
  resultBeforeDeficitsCents: centsField(),
  deficitsImputedCents: centsField({ min: 0, negative: 'Les déficits imputés ne peuvent pas être négatifs' }),
  /** IS at the rates of art. 219, before credits. */
  corporateTaxCents: centsField({ min: 0, negative: 'L’impôt ne peut pas être négatif' }),
  reducedRate: z.boolean({ error: 'Indiquez si le taux réduit a été appliqué' }),
})
export type CorporateTaxFilingBody = z.infer<typeof CorporateTaxFilingBodySchema>

export const CorporateTaxFilingQuerySchema = z.object({ fiscalYearId: fiscalYearField })

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const day = (value: Date) => calendarDayOf(value) as string

/** The fiscal year of the company, subject to IS (an IR company has nothing to record). */
async function subjectFiscalYear(companyId: string, fiscalYearId: string) {
  const context = await loadDeadlineContext(companyId)
  const fy = context.fiscalYears.find((y) => y.id === fiscalYearId)
  if (!fy) throw new NotFoundError('Exercice introuvable')
  if (corporateTaxStatusOf(context.company, fy).status !== 'ready') {
    throw new ConflictError('La société n’est pas soumise à l’impôt sur les sociétés pour cet exercice : il n’y a rien à enregistrer.')
  }
  return fy
}

function assertUnique<T>(items: readonly T[], key: (item: T) => string | number, message: string) {
  if (new Set(items.map(key)).size !== items.length) throw new ValidationError(message)
}

export async function saveCorporateTaxInputs(companyId: string, body: CorporateTaxInputsBody, options: { userId?: string; now?: Date } = {}) {
  const fy = await subjectFiscalYear(companyId, body.fiscalYearId)
  if (body.manualLines) assertUnique(body.manualLines, (l) => l.id, 'Deux lignes ont le même identifiant.')
  if (body.acomptesPaid) {
    assertUnique(body.acomptesPaid, (a) => a.number, 'Un même acompte est saisi deux fois.')
    const today = day(todayUtc(options.now))
    for (const a of body.acomptesPaid) {
      if (!calendarDayOf(a.paidOn) || calendarDayOf(a.paidOn) !== a.paidOn) throw new ValidationError(`Date de paiement de l’acompte ${a.number} invalide.`)
      if (a.paidOn > today) throw new ValidationError(`L’acompte ${a.number} ne peut pas être payé dans le futur.`)
    }
  }
  const data: Pick<Prisma.CorporateTaxReturnUncheckedCreateInput, 'capitalPaidUp' | 'naturalPersons75' | 'deficitsOpening' | 'manualLines' | 'acomptesPaid'> = {}
  if (body.capitalPaidUp !== undefined) data.capitalPaidUp = body.capitalPaidUp
  if (body.naturalPersons75 !== undefined) data.naturalPersons75 = body.naturalPersons75
  if (body.deficitsOpeningCents !== undefined) data.deficitsOpening = body.deficitsOpeningCents === null ? null : centsToDecimal(body.deficitsOpeningCents)
  if (body.manualLines !== undefined) data.manualLines = body.manualLines
  if (body.acomptesPaid !== undefined) data.acomptesPaid = [...body.acomptesPaid].sort((a, b) => a.number - b.number)
  await prisma.corporateTaxReturn.upsert({
    where: { fiscalYearId_companyId: { fiscalYearId: fy.id, companyId } },
    create: { ...data, companyId, fiscalYearId: fy.id, createdById: options.userId ?? null },
    update: data,
    select: { id: true },
  })
  await writeAuditLog('info', `Corporate tax inputs saved for fiscal year ${fy.year}`, {
    action: 'SAVE_CORPORATE_TAX_INPUTS',
    companyId,
    metadata: { fiscalYearId: fy.id, fields: Object.keys(data) },
  })
  return { fiscalYearId: fy.id, saved: Object.keys(data) }
}

export interface CorporateTaxFilingSaved {
  fiscalYearId: string
  filedOn: string
  resultBeforeDeficitsCents: number
  deficitsImputedCents: number
  corporateTaxCents: number
  reducedRate: boolean
}

export async function recordCorporateTaxFiling(companyId: string, body: CorporateTaxFilingBody, options: { userId?: string; now?: Date } = {}): Promise<CorporateTaxFilingSaved> {
  const fy = await subjectFiscalYear(companyId, body.fiscalYearId)
  if (body.filedOn <= fy.endDate) throw new ValidationError('La déclaration se dépose après la clôture de l’exercice : vérifiez la date de dépôt.')
  if (body.filedOn > day(todayUtc(options.now))) throw new ValidationError('La date de dépôt ne peut pas être dans le futur.')
  if (body.deficitsImputedCents > Math.max(body.resultBeforeDeficitsCents, 0)) {
    throw new ValidationError('Les déficits imputés ne peuvent pas dépasser le bénéfice avant imputation.')
  }
  if (body.resultBeforeDeficitsCents - body.deficitsImputedCents <= 0 && body.corporateTaxCents > 0) {
    throw new ValidationError('Sans bénéfice imposable, l’impôt sur les sociétés est nul.')
  }
  const data = {
    filedOn: utc(body.filedOn),
    resultBeforeDeficits: centsToDecimal(body.resultBeforeDeficitsCents),
    deficitsImputed: centsToDecimal(body.deficitsImputedCents),
    corporateTax: centsToDecimal(body.corporateTaxCents),
    reducedRate: body.reducedRate,
  }
  await prisma.corporateTaxReturn.upsert({
    where: { fiscalYearId_companyId: { fiscalYearId: fy.id, companyId } },
    create: { companyId, fiscalYearId: fy.id, createdById: options.userId ?? null, ...data },
    update: data,
    select: { id: true },
  })
  await writeAuditLog('info', `Corporate tax return of fiscal year ${fy.year} recorded as filed`, {
    action: 'RECORD_CORPORATE_TAX_FILING',
    companyId,
    metadata: { fiscalYearId: fy.id, filedOn: body.filedOn, corporateTaxCents: body.corporateTaxCents, reducedRate: body.reducedRate },
  })
  return { fiscalYearId: fy.id, filedOn: body.filedOn, resultBeforeDeficitsCents: body.resultBeforeDeficitsCents, deficitsImputedCents: body.deficitsImputedCents, corporateTaxCents: body.corporateTaxCents, reducedRate: body.reducedRate }
}

export async function deleteCorporateTaxFiling(companyId: string, fiscalYearId: string): Promise<{ fiscalYearId: string }> {
  const updated = await prisma.corporateTaxReturn.updateMany({
    where: { companyId, fiscalYearId, filedOn: { not: null } },
    data: { filedOn: null, resultBeforeDeficits: null, deficitsImputed: null, corporateTax: null, reducedRate: null },
  })
  if (updated.count === 0) throw new NotFoundError('Aucun dépôt enregistré pour cet exercice.')
  await writeAuditLog('info', 'Corporate tax filing record removed', { action: 'DELETE_CORPORATE_TAX_FILING', companyId, metadata: { fiscalYearId } })
  return { fiscalYearId }
}
