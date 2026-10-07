/**
 * Establishments (SIRET) of a company: list, create, update, deactivate.
 * Used by /api/companies/[id]/establishments.
 *
 * Invariants owned here:
 * - a company has at most one main establishment (siège social); the first
 *   establishment becomes the main one, and deactivating the main one hands
 *   the role to another active establishment;
 * - the company's headquarters address follows the main establishment's
 *   address;
 * - the SIREN of an establishment is the first 9 digits of its SIRET.
 *
 * Every function takes the company id and only touches establishments of
 * that company (another company's id is a 404), and only attaches addresses
 * owned by the company (lib/addresses/manage-addresses.service.ts).
 * Multi-row changes run in one transaction so two main establishments
 * never coexist; an address the change left unused (the establishment's or
 * the headquarters' previous one) is deleted in the same transaction.
 */

import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import {
  assertAddressUsableByCompany,
  deleteAddressesIfUnused,
  prismaAddressToAddressType,
} from '@/lib/addresses/manage-addresses.service'
import { isoDateToUtc } from '@/lib/utils/date'
import { optionalCalendarDay, optionalText } from '@/lib/api/zod-fields'

export const ESTABLISHMENT_NOT_FOUND_MESSAGE = 'Établissement introuvable'
const SIRET_FORMAT_MESSAGE = 'Le SIRET doit contenir exactement 14 chiffres'
const SIRET_TAKEN_MESSAGE = 'Un établissement avec ce SIRET existe déjà'

/** Address id from a form: '' and null detach the address. */
const addressId = z
  .string()
  .nullable()
  .transform((value) => (value?.trim() ? value.trim() : null))
  .optional()

const establishmentFields = {
  name: optionalText(200),
  addressId,
  activityCode: optionalText(10),
  isMain: z.boolean().optional(),
  notes: optionalText(2000),
  isTrainingOrganization: z.boolean().optional(),
  trainingActivityDeclarationNumber: optionalText(50),
  trainingActivityDeclarationDate: optionalCalendarDay("Date de déclaration d'activité invalide."),
}

/** Body of POST /api/companies/[id]/establishments. */
export const CreateEstablishmentSchema = z.object({
  siret: z
    .string({ error: 'Le SIRET est requis' })
    .trim()
    .min(1, 'Le SIRET est requis')
    .regex(/^\d{14}$/, SIRET_FORMAT_MESSAGE),
  ...establishmentFields,
})

/** Body of PATCH /api/companies/[id]/establishments/[establishmentId]: every field optional. */
export const UpdateEstablishmentSchema = z.object({
  /** Validated only when it changes ('' keeps the current SIRET). */
  siret: z.string().trim().nullable().optional(),
  isActive: z.boolean().optional(),
  ...establishmentFields,
})

export type CreateEstablishmentInput = z.infer<typeof CreateEstablishmentSchema>
export type UpdateEstablishmentInput = z.infer<typeof UpdateEstablishmentSchema>

const ESTABLISHMENT_INCLUDE = { address: true } satisfies Prisma.EstablishmentInclude
type EstablishmentRow = Prisma.EstablishmentGetPayload<{ include: typeof ESTABLISHMENT_INCLUDE }>

/** The establishment as the API returns it: the address in the shared Address shape. */
function present(establishment: EstablishmentRow) {
  return { ...establishment, address: prismaAddressToAddressType(establishment.address) }
}

/** SIREN = first 9 digits of the SIRET. */
function sirenOf(siret: string): string {
  return siret.length < 9 ? '' : siret.substring(0, 9)
}

async function assertSiretAvailable(siret: string, client: Prisma.TransactionClient): Promise<void> {
  const existing = await client.establishment.findUnique({ where: { siret }, select: { id: true } })
  if (existing) throw new ConflictError(SIRET_TAKEN_MESSAGE)
}

/** The company's current headquarters address id, read before a change that may replace it. */
async function headquartersAddressIdOf(tx: Prisma.TransactionClient, companyId: string): Promise<string | null> {
  const company = await tx.company.findUnique({ where: { id: companyId }, select: { headquartersAddressId: true } })
  return company?.headquartersAddressId ?? null
}

/** Points the company's headquarters address at the main establishment's address (or clears it). */
async function syncHeadquartersAddress(tx: Prisma.TransactionClient, companyId: string, addressId: string | null): Promise<void> {
  await tx.company.update({
    where: { id: companyId },
    data: { headquartersAddress: addressId ? { connect: { id: addressId } } : { disconnect: true } },
  })
}

/** Active establishments of the company, the main one first. */
export async function getCompanyEstablishments(companyId: string) {
  const establishments = await prisma.establishment.findMany({
    where: { companyId, isActive: true },
    include: ESTABLISHMENT_INCLUDE,
    orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }],
  })
  return establishments.map(present)
}

/**
 * Creates an establishment. With isMain, it replaces the current main
 * establishment; without, it becomes the main one when the company has none.
 */
export async function createEstablishment(companyId: string, input: CreateEstablishmentInput) {
  return prisma.$transaction(async (tx) => {
    await assertSiretAvailable(input.siret, tx)
    if (input.addressId) await assertAddressUsableByCompany(tx, companyId, input.addressId)

    let isMain = input.isMain ?? false
    if (isMain) {
      await tx.establishment.updateMany({ where: { companyId, isMain: true }, data: { isMain: false } })
    } else {
      const main = await tx.establishment.findFirst({ where: { companyId, isMain: true, isActive: true }, select: { id: true } })
      isMain = !main
    }

    const establishment = await tx.establishment.create({
      data: {
        companyId,
        siret: input.siret,
        siren: sirenOf(input.siret),
        name: input.name ?? null,
        addressId: input.addressId ?? null,
        activityCode: input.activityCode ?? null,
        isMain,
        isActive: true,
        notes: input.notes ?? null,
        isTrainingOrganization: input.isTrainingOrganization ?? false,
        trainingActivityDeclarationNumber: input.trainingActivityDeclarationNumber ?? null,
        trainingActivityDeclarationDate: input.trainingActivityDeclarationDate
          ? isoDateToUtc(input.trainingActivityDeclarationDate)
          : null,
      },
      include: ESTABLISHMENT_INCLUDE,
    })

    if (establishment.isMain && establishment.addressId) {
      const previousHeadquarters = await headquartersAddressIdOf(tx, companyId)
      await syncHeadquartersAddress(tx, companyId, establishment.addressId)
      await deleteAddressesIfUnused(tx, companyId, [previousHeadquarters])
    }
    return present(establishment)
  })
}

/**
 * Updates an establishment of the company. Setting isMain demotes the other
 * main establishment; the headquarters address follows the main
 * establishment when its address or its main flag changes.
 */
export async function updateEstablishment(companyId: string, establishmentId: string, input: UpdateEstablishmentInput) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.establishment.findFirst({
      where: { id: establishmentId, companyId },
      select: { id: true, siret: true, addressId: true },
    })
    if (!current) throw new NotFoundError(ESTABLISHMENT_NOT_FOUND_MESSAGE)
    const previousHeadquarters = await headquartersAddressIdOf(tx, companyId)

    const data: Prisma.EstablishmentUpdateInput = {}
    if (input.siret && input.siret !== current.siret) {
      if (!/^\d{14}$/.test(input.siret)) throw new ValidationError(SIRET_FORMAT_MESSAGE)
      await assertSiretAvailable(input.siret, tx)
      data.siret = input.siret
      data.siren = sirenOf(input.siret)
    }
    if (input.addressId) await assertAddressUsableByCompany(tx, companyId, input.addressId)
    if (input.addressId !== undefined) {
      data.address = input.addressId ? { connect: { id: input.addressId } } : { disconnect: true }
    }
    if (input.name !== undefined) data.name = input.name
    if (input.activityCode !== undefined) data.activityCode = input.activityCode
    if (input.isMain !== undefined) data.isMain = input.isMain
    if (input.isActive !== undefined) data.isActive = input.isActive
    if (input.notes !== undefined) data.notes = input.notes
    if (input.isTrainingOrganization !== undefined) data.isTrainingOrganization = input.isTrainingOrganization
    if (input.trainingActivityDeclarationNumber !== undefined) {
      data.trainingActivityDeclarationNumber = input.trainingActivityDeclarationNumber
    }
    if (input.trainingActivityDeclarationDate !== undefined) {
      data.trainingActivityDeclarationDate = input.trainingActivityDeclarationDate
        ? isoDateToUtc(input.trainingActivityDeclarationDate)
        : null
    }

    if (input.isMain === true) {
      await tx.establishment.updateMany({
        where: { companyId, isMain: true, id: { not: current.id } },
        data: { isMain: false },
      })
    }

    const establishment = await tx.establishment.update({
      where: { id: current.id },
      data,
      include: ESTABLISHMENT_INCLUDE,
    })

    if (establishment.isMain && input.addressId !== undefined) {
      await syncHeadquartersAddress(tx, companyId, establishment.addressId)
    } else if (input.isMain === true && establishment.addressId) {
      await syncHeadquartersAddress(tx, companyId, establishment.addressId)
    }
    // The establishment's previous address and the previous headquarters
    // address go when nothing refers to them any more.
    if (input.addressId !== undefined || input.isMain === true) {
      await deleteAddressesIfUnused(tx, companyId, [current.addressId, previousHeadquarters])
    }
    return present(establishment)
  })
}

/**
 * Deactivates an establishment of the company (soft delete: tax regimes may
 * reference it). A main establishment hands the role to another active one.
 */
export async function deactivateEstablishment(companyId: string, establishmentId: string) {
  return prisma.$transaction(async (tx) => {
    const establishment = await tx.establishment.findFirst({
      where: { id: establishmentId, companyId },
      select: { id: true, isMain: true },
    })
    if (!establishment) throw new NotFoundError(ESTABLISHMENT_NOT_FOUND_MESSAGE)

    if (establishment.isMain) {
      const next = await tx.establishment.findFirst({
        where: { companyId, id: { not: establishment.id }, isActive: true },
        select: { id: true },
      })
      if (next) await tx.establishment.update({ where: { id: next.id }, data: { isMain: true } })
    }

    return tx.establishment.update({ where: { id: establishment.id }, data: { isActive: false } })
  })
}
