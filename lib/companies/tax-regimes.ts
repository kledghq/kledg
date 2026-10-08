/**
 * Tax regimes of a company over time (VAT and corporate tax): which regime
 * applies on a given day, and the history the settings page edits.
 *
 * Dates are calendar days stored at midnight UTC. Adding a regime closes the
 * open regime of the same type the day before the new one starts. Every
 * write is scoped by the company: a regime or an establishment of another
 * company is a 404.
 */

import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { addUtcDays, isoDateToUtc } from '@/lib/utils/date'
import { calendarDay, optionalCalendarDay } from '@/lib/api/zod-fields'

export type RegimeType = 'vat' | 'corporateTax'
export type VATRegime = 'normal' | 'simplified' | 'franchise' | 'real' | 'mini_real'
export type CorporateTaxRegime = 'normal' | 'simplified' | 'micro'

interface TaxRegimeHistory {
  id: string
  companyId: string
  regimeType: RegimeType
  regime: string
  startDate: Date
  endDate: Date | null
  notes: string | null
  isVatExempt: boolean
  vatExemptReason: string | null
  establishmentId: string | null
}

/**
 * Obtient le régime actif pour un type donné à une date donnée
 */
export async function getActiveRegime(
  companyId: string,
  regimeType: RegimeType,
  date: Date
): Promise<string | null> {
  const history = await prisma.taxRegimeHistory.findFirst({
    where: {
      companyId,
      regimeType,
      startDate: {
        lte: date,
      },
      OR: [
        { endDate: null },
        { endDate: { gte: date } },
      ],
    },
    orderBy: {
      startDate: 'desc',
    },
  })

  return history?.regime || null
}

/**
 * Obtient le régime de TVA actif à une date donnée
 */
export async function getVATRegime(
  companyId: string,
  date: Date
): Promise<VATRegime | null> {
  const regime = await getActiveRegime(companyId, 'vat', date)
  return regime as VATRegime | null
}

/**
 * Obtient le régime d'IS actif à une date donnée
 */
export async function getCorporateTaxRegime(
  companyId: string,
  date: Date
): Promise<CorporateTaxRegime | null> {
  const regime = await getActiveRegime(companyId, 'corporateTax', date)
  return regime as CorporateTaxRegime | null
}


const REGIME_NOT_FOUND_MESSAGE = 'Régime fiscal non trouvé'
const ESTABLISHMENT_NOT_FOUND_MESSAGE = "Établissement non trouvé ou n'appartient pas à cette société"
const EXEMPTION_TYPE_MESSAGE = "L'exonération de TVA ne peut être appliquée qu'aux régimes de TVA"
const EXEMPTION_REASON_MESSAGE = "La raison de l'exonération de TVA est requise lorsque isVatExempt est true"

const REGIME_TYPES = ['vat', 'corporateTax'] as const

/** Query of GET /api/companies/[id]/tax-regimes. */
export const TaxRegimeQuerySchema = z.object({
  regimeType: z.enum(REGIME_TYPES, { error: 'regimeType doit être "vat" ou "corporateTax"' }).optional(),
})

const regimeFields = {
  notes: z.string().max(2000).nullable().optional(),
  isVatExempt: z.boolean().optional(),
  vatExemptReason: z.string().max(500).nullable().optional(),
  establishmentId: z.string().nullable().optional(),
}

/** Body of POST /api/companies/[id]/tax-regimes. */
export const AddTaxRegimeSchema = z.object({
  regimeType: z.enum(REGIME_TYPES, { error: 'regimeType doit être "vat" ou "corporateTax"' }),
  regime: z.string({ error: 'regime est requis' }).trim().min(1, 'regime est requis').max(50),
  startDate: calendarDay('startDate doit être une date valide'),
  ...regimeFields,
})

/** Body of PATCH /api/companies/[id]/tax-regimes (the regime id is in the body). */
export const UpdateTaxRegimeSchema = z.object({
  id: z.string({ error: 'id est requis' }).min(1, 'id est requis'),
  regime: z.string().trim().min(1).max(50).optional(),
  startDate: calendarDay('startDate doit être une date valide').optional(),
  endDate: optionalCalendarDay('endDate doit être une date valide'),
  ...regimeFields,
})

/** Query of DELETE /api/companies/[id]/tax-regimes?id=. */
export const DeleteTaxRegimeQuerySchema = z.object({
  id: z.string({ error: 'id est requis' }).min(1, 'id est requis'),
})

export type AddTaxRegimeInput = z.infer<typeof AddTaxRegimeSchema>
export type UpdateTaxRegimeInput = Omit<z.infer<typeof UpdateTaxRegimeSchema>, 'id'>

function asHistory(row: Prisma.TaxRegimeHistoryGetPayload<object>): TaxRegimeHistory {
  return { ...row, regimeType: row.regimeType as RegimeType }
}

/** An exemption is a VAT matter and needs its reason. */
function assertExemption(regimeType: string, isVatExempt: boolean | undefined, reason: string | null | undefined): void {
  if (!isVatExempt) return
  if (regimeType !== 'vat') throw new ValidationError(EXEMPTION_TYPE_MESSAGE)
  if (!reason) throw new ValidationError(EXEMPTION_REASON_MESSAGE)
}

async function assertEstablishmentOfCompany(
  tx: Prisma.TransactionClient,
  companyId: string,
  establishmentId: string | null | undefined,
): Promise<void> {
  if (!establishmentId) return
  const establishment = await tx.establishment.findFirst({ where: { id: establishmentId, companyId }, select: { id: true } })
  if (!establishment) throw new NotFoundError(ESTABLISHMENT_NOT_FOUND_MESSAGE)
}

/**
 * Adds a regime to the company's history and closes the open regime of the
 * same type on the day before the new one starts.
 */
export async function addTaxRegime(companyId: string, input: AddTaxRegimeInput): Promise<TaxRegimeHistory> {
  assertExemption(input.regimeType, input.isVatExempt, input.vatExemptReason)
  const startDate = isoDateToUtc(input.startDate)
  return prisma.$transaction(async (tx) => {
    await assertEstablishmentOfCompany(tx, companyId, input.establishmentId)
    await tx.taxRegimeHistory.updateMany({
      where: { companyId, regimeType: input.regimeType, endDate: null },
      data: { endDate: addUtcDays(startDate, -1) },
    })
    const created = await tx.taxRegimeHistory.create({
      data: {
        companyId,
        regimeType: input.regimeType,
        regime: input.regime,
        startDate,
        notes: input.notes || null,
        isVatExempt: input.isVatExempt || false,
        vatExemptReason: input.vatExemptReason || null,
        establishmentId: input.establishmentId || null,
      },
    })
    return asHistory(created)
  })
}

/**
 * Obtient tout l'historique des régimes pour une société
 */
export async function getTaxRegimeHistory(
  companyId: string,
  regimeType?: RegimeType
): Promise<TaxRegimeHistory[]> {
  const results = await prisma.taxRegimeHistory.findMany({
    where: {
      companyId,
      ...(regimeType && { regimeType }),
    },
    include: {
      establishment: {
        select: {
          id: true,
          siret: true,
          name: true,
        },
      },
    },
    orderBy: {
      startDate: 'desc',
    },
  })
  return results.map((r) => ({
    id: r.id,
    companyId: r.companyId,
    regimeType: r.regimeType as RegimeType,
    regime: r.regime,
    startDate: r.startDate,
    endDate: r.endDate,
    notes: r.notes,
    isVatExempt: r.isVatExempt,
    vatExemptReason: r.vatExemptReason,
    establishmentId: r.establishmentId,
  }))
}

/** Updates a regime of the company (fields left undefined keep their value). */
export async function updateTaxRegime(companyId: string, id: string, input: UpdateTaxRegimeInput): Promise<TaxRegimeHistory> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.taxRegimeHistory.findFirst({ where: { id, companyId }, select: { id: true, regimeType: true } })
    if (!existing) throw new NotFoundError(REGIME_NOT_FOUND_MESSAGE)
    assertExemption(existing.regimeType, input.isVatExempt, input.vatExemptReason)
    await assertEstablishmentOfCompany(tx, companyId, input.establishmentId)

    const data: Prisma.TaxRegimeHistoryUncheckedUpdateInput = {}
    if (input.regime !== undefined) data.regime = input.regime
    if (input.startDate !== undefined) data.startDate = isoDateToUtc(input.startDate)
    if (input.endDate !== undefined) data.endDate = input.endDate ? isoDateToUtc(input.endDate) : null
    if (input.notes !== undefined) data.notes = input.notes
    if (input.isVatExempt !== undefined) data.isVatExempt = input.isVatExempt
    if (input.vatExemptReason !== undefined) data.vatExemptReason = input.vatExemptReason
    if (input.establishmentId !== undefined) data.establishmentId = input.establishmentId

    return asHistory(await tx.taxRegimeHistory.update({ where: { id: existing.id }, data }))
  })
}

/** Deletes a regime of the company's history. */
export async function deleteTaxRegime(companyId: string, id: string): Promise<void> {
  const { count } = await prisma.taxRegimeHistory.deleteMany({ where: { id, companyId } })
  if (count === 0) throw new NotFoundError(REGIME_NOT_FOUND_MESSAGE)
}
