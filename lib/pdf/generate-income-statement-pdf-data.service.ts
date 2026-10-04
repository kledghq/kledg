/**
 * Generates data for income statement PDF export
 */

import { safeLogoSrc } from '@/lib/companies/logo'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { generateIncomeStatement } from '@/lib/reports/income-statement/generate-income-statement.service'
import { formatAddress } from '@/lib/utils/address'
import type { IncomeStatementData } from '@/lib/reports/income-statement/types'

export interface IncomeStatementPDFData {
  company: {
    id: string
    name: string
    siren: string
    address?: string | null
    logo?: string | null
  }
  fiscalYear: {
    id: string
    year: number
    startDate: Date
    endDate: Date
  }
  incomeStatement: IncomeStatementData
}

export async function generateIncomeStatementPDFData(
  companyId: string,
  fiscalYearId: string,
  reportVariant: 'complete' | 'simplified' = 'complete'
): Promise<IncomeStatementPDFData> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: {
      headquartersAddress: true,
    },
  })

  if (!company) {
    throw new NotFoundError('Société introuvable')
  }

  const fiscalYear = await prisma.fiscalYear.findUnique({
    where: { id: fiscalYearId },
  })

  if (!fiscalYear) {
    throw new NotFoundError('Exercice fiscal introuvable')
  }

  const incomeStatement = await generateIncomeStatement(
    companyId,
    fiscalYearId,
    reportVariant
  )

  const address = company.headquartersAddress
    ? formatAddress({
        street: company.headquartersAddress.street,
        street2: company.headquartersAddress.street2 || undefined,
        postalCode: company.headquartersAddress.postalCode,
        city: company.headquartersAddress.city,
        country: company.headquartersAddress.country,
      })
    : null

  return {
    company: {
      id: company.id,
      name: company.name,
      siren: company.siren,
      address,
      // Re-checked at render time: react-pdf fetches whatever source it is given
      logo: safeLogoSrc(company.logo),
    },
    fiscalYear: {
      id: fiscalYear.id,
      year: fiscalYear.year,
      startDate: fiscalYear.startDate,
      endDate: fiscalYear.endDate,
    },
    incomeStatement,
  }
}
