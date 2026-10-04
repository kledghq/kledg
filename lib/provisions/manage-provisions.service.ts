/**
 * Provisions and impairments of a company (lib/provisions/rules.ts for the
 * accounting rules): create, change, delete, and record the balance one
 * requires at the closing of a fiscal year (assessment). The movement that
 * reaches it is booked by the year-end entries (lib/year-end).
 *
 * Invariants owned here:
 * - the allowance account belongs to the category (also a CHECK constraint)
 *   and the nature is one its movements may take;
 * - an impairment of goodwill (2907) is never reversed (PCG art. 214-19);
 * - the fixed asset and the fiscal year are the company's (404 otherwise);
 * - the assessment of a closed fiscal year never changes (PCG art. 1031-4,
 *   also enforced by a trigger), nor one whose entry is validated: the
 *   entry is reversed first;
 * - a provision with a validated movement is never deleted: its history is
 *   in the books.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ClosedFiscalYearError, ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { deleteDraftEntryInTx } from '@/lib/accounting/services/entry-lifecycle.service'
import { calendarDay, optionalCalendarDay, optionalText } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import { isoDateToUtc } from '@/lib/utils/date'
import {
  allowedNatures,
  defaultNature,
  defaultTaxDeductible,
  fixedAssetImpairmentCents,
  isAllowanceAccountOf,
  isGoodwillImpairment,
  NATURE_LABELS,
  PROVISION_CATEGORIES,
  PROVISION_NATURES,
  type ProvisionCategory,
  type ProvisionNature,
} from './rules'
import { getYearEndInventory } from '@/lib/year-end/get-year-end-inventory.service'

export const PROVISION_NOT_FOUND = 'Provision ou dépréciation introuvable'

const cents = (message: string) => z.number({ error: message }).int(message).min(0, message).max(1e13, message)

/** Body of POST /api/provisions (with companyId) and PATCH /api/provisions/[id] (the whole provision). */
export const ProvisionBodySchema = z.object({
  category: z.enum(PROVISION_CATEGORIES, { error: 'Choisissez le type\u00a0: provision pour risques et charges ou dépréciation' }),
  label: z.string({ error: 'Le libellé est requis' }).trim().min(1, 'Le libellé est requis').max(200),
  justification: z
    .string({ error: "Décrivez l'objet et l'estimation" })
    .trim()
    .min(1, "Décrivez l'objet de la provision et comment son montant est estimé")
    .max(4000),
  accountCode: z.string({ error: 'Le compte est requis' }).trim().regex(/^\d{3,10}$/, 'Numéro de compte invalide'),
  nature: z.enum(PROVISION_NATURES).optional(),
  taxDeductible: z.boolean().optional(),
  fixedAssetId: z.string().max(64).nullable().optional(),
  tiersCode: optionalText(40),
  openedOn: calendarDay("Date d'origine invalide"),
  closedOn: optionalCalendarDay('Date de fin invalide'),
  carriedCents: cents('Montant déjà comptabilisé invalide').optional(),
})
export type ProvisionBody = z.infer<typeof ProvisionBodySchema>

export const CreateProvisionBodySchema = ProvisionBodySchema.extend({ companyId: z.string() })

/** Body of PUT /api/provisions/[id]/assessment: the balance required, or for a fixed asset its current value. */
export const AssessmentBodySchema = z
  .object({
    fiscalYearId: z.string({ error: "L'exercice est requis" }).max(64),
    amountCents: cents('Montant invalide').optional(),
    currentValueCents: cents('Valeur actuelle invalide').optional(),
    basis: optionalText(2000),
  })
  .refine((b) => (b.amountCents === undefined) !== (b.currentValueCents === undefined), {
    message: 'Indiquez soit le montant requis, soit la valeur actuelle de l\'immobilisation',
  })
export type AssessmentBody = z.infer<typeof AssessmentBodySchema>

/** ?fiscalYearId= of DELETE /api/provisions/[id]/assessment. */
export const AssessmentQuerySchema = z.object({ fiscalYearId: z.string({ error: "L'exercice est requis" }).max(64) })

interface Normalized {
  category: ProvisionCategory
  label: string
  justification: string
  accountCode: string
  nature: ProvisionNature
  taxDeductible: boolean
  reversible: boolean
  fixedAssetId: string | null
  tiersCode: string | null
  openedOn: Date
  closedOn: Date | null
  carriedAmount: string
}

async function normalize(companyId: string, body: ProvisionBody): Promise<Normalized> {
  const { category, accountCode } = body
  if (!isAllowanceAccountOf(category, accountCode)) {
    const expected = { RISK_CHARGE: '151 ou 152', FIXED_ASSET: '29', INVENTORY: '39', RECEIVABLE: '49', SECURITY: '59' }[category]
    throw new ValidationError(`Le compte ${accountCode} ne convient pas\u00a0: utilisez un compte ${expected} pour ce type.`)
  }
  const nature = body.nature ?? defaultNature(category, accountCode)
  if (!allowedNatures(category, accountCode).includes(nature)) {
    throw new ValidationError(
      `Un mouvement sur le compte ${accountCode} ne peut pas être ${NATURE_LABELS[nature].toLowerCase()}\u00a0: choisissez ${allowedNatures(category, accountCode)
        .map((n) => NATURE_LABELS[n].toLowerCase())
        .join(' ou ')}.`,
    )
  }
  if (body.closedOn && body.closedOn < body.openedOn) throw new ValidationError("La date de fin précède la date d'origine.")
  let fixedAssetId: string | null = null
  if (body.fixedAssetId) {
    if (category !== 'FIXED_ASSET') throw new ValidationError("Seule une dépréciation d'immobilisation se rattache à une immobilisation.")
    const asset = await prisma.fixedAsset.findFirst({ where: { id: body.fixedAssetId, companyId }, select: { id: true } })
    if (!asset) throw new NotFoundError('Immobilisation introuvable')
    fixedAssetId = asset.id
  }
  return {
    category,
    label: body.label,
    justification: body.justification,
    accountCode,
    nature,
    taxDeductible: body.taxDeductible ?? (category === 'RISK_CHARGE' ? defaultTaxDeductible(accountCode) : true),
    // PCG art. 214-19: impairments of goodwill are never reversed
    reversible: !(category === 'FIXED_ASSET' && isGoodwillImpairment(accountCode)),
    fixedAssetId,
    tiersCode: category === 'RECEIVABLE' ? (body.tiersCode ?? null) : null,
    openedOn: isoDateToUtc(body.openedOn),
    closedOn: body.closedOn ? isoDateToUtc(body.closedOn) : null,
    carriedAmount: centsToDecimal(body.carriedCents ?? 0),
  }
}

export async function createProvision(companyId: string, body: ProvisionBody) {
  const data = await normalize(companyId, body)
  const created = await prisma.provision.create({ data: { companyId, ...data }, select: { id: true } })
  await writeAuditLog('info', 'Provision created', { action: 'CREATE_PROVISION', companyId, metadata: { provisionId: created.id, category: data.category } })
  return getProvision(companyId, created.id)
}

export async function getProvision(companyId: string, provisionId: string) {
  const provision = await prisma.provision.findFirst({
    where: { id: provisionId, companyId },
    include: {
      fixedAsset: { select: { id: true, label: true } },
      assessments: { select: { fiscalYearId: true, amount: true, currentValue: true, basis: true, entryId: true } },
    },
  })
  if (!provision) throw new NotFoundError(PROVISION_NOT_FOUND)
  return provision
}

/** Validated movements of a provision: they fix its history (its account, category and carried balance). */
async function bookedEntries(companyId: string, provisionId: string) {
  return prisma.provisionAssessment.findMany({
    where: { companyId, provisionId, entry: { status: 'validated', reversedBy: null } },
    select: { entry: { select: { entryNumber: true } } },
  })
}

export async function updateProvision(companyId: string, provisionId: string, body: ProvisionBody) {
  const existing = await prisma.provision.findFirst({ where: { id: provisionId, companyId } })
  if (!existing) throw new NotFoundError(PROVISION_NOT_FOUND)
  const data = await normalize(companyId, body)
  const booked = await bookedEntries(companyId, provisionId)
  const historyChanged =
    data.category !== existing.category || data.accountCode !== existing.accountCode || data.carriedAmount !== centsToDecimal(parseCents(existing.carriedAmount) ?? 0)
  if (booked.length > 0 && historyChanged) {
    throw new ConflictError(
      `Des mouvements de cette provision sont comptabilisés (écritures n° ${booked.map((b) => b.entry?.entryNumber).join(', ')})\u00a0: son type, son compte et le montant déjà comptabilisé ne peuvent plus changer. Créez une nouvelle provision si besoin.`,
    )
  }
  await prisma.provision.update({ where: { id: existing.id }, data })
  await writeAuditLog('info', 'Provision updated', { action: 'UPDATE_PROVISION', companyId, metadata: { provisionId } })
  return getProvision(companyId, provisionId)
}

/** Deletes a provision with its assessments and their draft entries; refused once a movement is validated. */
export async function deleteProvision(companyId: string, provisionId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const provision = await tx.provision.findFirst({
      where: { id: provisionId, companyId },
      select: { id: true, assessments: { select: { entry: { select: { id: true, entryNumber: true, status: true, reversedBy: { select: { id: true } } } } } } },
    })
    if (!provision) throw new NotFoundError(PROVISION_NOT_FOUND)
    const entries = provision.assessments.flatMap((a) => (a.entry ? [a.entry] : []))
    const booked = entries.filter((e) => e.status === 'validated' && !e.reversedBy)
    if (booked.length > 0) {
      throw new ConflictError(
        `Cette provision a des mouvements comptabilisés (écritures n° ${booked.map((e) => e.entryNumber).join(', ')})\u00a0: contre-passez-les avant de la supprimer, ou indiquez plutôt sa date de fin pour la reprendre.`,
      )
    }
    for (const draft of entries.filter((e) => e.status === 'draft')) await deleteDraftEntryInTx(tx, companyId, draft.id)
    await tx.provision.delete({ where: { id: provision.id } })
  })
  await writeAuditLog('info', 'Provision deleted', { action: 'DELETE_PROVISION', companyId, metadata: { provisionId } })
}

/**
 * Records the balance a provision requires at the closing of a fiscal year
 * (PCG art. 322-1 et seq.: best estimate, reviewed at each closing). For an
 * impairment of a fixed asset followed in Kledg, the current value may be
 * given instead: the impairment is then the excess of the net book value
 * at the end of the year over it (PCG art. 214-15 et seq.). A linked draft
 * is deleted (the next preparation books the new movement); a validated one
 * must be reversed first.
 */
export async function saveAssessment(companyId: string, provisionId: string, body: AssessmentBody) {
  const provision = await prisma.provision.findFirst({ where: { id: provisionId, companyId }, select: { id: true, category: true, fixedAssetId: true } })
  if (!provision) throw new NotFoundError(PROVISION_NOT_FOUND)
  const fiscalYear = await prisma.fiscalYear.findFirst({ where: { id: body.fiscalYearId, companyId }, select: { id: true, year: true, isClosed: true } })
  if (!fiscalYear) throw new NotFoundError('Exercice introuvable pour cette société.')
  if (fiscalYear.isClosed) throw new ClosedFiscalYearError(fiscalYear.year)

  let amountCents: number
  let currentValueCents: number | null = null
  if (body.currentValueCents !== undefined) {
    if (provision.category !== 'FIXED_ASSET' || !provision.fixedAssetId) {
      throw new ValidationError("La valeur actuelle ne s'utilise que pour la dépréciation d'une immobilisation suivie dans Kledg\u00a0: indiquez le montant requis.")
    }
    const inventory = await getYearEndInventory(companyId, fiscalYear.id)
    const view = inventory.provisions.find((p) => p.id === provision.id)
    const netBookValue = view?.fixedAsset?.netBookValueCents ?? 0
    currentValueCents = body.currentValueCents
    amountCents = fixedAssetImpairmentCents(netBookValue, currentValueCents)
  } else {
    amountCents = body.amountCents as number
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.provisionAssessment.findUnique({
      where: { provisionId_fiscalYearId: { provisionId: provision.id, fiscalYearId: fiscalYear.id } },
      select: { id: true, entry: { select: { id: true, entryNumber: true, status: true, reversedBy: { select: { id: true } } } } },
    })
    const entry = existing?.entry
    if (entry && entry.status === 'validated' && !entry.reversedBy) {
      throw new ConflictError(
        `Le mouvement de cet exercice est comptabilisé (écriture n° ${entry.entryNumber})\u00a0: contre-passez l'écriture avant de modifier l'évaluation.`,
      )
    }
    if (entry && entry.status === 'draft') await deleteDraftEntryInTx(tx, companyId, entry.id)
    const data = { amount: centsToDecimal(amountCents), currentValue: currentValueCents === null ? null : centsToDecimal(currentValueCents), basis: body.basis ?? null }
    await tx.provisionAssessment.upsert({
      where: { provisionId_fiscalYearId: { provisionId: provision.id, fiscalYearId: fiscalYear.id } },
      create: { companyId, provisionId: provision.id, fiscalYearId: fiscalYear.id, ...data },
      update: { ...data, entryId: null },
    })
  })
  await writeAuditLog('info', 'Provision assessed', { action: 'ASSESS_PROVISION', companyId, metadata: { provisionId, fiscalYearId: fiscalYear.id, amountCents } })
  return { provisionId: provision.id, fiscalYearId: fiscalYear.id, amountCents, currentValueCents }
}

/** Removes the assessment of a fiscal year (and its draft entry); refused when its entry is validated. */
export async function deleteAssessment(companyId: string, provisionId: string, fiscalYearId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const assessment = await tx.provisionAssessment.findFirst({
      where: { companyId, provisionId, fiscalYearId },
      select: { id: true, fiscalYear: { select: { year: true, isClosed: true } }, entry: { select: { id: true, entryNumber: true, status: true, reversedBy: { select: { id: true } } } } },
    })
    if (!assessment) throw new NotFoundError('Évaluation introuvable')
    if (assessment.fiscalYear.isClosed) throw new ClosedFiscalYearError(assessment.fiscalYear.year)
    const entry = assessment.entry
    if (entry && entry.status === 'validated' && !entry.reversedBy) {
      throw new ConflictError(`Le mouvement de cet exercice est comptabilisé (écriture n° ${entry.entryNumber})\u00a0: contre-passez l'écriture avant de supprimer l'évaluation.`)
    }
    if (entry && entry.status === 'draft') await deleteDraftEntryInTx(tx, companyId, entry.id)
    await tx.provisionAssessment.delete({ where: { id: assessment.id } })
  })
}
