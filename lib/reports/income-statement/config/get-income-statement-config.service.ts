/**
 * Gets income statement configuration for a company
 */

import { prisma } from '@/lib/prisma'
import { buildConfigTree } from '../../config/shared/config-tree'
import type { IncomeStatementConfig, IncomeStatementLineConfig } from '../types'

/**
 * Gets income statement configuration for a company
 * Auto-creates default configuration if none exists
 * 
 * @param companyId - Company ID
 * @param reportVariant - 'complete' | 'simplified'
 * @returns Income statement configuration
 */
export async function getIncomeStatementConfig(
  companyId: string,
  reportVariant: 'complete' | 'simplified' = 'complete'
): Promise<IncomeStatementConfig> {
  // Get existing configuration or create default
  const configs = await getIncomeStatementLineConfigs(companyId, reportVariant, false)
  
  // If no configuration exists, create default
  if (configs.length === 0) {
    const { getOrCreateDefaultIncomeStatementConfig } = await import('./create-default-pcg-config.service')
    return getOrCreateDefaultIncomeStatementConfig(companyId, reportVariant)
  }
  
  return {
    companyId,
    reportVariant,
    lines: configs,
  }
}

/**
 * Gets all income statement line configurations for a company
 * 
 * @param companyId - Company ID
 * @param reportVariant - 'complete' | 'simplified'
 * @param includeInactive - Whether to include inactive configurations
 * @returns Array of line configurations
 */
export async function getIncomeStatementLineConfigs(
  companyId: string,
  reportVariant: 'complete' | 'simplified' = 'complete',
  includeInactive: boolean = false
): Promise<IncomeStatementLineConfig[]> {
  // Load all configs flat (no include, as we'll build the tree manually)
  const allConfigs = await prisma.incomeStatementLineConfig.findMany({
    where: {
      companyId,
      reportVariant,
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: {
      order: 'asc',
    },
  })
  
  return buildConfigTree(allConfigs) as IncomeStatementLineConfig[]
}
