/**
 * Natural persons of a company (shareholders, managers): list and create.
 * Used by /api/companies/[id]/persons, from the shareholders section of the
 * Informations page.
 *
 * Invariants owned here:
 * - a company sees the persons it owns (person.companyId) and the persons
 *   already among its shareholders, never another company's;
 * - a new person belongs to the company, and its address is an address of
 *   the company (lib/addresses/manage-addresses.service.ts).
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { CreateAddressSchema, createCompanyAddress } from '@/lib/addresses/manage-addresses.service'
import { logoError } from './logo'

/** A photo is a data URL kept in the row (like company logos): bounded well under the 1 MB body cap. */
const MAX_PHOTO_LENGTH = 700_000

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max} caractères au maximum`)
    .optional()
    .transform((value) => (value ? value : null))

/** Body of POST /api/companies/[id]/persons. */
export const CreatePersonSchema = z.object({
  firstName: z.string({ error: 'Le prénom est requis' }).trim().min(1, 'Le prénom est requis').max(100),
  name: z.string({ error: 'Le nom est requis' }).trim().min(1, 'Le nom est requis').max(100),
  email: z
    .union([z.literal(''), z.email('Adresse email invalide').max(254)])
    .optional()
    .transform((value) => (value ? value.toLowerCase() : null)),
  phone: optionalText(40),
  photo: z
    .string()
    .max(MAX_PHOTO_LENGTH, 'La photo est trop lourde')
    // Same check as a company logo (lib/companies/logo.ts), inline images only: never an address to fetch.
    .refine((value) => value === '' || (value.startsWith('data:') && logoError(value) === null), 'Format de photo non pris en charge (PNG, JPEG, GIF ou WebP).')
    .optional()
    .transform((value) => (value ? value : null)),
  address: CreateAddressSchema.nullable().optional(),
})
export type CreatePersonInput = z.infer<typeof CreatePersonSchema>

const PERSON_SELECT = { id: true, firstName: true, name: true, email: true, phone: true } as const

/** Persons the company may pick as a shareholder, by name. */
export function listCompanyPersons(companyId: string) {
  return prisma.person.findMany({
    where: { OR: [{ companyId }, { shareholders: { some: { companyId } } }] },
    select: PERSON_SELECT,
    orderBy: [{ name: 'asc' }, { firstName: 'asc' }],
  })
}

/** Creates a person of the company, with its address (an address of the company). */
export async function createCompanyPerson(companyId: string, input: CreatePersonInput) {
  return prisma.$transaction(async (tx) => {
    const address = input.address ? await createCompanyAddress(companyId, input.address, tx) : null
    return tx.person.create({
      data: {
        companyId,
        firstName: input.firstName,
        name: input.name,
        email: input.email,
        phone: input.phone,
        photo: input.photo,
        addressId: address?.id ?? null,
      },
      select: PERSON_SELECT,
    })
  })
}
