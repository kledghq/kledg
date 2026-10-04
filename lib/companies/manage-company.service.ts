/**
 * A company's profile: list, read and update. Used by /api/companies and
 * /api/companies/[id]. Deletion and archiving: archive-company.service.ts.
 *
 * The share capital is derived, never typed: number of shares x nominal value
 * of a share (Code de commerce art. L. 223-2 and L. 224-2: the capital is
 * divided into shares of equal nominal value), computed in cents. Addresses
 * are managed through establishments (lib/companies/establishments.ts), which
 * keep the headquarters address in sync.
 */

import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { centsToDecimal, toCents } from '@/lib/utils/money'
import { isoDateToUtc } from '@/lib/utils/date'
import { COMPANY_NOT_FOUND_MESSAGE, isGlobalAdmin } from '@/lib/rbac/authorize'
import { optionalCalendarDay, optionalText } from '@/lib/api/zod-fields'
import { LEGAL_TYPES } from './legal-forms'
import { parseLogoInput } from './logo'
import { assertCompanySlugAvailable } from './slug'

/** A whole number or a decimal string, as forms send them; '' and null clear the value. */
const numberInput = z.union([z.number(), z.string(), z.null()]).optional()

/**
 * Body of PATCH /api/companies/[id]: every field optional (undefined keeps
 * the value). Forms send back the whole company, so the schema accepts what
 * they hold ('' for empty fields, extra read-only fields are ignored).
 */
export const UpdateCompanySchema = z.object({
  name: z.string().trim().min(1, 'Indiquez le nom de la société.').max(200).optional(),
  slug: z.string().trim().nullable().optional(),
  siren: z
    .string()
    .transform((value) => value.replace(/\s+/g, ''))
    .pipe(z.string().regex(/^\d{9}$/, 'Le SIREN compte exactement 9 chiffres.'))
    .optional(),
  phone: optionalText(50),
  email: z
    .union([z.literal(''), z.null(), z.email('Email invalide.')], { error: 'Email invalide.' })
    .transform((value) => (value === '' ? null : value))
    .optional(),
  logo: z.string().nullable().optional(),
  foundationDate: optionalCalendarDay('Date de création invalide.'),
  closingDay: z.number().int().min(1).max(31).nullable().optional(),
  closingMonth: z.number().int().min(1).max(12).nullable().optional(),
  vatRegime: z.string().max(50).nullable().optional(),
  isVatExempt: z.boolean().optional(),
  vatExemptReason: optionalText(500),
  corporateTaxRegime: z.string().max(50).nullable().optional(),
  legalType: z
    .union([z.literal(''), z.null(), z.enum(LEGAL_TYPES)], { error: 'Forme juridique inconnue.' })
    .transform((value) => (value === '' ? null : value))
    .optional(),
  totalShares: numberInput,
  shareNominalValue: numberInput,
  sector: optionalText(50),
  isHolding: z.boolean().optional(),
  defaultBankAccountCode: optionalText(20),
  color: z
    .union([z.literal(''), z.null(), z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Couleur invalide (format #RRGGBB).')], { error: 'Couleur invalide (format #RRGGBB).' })
    .transform((value) => (value === '' ? null : value))
    .optional(),
})

export type UpdateCompanyInput = z.infer<typeof UpdateCompanySchema>

const COMPANY_DETAILS_INCLUDE = {
  address: true,
  headquartersAddress: true,
  fiscalYears: { orderBy: { year: 'desc' } },
  shareholders: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.CompanyInclude

/**
 * Companies the user is a member of (every company for instance
 * administrators), by name, with their fiscal years. Archived companies are
 * left out (archive-company.service.ts).
 */
export function listCompaniesForUser(user: { id: string; role: string | null }) {
  return prisma.company.findMany({
    where: isGlobalAdmin(user)
      ? { archivedAt: null }
      : { archivedAt: null, organization: { members: { some: { userId: user.id } } } },
    include: { fiscalYears: { orderBy: { year: 'asc' } } },
    orderBy: { name: 'asc' },
  })
}

/** A company with its addresses, fiscal years (latest first) and shareholders. */
export async function getCompanyById(id: string) {
  const company = await prisma.company.findUnique({ where: { id }, include: COMPANY_DETAILS_INCLUDE })
  if (!company) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)
  return company
}

/** The SIREN identifies one company of the instance. */
async function assertSirenAvailable(siren: string, companyId: string): Promise<void> {
  const existing = await prisma.company.findUnique({ where: { siren }, select: { id: true } })
  if (existing && existing.id !== companyId) {
    throw new ConflictError('Une autre société utilise déjà ce SIREN.')
  }
}

/**
 * Share capital in euros (decimal string): shares x nominal value, exact
 * (BigInt cents, no 2^53 limit). Undefined unless both are given.
 */
export function calculateShareCapital(
  totalShares: number | string | null | undefined,
  shareNominalValue: number | string | null | undefined,
): string | undefined {
  if (!totalShares || !shareNominalValue) return undefined
  const shares = Number.parseInt(String(totalShares), 10)
  const nominalCents = nominalValueCents(shareNominalValue)
  if (!Number.isSafeInteger(shares)) return undefined
  return centsToDecimal(BigInt(shares) * BigInt(nominalCents))
}

/** Nominal value of a share in cents (a number or a decimal string, "12,50" accepted). */
function nominalValueCents(value: number | string): number {
  const cents = toCents(typeof value === 'string' ? value.trim().replace(',', '.') : value)
  if (cents === null) throw new ValidationError("La valeur nominale d'une part est invalide.")
  return cents
}

function sharesCount(value: number | string): number {
  const shares = Number.parseInt(String(value), 10)
  if (!Number.isSafeInteger(shares) || shares < 0) throw new ValidationError('Le nombre de parts est invalide.')
  return shares
}

/**
 * Updates a company's profile. The slug is checked only when it changes; an
 * unchanged logo (forms always send it back) is not validated again; the
 * share capital is recomputed when both the shares and their nominal value
 * are given.
 */
export async function updateCompany(id: string, input: UpdateCompanyInput) {
  const current = await prisma.company.findUnique({ where: { id }, select: { slug: true, logo: true } })
  if (!current) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)

  const data: Prisma.CompanyUpdateInput = {}
  if (input.slug !== undefined && input.slug !== null && input.slug !== current.slug) {
    await assertCompanySlugAvailable(input.slug, id)
    data.slug = input.slug
  }
  if (input.siren !== undefined) {
    await assertSirenAvailable(input.siren, id)
    data.siren = input.siren
  }
  if (input.logo !== undefined && input.logo !== current.logo) data.logo = parseLogoInput(input.logo)

  if (input.name !== undefined) data.name = input.name
  if (input.phone !== undefined) data.phone = input.phone
  if (input.email !== undefined) data.email = input.email
  if (input.foundationDate !== undefined) data.foundationDate = input.foundationDate ? isoDateToUtc(input.foundationDate) : null
  if (input.closingDay !== undefined) data.closingDay = input.closingDay
  if (input.closingMonth !== undefined) data.closingMonth = input.closingMonth
  if (input.vatRegime !== undefined) data.vatRegime = input.vatRegime
  if (input.isVatExempt !== undefined) data.isVatExempt = input.isVatExempt
  if (input.vatExemptReason !== undefined) data.vatExemptReason = input.vatExemptReason
  if (input.corporateTaxRegime !== undefined) data.corporateTaxRegime = input.corporateTaxRegime
  if (input.legalType !== undefined) data.legalType = input.legalType
  if (input.totalShares !== undefined) data.totalShares = input.totalShares ? sharesCount(input.totalShares) : null
  if (input.shareNominalValue !== undefined) {
    data.shareNominalValue = input.shareNominalValue ? centsToDecimal(nominalValueCents(input.shareNominalValue)) : null
  }
  const shareCapital = calculateShareCapital(input.totalShares, input.shareNominalValue)
  if (shareCapital !== undefined) data.shareCapital = shareCapital
  if (input.sector !== undefined) data.sector = input.sector
  if (input.isHolding !== undefined) data.isHolding = input.isHolding
  if (input.defaultBankAccountCode !== undefined) data.defaultBankAccountCode = input.defaultBankAccountCode
  if (input.color !== undefined) data.color = input.color

  return prisma.company.update({
    where: { id },
    data,
    include: { address: true, headquartersAddress: true },
  })
}
