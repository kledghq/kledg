/**
 * Creates a new balance sheet line configuration
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { validateAccountCodes } from '../../config/shared/validate-account-codes.service'
import type { BalanceSheetLineConfig } from '../types'

export interface CreateBalanceSheetLineConfigInput {
  companyId: string
  reportVariant: 'complete' | 'simplified'
  parentId?: string | null // Parent line ID for nested structure (null for root lines)
  section?: 'actif' | 'passif' | null // Explicit section for easy sorting
  lineLabel: string
  lineType?: 'group' | 'sum' | 'line' // 'group' (organisation), 'sum' (somme des enfants), 'line' (avec comptes)
  formCode?: string | null
  amortissementFormCode?: string | null // Form code for Amortissements column
  accountCodes: string[]
  excludedAccountCodes?: string[]
  amortissementAccountCodes?: string[] // Comptes pour la colonne Amortissement
  filterType?: string | null
  filterValue?: string | null
  balanceType: 'debit' | 'credit' | 'auto'
  displayType?: 'net' | 'brut_amort_net' // Type d'affichage : net seul ou brut/amortissement/net
  hideLabel?: boolean // Hide the label for this line (useful for groups)
  order: number
  notes?: string | null
  templateId?: string | null
}

/**
 * Creates a new balance sheet line configuration
 * 
 * @param input - Configuration data
 * @returns Created configuration
 */
export async function createBalanceSheetLineConfig(
  input: CreateBalanceSheetLineConfigInput
): Promise<BalanceSheetLineConfig> {
  // Validate account codes exist
  // Pass filterType to allow prefix validation for 'starts_with' filter
  await validateAccountCodes(input.companyId, input.accountCodes, input.filterType)
  
  if (input.excludedAccountCodes && input.excludedAccountCodes.length > 0) {
    // For excluded codes, use the same filterType as accountCodes
    // If filterType is 'starts_with', excluded codes might also be prefixes
    await validateAccountCodes(input.companyId, input.excludedAccountCodes, input.filterType)
  }

  // Validate parent exists if parentId is provided
  if (input.parentId) {
    const parent = await prisma.balanceSheetLineConfig.findUnique({
      where: {
        id: input.parentId,
      },
    })

    // A parent of another company is not confirmed: 404 like a missing one.
    if (!parent || parent.companyId !== input.companyId) {
      throw new NotFoundError('Ligne parente introuvable')
    }

    if (parent.reportVariant !== input.reportVariant) {
      throw new ValidationError('La ligne parente doit appartenir à la même variante du bilan (complet ou simplifié)')
    }
  }

  // Determine lineType: default to 'line' if not specified
  // If no account codes and no lineType specified, default to 'sum' (backward compatibility)
  const lineType = input.lineType || (input.accountCodes.length === 0 ? 'sum' : 'line')

  // Determine section: use explicit section, or inherit from parent if not provided
  let section: 'actif' | 'passif' | null = input.section || null
  if (!section && input.parentId) {
    const parent = await prisma.balanceSheetLineConfig.findUnique({
      where: { id: input.parentId },
      select: { section: true },
    })
    section = parent?.section === 'actif' || parent?.section === 'passif' ? parent.section : null
  }

  // Create the configuration
  const config = await prisma.balanceSheetLineConfig.create({
    data: {
      companyId: input.companyId,
      reportVariant: input.reportVariant,
      parentId: input.parentId || null,
      section,
      lineLabel: input.lineLabel,
      lineType,
      formCode: input.formCode || null,
      amortissementFormCode: input.amortissementFormCode || null,
      accountCodes: input.accountCodes,
      excludedAccountCodes: input.excludedAccountCodes || [],
      amortissementAccountCodes: input.amortissementAccountCodes || [],
      filterType: input.filterType || null,
      filterValue: input.filterValue || null,
      balanceType: input.balanceType,
      displayType: input.displayType || 'net',
      hideLabel: input.hideLabel || false,
      order: input.order,
      notes: input.notes || null,
      version: 1,
      templateId: input.templateId || null,
      isActive: true,
    },
  })

  return config as BalanceSheetLineConfig
}
