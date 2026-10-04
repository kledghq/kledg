/**
 * Gets balance sheet configuration for a company
 */

import { prisma } from '@/lib/prisma'
import { buildConfigTree } from '../../config/shared/config-tree'
import type { BalanceSheetConfig, BalanceSheetLineConfig } from '../types'

/**
 * Gets balance sheet configuration for a company
 * Returns empty configuration if none exists (does not auto-create)
 * 
 * @param companyId - Company ID
 * @param reportVariant - 'complete' | 'simplified'
 * @returns Balance sheet configuration
 */
export async function getBalanceSheetConfig(
  companyId: string,
  reportVariant: 'complete' | 'simplified' = 'complete'
): Promise<BalanceSheetConfig> {
  // Get existing configuration or return empty
  const configs = await getBalanceSheetLineConfigs(companyId, reportVariant, false)
  
  return {
    companyId,
    reportVariant,
    lines: configs,
  }
}

/**
 * Gets all balance sheet line configurations for a company
 * 
 * @param companyId - Company ID
 * @param reportVariant - 'complete' | 'simplified'
 * @param includeInactive - Whether to include inactive configurations
 * @returns Array of line configurations
 */
export async function getBalanceSheetLineConfigs(
  companyId: string,
  reportVariant: 'complete' | 'simplified' = 'complete',
  includeInactive: boolean = false
): Promise<BalanceSheetLineConfig[]> {
  // Load all configs flat (no include, as we'll build the tree manually)
  const allConfigs = await prisma.balanceSheetLineConfig.findMany({
    where: {
      companyId,
      reportVariant,
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: {
      order: 'asc',
    },
  })
  
  return buildConfigTree(allConfigs) as BalanceSheetLineConfig[]
}
