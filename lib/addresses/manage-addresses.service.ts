/**
 * Postal addresses of one company: search, read, create, the check that an
 * address may be attached to one of its records, and the clean-up of an
 * address a change left unused. Used by /api/addresses, company creation
 * (lib/companies/create-company.service.ts) and establishments
 * (lib/companies/manage-establishments.service.ts).
 *
 * Invariants owned here:
 * - every address belongs to one company (Address.companyId, required since
 *   migration 20261014090000_address_owner_company); every lookup is scoped
 *   by it, so another company's address is a 404 exactly like an address
 *   that does not exist, even one just created and not attached yet;
 * - a record of a company (its own address and headquarters, an
 *   establishment, a person) only points at an address of that company:
 *   attaching checks Address.companyId, so no address is shared across
 *   companies;
 * - creating an address reuses an identical address of the same company
 *   only, never another company's;
 * - replacing or removing a link deletes the old address in the same
 *   transaction when nothing refers to it any more (deleteAddressesIfUnused).
 */

import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { optionalText } from '@/lib/api/zod-fields'
import type { Address as AddressType } from '@/lib/utils/address'

export const ADDRESS_NOT_FOUND_MESSAGE = 'Adresse introuvable'

/** Shortest search term: shorter terms return nothing rather than every address. */
const MIN_SEARCH_LENGTH = 2
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

/** ?companyId=&search=&limit= of GET /api/addresses. */
export const SearchAddressesQuerySchema = z.object({
  search: z.string().trim().optional(),
  /** Clamped to 1..100 (20 by default). */
  limit: z.coerce
    .number({ error: 'limit doit être un nombre' })
    .int('limit doit être un nombre entier')
    .optional()
    .transform((value) => Math.min(Math.max(value ?? DEFAULT_LIMIT, 1), MAX_LIMIT)),
})
export type SearchAddressesQuery = z.infer<typeof SearchAddressesQuerySchema>

const requiredText = (max: number, message: string) =>
  z.string({ error: message }).trim().min(1, message).max(max, `${max} caractères au maximum`)

/** Body of POST /api/addresses (the company comes from `companyId` in the same body). */
export const CreateAddressSchema = z.object({
  street: requiredText(200, 'La rue est requise'),
  street2: optionalText(200),
  postalCode: requiredText(20, 'Le code postal est requis'),
  city: requiredText(100, 'La ville est requise'),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .length(2, 'Le code pays doit contenir 2 lettres (ISO 3166-1 alpha-2)')
    .optional()
    .transform((value) => value ?? 'FR'),
})
export type CreateAddressInput = z.infer<typeof CreateAddressSchema>

/** Fields of a new address (country FR when absent). */
export interface NewAddressFields {
  street: string
  street2?: string | null
  postalCode: string
  city: string
  country?: string
}

/** Addresses of the company matching the term (postal code, city or street); [] for terms under 2 characters. */
export async function searchCompanyAddresses(companyId: string, query: SearchAddressesQuery) {
  const term = query.search ?? ''
  if (term.length < MIN_SEARCH_LENGTH) return []
  return prisma.address.findMany({
    where: {
      companyId,
      OR: [
        { postalCode: { contains: term, mode: 'insensitive' } },
        { city: { contains: term, mode: 'insensitive' } },
        { street: { contains: term, mode: 'insensitive' } },
      ],
    },
    take: query.limit,
    orderBy: [{ city: 'asc' }, { postalCode: 'asc' }, { street: 'asc' }],
  })
}

/** An address of the company; 404 otherwise (another company's address included). */
export async function getCompanyAddress(companyId: string, addressId: string) {
  const address = await prisma.address.findFirst({ where: { id: addressId, companyId } })
  if (!address) throw new NotFoundError(ADDRESS_NOT_FOUND_MESSAGE)
  return address
}

/**
 * Returns the id of an identical address of the company, or creates one
 * owned by the company. `client` is the caller's transaction when the
 * address is created with the record that uses it (company creation).
 */
export async function createCompanyAddress(
  companyId: string,
  input: NewAddressFields,
  client: Prisma.TransactionClient = prisma,
): Promise<{ id: string }> {
  const fields = {
    street: input.street,
    street2: input.street2 ?? null,
    postalCode: input.postalCode,
    city: input.city,
    country: input.country ?? 'FR',
  }
  const existing = await client.address.findFirst({ where: { ...fields, companyId }, select: { id: true } })
  if (existing) return existing
  return client.address.create({ data: { ...fields, companyId }, select: { id: true } })
}

/**
 * Throws a 404 unless the address belongs to the company. An address of
 * another company is never attachable, even one linked to nothing yet.
 */
export async function assertAddressUsableByCompany(
  client: Prisma.TransactionClient,
  companyId: string,
  addressId: string,
): Promise<void> {
  const address = await client.address.findFirst({ where: { id: addressId, companyId }, select: { id: true } })
  if (!address) throw new NotFoundError(ADDRESS_NOT_FOUND_MESSAGE)
}

/**
 * Deletes the addresses of the company among `addressIds` that nothing
 * refers to any more (no company, headquarters, establishment or person
 * link). Call it in the transaction that replaced or removed the links,
 * after the change. The rows are locked first (FOR UPDATE): an attach
 * committed meanwhile is then visible to the reference check, and an attach
 * still running waits for this transaction and fails on the foreign key
 * instead of losing its address silently.
 */
export async function deleteAddressesIfUnused(
  tx: Prisma.TransactionClient,
  companyId: string,
  addressIds: ReadonlyArray<string | null | undefined>,
): Promise<number> {
  const ids = [...new Set(addressIds.filter((id): id is string => Boolean(id)))]
  if (ids.length === 0) return 0
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "addresses" WHERE "id" IN (${Prisma.join(ids)}) AND "companyId" = ${companyId} FOR UPDATE`,
  )
  const { count } = await tx.address.deleteMany({
    where: {
      id: { in: ids },
      companyId,
      companies: { none: {} },
      companiesHeadquarters: { none: {} },
      establishments: { none: {} },
      persons: { none: {} },
    },
  })
  return count
}

/** A stored address in the shared Address shape (street2 undefined when empty). */
export function prismaAddressToAddressType(
  address: { street: string; street2?: string | null; postalCode: string; city: string; country: string } | null,
): AddressType | null {
  if (!address) return null
  return {
    street: address.street,
    street2: address.street2 || undefined,
    postalCode: address.postalCode,
    city: address.city,
    country: address.country,
  }
}
