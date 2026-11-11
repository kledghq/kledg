/**
 * Gets income statement configuration for a company
 */

import { prisma } from '@/lib/prisma'
import { buildConfigTree } from '../../config/shared/config-tree'
import { defaultIncomeStatementConfig } from './create-default-pcg-config.service'
import type { IncomeStatementConfig, IncomeStatementLineConfig } from '../types'

/**
 * The income statement layout of a company: the stored one, else the PCG
 * default built in memory (isDefault). A read: it never writes, so reading
 * the layout or a report needs only a read right and works on an archived
 * company. The default is stored by the first change of a line
 * (create-default-pcg-config.service.ts).
 *
 * @param companyId - Company ID
 * @param reportVariant - 'complete' | 'simplified'
 * @returns Income statement configuration
 */
export async function getIncomeStatementConfig(
  companyId: string,
  reportVariant: 'complete' | 'simplified' = 'complete'
): Promise<IncomeStatementConfig> {
  const configs = await getIncomeStatementLineConfigs(companyId, reportVariant, false)
  if (configs.length === 0) return defaultIncomeStatementConfig(companyId, reportVariant)

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
