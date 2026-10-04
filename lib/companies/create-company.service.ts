/**
 * Creates a company ready to keep its books: identity, head office
 * establishment, capital and shareholders, then the Better Auth organization
 * (members), the default journals, the first fiscal year chosen in the
 * wizard and its chart of accounts (PCG).
 *
 * The company, its establishment and its shareholders are written in one
 * transaction: a failure leaves nothing behind. The organization, journals,
 * fiscal year and chart of accounts follow with the existing idempotent
 * services; the chart of accounts can be seeded again from the plan de
 * comptes page if it fails, so that failure is logged, not fatal (as before).
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { seedPCG } from '@/prisma/seeds/pcg'
import { ConflictError } from '@/lib/accounting/errors'
import { createCompanyAddress } from '@/lib/addresses/manage-addresses.service'
import { ensureDefaultJournals } from '@/lib/accounting/default-journals'
import { ensureCompanyOrganization } from '@/lib/rbac/ensure-company-organization.service'
import { isoDateToUtc } from '@/lib/utils/date'
import { logger } from '@/lib/logger'
import { centsToDecimal } from '@/lib/utils/money'
import { generateCompanySlug } from './slug'
import { companyIdentifierTaken } from './identifiers'
import { sharePercentage, shareCapitalCents, type CreateCompanyData } from './company-wizard'

export interface CreatedCompany {
  id: string
  slug: string
  name: string
  fiscalYearId: string
}

export async function createCompany(input: CreateCompanyData): Promise<CreatedCompany> {
  if (await companyIdentifierTaken('siren', input.siren)) {
    throw new ConflictError(`Une société avec le SIREN ${input.siren} existe déjà sur cette instance.`)
  }

  const slug = await generateCompanySlug(input.name)
  const { startDate, endDate } = input.firstFiscalYear
  const [closingYear, closingMonth, closingDay] = endDate.split('-').map(Number)
  const capitalCents = shareCapitalCents(input.totalShares, input.shareNominalValueCents)
  const office = input.headOffice
  const hasAddress = Boolean(office?.street && office.postalCode && office.city)

  let company: { id: string; slug: string; name: string }
  try {
    company = await prisma.$transaction(async (tx) => {
      const created = await tx.company.create({
        data: {
          name: input.name,
          slug,
          siren: input.siren,
          legalType: input.legalType ?? null,
          activityCode: input.activityCode ?? null,
          email: input.email || null,
          phone: input.phone ?? null,
          // A first exercice starts on the creation date: remember it when it was not typed.
          foundationDate: input.foundationDate
            ? isoDateToUtc(input.foundationDate)
            : input.firstFiscalYear.isFirst
              ? isoDateToUtc(startDate)
              : null,
          closingDay,
          closingMonth,
          vatRegime: input.vatRegime,
          isVatExempt: false,
          corporateTaxRegime: input.corporateTaxRegime,
          totalShares: input.totalShares ?? null,
          shareNominalValue: input.shareNominalValueCents ? centsToDecimal(input.shareNominalValueCents) : null,
          shareCapital: capitalCents !== null ? centsToDecimal(capitalCents) : null,
        },
        select: { id: true, slug: true, name: true },
      })

      if (office?.siret || hasAddress) {
        // Owned by the new company (lib/addresses/manage-addresses.service.ts).
        const address = hasAddress
          ? await createCompanyAddress(
              created.id,
              { street: office!.street!, street2: office!.street2 ?? null, postalCode: office!.postalCode!, city: office!.city! },
              tx,
            )
          : null
        if (office?.siret) {
          await tx.establishment.create({
            data: {
              companyId: created.id,
              siret: office.siret,
              siren: input.siren,
              name: 'Siège social',
              addressId: address?.id ?? null,
              activityCode: input.activityCode ?? null,
              isMain: true,
            },
          })
        } else if (address) {
          await tx.company.update({ where: { id: created.id }, data: { headquartersAddressId: address.id } })
        }
      }

      if (input.totalShares) {
        for (const holder of input.shareholders) {
          const personId =
            holder.type === 'PHYSICAL'
              ? (
                  await tx.person.create({
                    data: { firstName: holder.firstName ?? '', name: holder.name, companyId: created.id },
                    select: { id: true },
                  })
                ).id
              : null
          await tx.shareholder.create({
            data: {
              companyId: created.id,
              type: holder.type,
              name: holder.type === 'LEGAL' ? holder.name : null,
              personId,
              numberOfShares: holder.numberOfShares,
              sharePercentage: sharePercentage(holder.numberOfShares, input.totalShares),
              capitalAmount: input.shareNominalValueCents
                ? centsToDecimal(holder.numberOfShares * input.shareNominalValueCents)
                : null,
            },
          })
        }
      }
      return created
    })
  } catch (error) {
    // Two submissions at once, or an establishment SIRET already used by another company.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictError(
        'Ce SIREN ou ce SIRET est déjà utilisé par une société de cette instance. Vérifiez le numéro saisi.',
      )
    }
    throw error
  }

  await ensureCompanyOrganization(company.id)
  await ensureDefaultJournals(company.id)

  const fiscalYear = await prisma.fiscalYear.create({
    data: {
      companyId: company.id,
      // Fiscal years are numbered by the year they close in (lib/accounting/fiscal-year-utils.ts).
      year: closingYear,
      closingDay,
      closingMonth,
      startDate: isoDateToUtc(startDate),
      endDate: isoDateToUtc(endDate),
    },
    select: { id: true },
  })

  try {
    await seedPCG(company.id, fiscalYear.id, input.includeOptionalAccounts === true)
  } catch (error) {
    logger.error('Chart of accounts seeding failed for a new company', { error, companyId: company.id })
  }

  return { ...company, fiscalYearId: fiscalYear.id }
}
