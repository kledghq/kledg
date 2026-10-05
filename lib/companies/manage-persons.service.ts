/**
 * Natural persons of a company (shareholders, managers, expense claimants):
 * list, create, and the rights of the person (RGPD, règlement (UE) 2016/679).
 * Used by /api/companies/[id]/persons and /api/companies/[id]/persons/[personId],
 * from the shareholders section of the Informations page.
 *
 * Invariants owned here:
 * - a company sees the persons it owns (person.companyId) and the persons
 *   already among its shareholders, never another company's; it changes or
 *   erases only the persons it owns;
 * - a new person belongs to the company, and its address is an address of
 *   the company (lib/addresses/manage-addresses.service.ts);
 * - access and portability (art. 15 and 20): every field held on the person
 *   and every link to it, in one JSON document;
 * - rectification (art. 16): every field the person record holds;
 * - erasure (art. 17) stops where the law obliges the company to keep data
 *   (art. 17, 3, b): the books and their supporting records for 10 years
 *   (Code de commerce art. L123-22), so an expense claimant keeps the name
 *   and auxiliary account its entries carry; a current associate is erased
 *   only once the shareholding is removed (the company keeps the composition
 *   of its capital for its tax return, formulaire 2033-F / 2059-F).
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError } from '@/lib/accounting/errors'
import { CreateAddressSchema, createCompanyAddress, deleteAddressesIfUnused } from '@/lib/addresses/manage-addresses.service'
import { optionalCalendarDay, optionalText as nullableText } from '@/lib/api/zod-fields'
import { dayToDate } from '@/lib/accounting/entry-date'
import { calendarDayOf } from '@/lib/utils/date'
import { logoError } from './logo'
import { ApprovalDetailsSchema } from '@/lib/approval/schemas'
import { namesOfPerson, pseudonymiseApprovalDetails } from '@/lib/approval/pseudonymise'

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

export const PERSON_NOT_FOUND = 'Personne introuvable'

/** What the books keep after an erasure, told to the user. */
export const PERSON_RETENTION_NOTICE =
  "Les écritures comptables et leurs pièces justificatives sont conservées 10 ans (Code de commerce, art. L123-22) : le nom porté par les écritures et les notes de frais n'est pas effacé (RGPD, art. 17, 3, b)."

async function ownedPerson(companyId: string, personId: string) {
  const person = await prisma.person.findFirst({
    where: { id: personId, companyId },
    select: { id: true, addressId: true, firstName: true, name: true, usualName: true },
  })
  if (!person) throw new NotFoundError(PERSON_NOT_FOUND)
  return person
}

/**
 * Every data the company holds on a person, with its links (RGPD art. 15
 * and 20): the person record, its address, its shareholdings in the company
 * and the expense claimants it is. A person the company only sees as a
 * shareholder (owned by no company) is readable too.
 */
export async function exportCompanyPerson(companyId: string, personId: string) {
  const person = await prisma.person.findFirst({
    where: { id: personId, OR: [{ companyId }, { companyId: null, shareholders: { some: { companyId } } }] },
    select: {
      id: true,
      firstName: true,
      name: true,
      usualName: true,
      email: true,
      phone: true,
      photo: true,
      notes: true,
      birthDate: true,
      birthDepartment: true,
      birthCity: true,
      birthCountry: true,
      createdAt: true,
      updatedAt: true,
      address: { select: { street: true, street2: true, postalCode: true, city: true, country: true } },
      shareholders: {
        where: { companyId },
        select: { sharePercentage: true, numberOfShares: true, capitalAmount: true, notes: true, createdAt: true },
      },
      expenseClaimants: {
        where: { companyId },
        select: { kind: true, name: true, accountCode: true, auxiliaryAccountNumber: true, createdAt: true },
      },
    },
  })
  if (!person) throw new NotFoundError(PERSON_NOT_FOUND)
  const { shareholders, expenseClaimants, birthDate, ...record } = person
  return {
    person: { ...record, birthDate: calendarDayOf(birthDate) },
    shareholdings: shareholders.map((s) => ({
      ...s,
      sharePercentage: s.sharePercentage.toString(),
      capitalAmount: s.capitalAmount?.toString() ?? null,
    })),
    expenseClaimants,
    retention: PERSON_RETENTION_NOTICE,
  }
}

/** Body of PATCH /api/companies/[id]/persons/[personId]: the fields to correct (RGPD art. 16). */
export const UpdatePersonSchema = z.object({
  firstName: z.string().trim().min(1, 'Le prénom est requis').max(100).optional(),
  name: z.string().trim().min(1, 'Le nom est requis').max(100).optional(),
  usualName: nullableText(100),
  email: z
    .union([z.literal(''), z.null(), z.email('Adresse email invalide').max(254)])
    .optional()
    .transform((value) => (value === undefined ? undefined : value ? value.toLowerCase() : null)),
  phone: nullableText(40),
  notes: nullableText(2000),
  photo: z
    .union([z.literal(''), z.null(), z.string().max(MAX_PHOTO_LENGTH, 'La photo est trop lourde')])
    .optional()
    .refine((value) => !value || (value.startsWith('data:') && logoError(value) === null), 'Format de photo non pris en charge (PNG, JPEG, GIF ou WebP).')
    .transform((value) => (value === undefined ? undefined : value ? value : null)),
  birthDate: optionalCalendarDay('Date de naissance invalide'),
  birthDepartment: nullableText(3),
  birthCity: nullableText(100),
  birthCountry: nullableText(2),
})
export type UpdatePersonInput = z.infer<typeof UpdatePersonSchema>

/** Corrects the data of a person of the company (RGPD art. 16). */
export async function updateCompanyPerson(companyId: string, personId: string, input: UpdatePersonInput) {
  const person = await ownedPerson(companyId, personId)
  const { birthDate, ...fields } = input
  const data = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
  return prisma.person.update({
    where: { id: person.id },
    data: { ...data, ...(birthDate !== undefined && { birthDate: birthDate ? dayToDate(birthDate) : null }) },
    select: PERSON_SELECT,
  })
}

/**
 * Erases a person of the company (RGPD art. 17). Refused (409) while the
 * person is an associate of a company: remove the shareholding first. The
 * expense claimants it was keep their name and auxiliary account (the
 * entries carry them, art. 17, 3, b); its address goes when nothing else
 * uses it. In the approvals of the accounts (lib/approval/pseudonymise.ts),
 * the name is replaced while the accounts are not approved; the minutes of
 * approved accounts are company-law records kept as they are (C. com.
 * R221-3, R223-24, R225-106, L123-22; RGPD art. 17, 3, b and e).
 */
export async function eraseCompanyPerson(companyId: string, personId: string): Promise<{ erased: true; kept: string[] }> {
  const person = await ownedPerson(companyId, personId)
  return prisma.$transaction(async (tx) => {
    const shareholdings = await tx.shareholder.count({ where: { personId: person.id } })
    if (shareholdings > 0) {
      throw new ConflictError(
        "Cette personne est associée de la société : retirez d'abord sa participation (la composition du capital est déclarée avec la liasse fiscale), puis effacez-la.",
      )
    }
    const claimants = await tx.expenseClaimant.count({ where: { personId: person.id } })
    const kept = claimants > 0 ? [`Nom et compte auxiliaire du bénéficiaire de note de frais, portés par les écritures. ${PERSON_RETENTION_NOTICE}`] : []

    // Approvals of the accounts: drafts pseudonymised, approved minutes kept
    const names = namesOfPerson(person)
    const approvals = await tx.accountsApproval.findMany({
      where: { companyId },
      select: { id: true, approvedOn: true, details: true, fiscalYear: { select: { year: true } } },
    })
    for (const approval of approvals) {
      const parsed = ApprovalDetailsSchema.safeParse(approval.details ?? {})
      if (!parsed.success) continue
      const { details, changed } = pseudonymiseApprovalDetails(parsed.data, names)
      if (!changed) continue
      if (approval.approvedOn) {
        kept.push(
          `Nom porté par le procès-verbal d'approbation des comptes de l'exercice ${approval.fiscalYear.year}, approuvés\u00a0: les décisions des associés sont conservées avec les registres de la société (Code de commerce, art. R221-3, R223-24, R225-106\u00a0; RGPD, art. 17, 3, b et e).`,
        )
      } else {
        await tx.accountsApproval.update({ where: { id: approval.id }, data: { details: details as object } })
      }
    }

    await tx.person.delete({ where: { id: person.id } })
    await deleteAddressesIfUnused(tx, companyId, [person.addressId])
    return { erased: true as const, kept }
  })
}
