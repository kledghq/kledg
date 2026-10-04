/**
 * Updates an income statement line configuration
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { createConfigHistorySnapshot } from '../config/manage-config-history.service'
import type { IncomeStatementLineConfig } from '../types'

export interface UpdateIncomeStatementLineConfigData {
  parentId?: string | null
  section?: 'produits' | 'charges' | null
  lineLabel?: string
  formCode?: string | null
  accountCodes?: string[]
  excludedAccountCodes?: string[]
  filterType?: string | null
  filterValue?: string | null
  balanceType?: 'debit' | 'credit' | 'auto'
  hideLabel?: boolean // Hide the label for this line (useful for groups)
  order?: number
  notes?: string | null
}

export async function updateIncomeStatementLineConfig(
  configId: string,
  data: UpdateIncomeStatementLineConfigData
): Promise<IncomeStatementLineConfig> {
  const existing = await prisma.incomeStatementLineConfig.findUnique({
    where: { id: configId },
  })

  if (!existing) {
    throw new NotFoundError('Configuration introuvable')
  }

  // Check if significant changes were made (account codes, balance type, filter type)
  const significantChange =
    (data.accountCodes && JSON.stringify(data.accountCodes) !== JSON.stringify(existing.accountCodes)) ||
    (data.balanceType && data.balanceType !== existing.balanceType) ||
    (data.filterType && data.filterType !== existing.filterType)

  // Create history snapshot if significant change
  if (significantChange) {
    await createConfigHistorySnapshot(configId, existing.version, {
      changedBy: null, // TODO: Get from auth context
      changeReason: 'Configuration updated',
    })

    // Increment version
    const newVersion = existing.version + 1

    // Create new active version
    const updated = await prisma.incomeStatementLineConfig.create({
      data: {
        companyId: existing.companyId,
        reportVariant: existing.reportVariant,
        parentId: data.parentId ?? existing.parentId,
        section: data.section ?? existing.section,
        lineLabel: data.lineLabel ?? existing.lineLabel,
        formCode: data.formCode ?? existing.formCode,
        accountCodes: data.accountCodes ?? existing.accountCodes,
        excludedAccountCodes: data.excludedAccountCodes ?? existing.excludedAccountCodes,
        filterType: data.filterType ?? existing.filterType,
        filterValue: data.filterValue ?? existing.filterValue,
        balanceType: data.balanceType ?? existing.balanceType,
        hideLabel: data.hideLabel !== undefined ? data.hideLabel : existing.hideLabel,
        order: data.order ?? existing.order,
        notes: data.notes ?? existing.notes,
        version: newVersion,
        templateId: existing.templateId,
        isActive: true,
      },
    })

    // Deactivate old version
    await prisma.incomeStatementLineConfig.update({
      where: { id: configId },
      data: { isActive: false },
    })

    // Repoint children to the new version so the tree stays correct when loading
    await prisma.incomeStatementLineConfig.updateMany({
      where: { parentId: existing.id },
      data: { parentId: updated.id },
    })

    return updated as IncomeStatementLineConfig
  } else {
    // Just update the existing version in place (no new row)
    return prisma.incomeStatementLineConfig.update({
      where: { id: existing.id },
      data: {
        ...(data.parentId !== undefined && { parentId: data.parentId }),
        ...(data.section !== undefined && { section: data.section }),
        ...(data.lineLabel !== undefined && { lineLabel: data.lineLabel }),
        ...(data.formCode !== undefined && { formCode: data.formCode }),
        ...(data.accountCodes !== undefined && { accountCodes: data.accountCodes }),
        ...(data.excludedAccountCodes !== undefined && {
          excludedAccountCodes: data.excludedAccountCodes,
        }),
        ...(data.filterType !== undefined && { filterType: data.filterType }),
        ...(data.filterValue !== undefined && { filterValue: data.filterValue }),
        ...(data.balanceType !== undefined && { balanceType: data.balanceType }),
        ...(data.hideLabel !== undefined && { hideLabel: data.hideLabel }),
        ...(data.order !== undefined && { order: data.order }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    }) as Promise<IncomeStatementLineConfig>
  }
}
