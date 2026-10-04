/**
 * Creates a new income statement line configuration
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import type { IncomeStatementLineConfig } from '../types'

export interface CreateIncomeStatementLineConfigData {
  companyId: string
  reportVariant: 'complete' | 'simplified'
  parentId?: string | null // Parent line ID for nested structure (null for root lines)
  section?: 'produits' | 'charges' | null // Explicit section for easy sorting
  lineLabel: string
  formCode?: string | null
  accountCodes: string[]
  excludedAccountCodes?: string[]
  filterType?: string | null
  filterValue?: string | null
  balanceType: 'debit' | 'credit' | 'auto'
  hideLabel?: boolean // Hide the label for this line (useful for groups)
  order: number
  notes?: string | null
}

export async function createIncomeStatementLineConfig(
  data: CreateIncomeStatementLineConfigData
): Promise<IncomeStatementLineConfig> {
  // Validate parent exists if parentId is provided
  if (data.parentId) {
    const parent = await prisma.incomeStatementLineConfig.findUnique({
      where: {
        id: data.parentId,
      },
    })

    // A parent of another company is not confirmed: 404 like a missing one.
    if (!parent || parent.companyId !== data.companyId) {
      throw new NotFoundError('Ligne parente introuvable')
    }

    if (parent.reportVariant !== data.reportVariant) {
      throw new ValidationError('La ligne parente doit appartenir à la même variante du compte de résultat (complet ou simplifié)')
    }
  }

  const config = await prisma.incomeStatementLineConfig.create({
    data: {
      companyId: data.companyId,
      reportVariant: data.reportVariant,
      parentId: data.parentId || null,
      section: data.section || null,
      lineLabel: data.lineLabel,
      formCode: data.formCode || null,
      accountCodes: data.accountCodes,
      excludedAccountCodes: data.excludedAccountCodes || [],
      filterType: data.filterType || null,
      filterValue: data.filterValue || null,
      balanceType: data.balanceType,
      hideLabel: data.hideLabel || false,
      order: data.order,
      notes: data.notes || null,
      version: 1,
      templateId: null,
      isActive: true,
    },
  })

  return config as IncomeStatementLineConfig
}
