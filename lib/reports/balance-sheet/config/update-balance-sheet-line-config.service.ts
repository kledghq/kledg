/**
 * Updates an existing balance sheet line configuration
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { validateAccountCodes } from '../../config/shared/validate-account-codes.service'
import { createConfigHistorySnapshot } from './manage-config-history.service'
import type { BalanceSheetLineConfig } from '../types'

export interface UpdateBalanceSheetLineConfigInput {
  section?: 'actif' | 'passif' | null // Explicit section for easy sorting
  parentId?: string | null // Parent line ID for nested structure (null for root lines)
  lineLabel?: string
  lineType?: 'group' | 'sum' | 'line' // 'group' (organisation), 'sum' (somme des enfants), 'line' (avec comptes)
  formCode?: string | null
  amortissementFormCode?: string | null // Form code for Amortissements column
  accountCodes?: string[]
  excludedAccountCodes?: string[]
  amortissementAccountCodes?: string[] // Comptes pour la colonne Amortissement
  filterType?: string | null
  filterValue?: string | null
  balanceType?: 'debit' | 'credit' | 'auto'
  displayType?: 'net' | 'brut_amort_net' // Type d'affichage : net seul ou brut/amortissement/net
  hideLabel?: boolean // Hide the label for this line (useful for groups)
  order?: number
  notes?: string | null
  isActive?: boolean
  reportVariant?: 'complete' | 'simplified' // Optional: for validation
}

/**
 * Updates an existing balance sheet line configuration
 * Creates a new version if significant changes are made
 * 
 * @param configId - Configuration ID
 * @param companyId - Company ID (for validation)
 * @param input - Update data
 * @returns Updated configuration
 */
export async function updateBalanceSheetLineConfig(
  configId: string,
  companyId: string,
  input: UpdateBalanceSheetLineConfigInput
): Promise<BalanceSheetLineConfig> {
  // Get existing configuration (findUnique finds by ID regardless of isActive status)
  const existing = await prisma.balanceSheetLineConfig.findUnique({
    where: { id: configId },
  })

  // A line of another company is not confirmed: 404 like a missing one.
  if (!existing || existing.companyId !== companyId) {
    throw new NotFoundError('Configuration introuvable : elle a peut-être été supprimée. Rechargez la page de configuration.')
  }

  // Validate account codes if provided
  // Pass filterType to allow prefix validation for 'starts_with' filter
  // Use existing.filterType if input.filterType is undefined or null (to preserve the existing filter type)
  if (input.accountCodes) {
    const filterTypeForValidation = (input.filterType !== undefined && input.filterType !== null)
      ? input.filterType
      : existing.filterType
    await validateAccountCodes(companyId, input.accountCodes, filterTypeForValidation)
  }

  if (input.excludedAccountCodes && input.excludedAccountCodes.length > 0) {
    const filterTypeForExcluded = (input.filterType !== undefined && input.filterType !== null)
      ? input.filterType
      : existing.filterType
    // For excluded codes with starts_with, we allow prefixes (non-strict)
    // For exact match, we validate that codes exist (strict)
    await validateAccountCodes(companyId, input.excludedAccountCodes, filterTypeForExcluded)
  }

  // Determine if we need to create a new version
  // Create new version if accountCodes, excludedAccountCodes, filterType, balanceType, or parentId change
  const needsNewVersion = 
    (input.accountCodes && JSON.stringify(input.accountCodes) !== JSON.stringify(existing.accountCodes)) ||
    (input.excludedAccountCodes && JSON.stringify(input.excludedAccountCodes) !== JSON.stringify(existing.excludedAccountCodes)) ||
    (input.amortissementAccountCodes && JSON.stringify(input.amortissementAccountCodes) !== JSON.stringify(existing.amortissementAccountCodes)) ||
    (input.filterType !== undefined && input.filterType !== existing.filterType) ||
    (input.balanceType !== undefined && input.balanceType !== existing.balanceType) ||
    (input.parentId !== undefined && input.parentId !== existing.parentId)

  if (needsNewVersion) {
    // Create history snapshot before updating
    await createConfigHistorySnapshot(
      existing.id,
      undefined,
      'Configuration updated'
    )

    // Find the highest version for this config ID to ensure we create a new unique version
    // Since we're creating a new version, we look for all versions with the same parentId and order
    // to maintain versioning within the same logical line
    const maxVersion = await prisma.balanceSheetLineConfig.findFirst({
      where: {
        companyId: existing.companyId,
        reportVariant: existing.reportVariant,
        parentId: existing.parentId,
        order: existing.order,
      },
      orderBy: { version: 'desc' },
      select: { version: true },
    })

    const newVersion = (maxVersion?.version ?? existing.version) + 1

    // Create new version
    const updated = await prisma.balanceSheetLineConfig.create({
      data: {
        companyId: existing.companyId,
        reportVariant: existing.reportVariant,
        parentId: input.parentId !== undefined ? input.parentId : existing.parentId,
        section: input.section !== undefined ? input.section : existing.section,
        lineLabel: input.lineLabel ?? existing.lineLabel,
        lineType: input.lineType ?? existing.lineType,
        formCode: input.formCode !== undefined ? input.formCode : existing.formCode,
        amortissementFormCode: input.amortissementFormCode !== undefined ? input.amortissementFormCode : existing.amortissementFormCode,
        accountCodes: input.accountCodes ?? existing.accountCodes,
        excludedAccountCodes: input.excludedAccountCodes ?? existing.excludedAccountCodes,
        amortissementAccountCodes: input.amortissementAccountCodes ?? existing.amortissementAccountCodes,
        filterType: input.filterType !== undefined ? input.filterType : existing.filterType,
        filterValue: input.filterValue !== undefined ? input.filterValue : existing.filterValue,
        balanceType: input.balanceType ?? existing.balanceType,
        displayType: input.displayType ?? existing.displayType,
        hideLabel: input.hideLabel !== undefined ? input.hideLabel : existing.hideLabel,
        order: input.order ?? existing.order,
        notes: input.notes !== undefined ? input.notes : existing.notes,
        version: newVersion,
        templateId: existing.templateId,
        isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
      },
    })

    // Deactivate old version
    await prisma.balanceSheetLineConfig.update({
      where: { id: existing.id },
      data: { isActive: false },
    })

    // Repoint children to the new version so the tree stays correct when loading
    await prisma.balanceSheetLineConfig.updateMany({
      where: { parentId: existing.id },
      data: { parentId: updated.id },
    })

    return updated as BalanceSheetLineConfig
  } else {
    // Just update the existing version in place (no new row)
    return prisma.balanceSheetLineConfig.update({
      where: { id: existing.id },
      data: {
        ...(input.section !== undefined && { section: input.section }),
        ...(input.parentId !== undefined && { parentId: input.parentId }),
        ...(input.lineLabel !== undefined && { lineLabel: input.lineLabel }),
        ...(input.lineType !== undefined && { lineType: input.lineType }),
        ...(input.formCode !== undefined && { formCode: input.formCode }),
        ...(input.amortissementFormCode !== undefined && {
          amortissementFormCode: input.amortissementFormCode,
        }),
        ...(input.accountCodes !== undefined && { accountCodes: input.accountCodes }),
        ...(input.excludedAccountCodes !== undefined && {
          excludedAccountCodes: input.excludedAccountCodes,
        }),
        ...(input.amortissementAccountCodes !== undefined && {
          amortissementAccountCodes: input.amortissementAccountCodes,
        }),
        ...(input.filterType !== undefined && { filterType: input.filterType }),
        ...(input.filterValue !== undefined && { filterValue: input.filterValue }),
        ...(input.balanceType !== undefined && { balanceType: input.balanceType }),
        ...(input.displayType !== undefined && { displayType: input.displayType }),
        ...(input.hideLabel !== undefined && { hideLabel: input.hideLabel }),
        ...(input.order !== undefined && { order: input.order }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    }) as Promise<BalanceSheetLineConfig>
  }
}
