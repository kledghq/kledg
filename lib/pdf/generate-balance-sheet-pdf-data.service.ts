/**
 * Generates data for balance sheet PDF export
 */

import { safeLogoSrc } from '@/lib/companies/logo'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { generateBalanceSheet } from '@/lib/reports/balance-sheet/generate-balance-sheet.service'
import { formatAddress } from '@/lib/utils/address'
import type { BalanceSheetData } from '@/lib/reports/balance-sheet/types'

export interface BalanceSheetPDFData {
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
  balanceSheet: BalanceSheetData
}

/**
 * Generates data for balance sheet PDF
 * 
 * @param companyId - Company ID
 * @param fiscalYearId - Fiscal year ID
 * @param reportVariant - 'complete' | 'simplified'
 * @returns PDF data
 */
export async function generateBalanceSheetPDFData(
  companyId: string,
  fiscalYearId: string,
  reportVariant: 'complete' | 'simplified' = 'complete'
): Promise<BalanceSheetPDFData> {
  // Get company
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: {
      headquartersAddress: true,
    },
  })

  if (!company) {
    throw new NotFoundError('Société introuvable')
  }

  // Get fiscal year
  const fiscalYear = await prisma.fiscalYear.findUnique({
    where: { id: fiscalYearId },
  })

  if (!fiscalYear) {
    throw new NotFoundError('Exercice fiscal introuvable')
  }

  // Generate balance sheet
  const balanceSheet = await generateBalanceSheet(
    companyId,
    fiscalYearId,
    reportVariant
  )

  // Format company address
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
    balanceSheet,
  }
}
