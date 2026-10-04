/**
 * Creates default PCG 2026 compliant balance sheet configurations
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { COMPLETE_BALANCE_SHEET_CONFIG_2026, type DefaultBalanceSheetConfigEntry } from './default-pcg-config-complete-2026'
import { SIMPLIFIED_BALANCE_SHEET_CONFIG_2026 } from './default-pcg-config-simplified-2026'
import type { BalanceSheetConfig, BalanceSheetLineConfig } from '../types'

/**
 * Recursively creates balance sheet line configurations from nested structure
 */
async function createConfigRecursive(
  companyId: string,
  config: DefaultBalanceSheetConfigEntry,
  parentId: string | null,
  parentSection: 'actif' | 'passif' | null = null,
  client: Pick<Prisma.TransactionClient, 'balanceSheetLineConfig'> = prisma
): Promise<BalanceSheetLineConfig> {
  // Determine lineType from config or infer from structure
  let lineType: 'group' | 'sum' | 'line'
  if (config.lineType) {
    lineType = config.lineType
  } else if (config.balanceType === 'auto') {
    lineType = 'sum'
  } else if ((config.accountCodes?.length || 0) === 0) {
    lineType = 'group'
  } else {
    lineType = 'line'
  }
  
  // Determine section: use explicit section from config, or inherit from parent
  const section = config.section || parentSection || null
  
  // Determine displayType
  const hasAmortissementCodes = (config.amortissementAccountCodes?.length || 0) > 0
  const hasExcludedAmortissementCodes = (config.excludedAccountCodes || []).some(code => 
    code.startsWith('28') || code.startsWith('29') || code.startsWith('39')
  )
  
  // An explicit displayType wins (operator precedence used to turn every
  // explicit value, 'net' included, into 'brut_amort_net').
  const displayType =
    config.displayType ??
    (hasAmortissementCodes || hasExcludedAmortissementCodes ? 'brut_amort_net' : 'net')

  // Create the configuration
  const created = await client.balanceSheetLineConfig.create({
    data: {
      companyId,
      reportVariant: config.reportVariant,
      parentId,
      section,
      lineLabel: config.lineLabel,
      lineType,
      formCode: config.formCode || null,
      amortissementFormCode: config.amortissementFormCode || null,
      accountCodes: config.accountCodes || [],
      excludedAccountCodes: config.excludedAccountCodes || [],
      amortissementAccountCodes: config.amortissementAccountCodes || [],
      filterType: config.filterType || null,
      filterValue: null,
      balanceType: config.balanceType || 'debit',
      displayType,
      order: config.order,
      notes: config.notes || null,
      version: 1,
      templateId: null,
      isActive: true,
    },
  })

  // Recursively create children, passing down the section
  if (config.children && config.children.length > 0) {
    for (const childConfig of config.children) {
      await createConfigRecursive(companyId, childConfig, created.id, section, client)
    }
  }

  return created as BalanceSheetLineConfig
}

/**
 * Creates default balance sheet configuration for a company
 * 
 * @param companyId - Company ID
 * @param reportVariant - 'complete' | 'simplified'
 * @returns Created configuration
 */
export async function createDefaultBalanceSheetConfig(
  companyId: string,
  reportVariant: 'complete' | 'simplified' = 'complete',
  /** Pass a transaction client to create the layout inside a transaction. */
  client: Pick<Prisma.TransactionClient, 'balanceSheetLineConfig'> = prisma
): Promise<BalanceSheetConfig> {
  // Get the appropriate default config
  // Use the new 2026 configs with nested structure
  const defaultConfigs = reportVariant === 'simplified'
    ? SIMPLIFIED_BALANCE_SHEET_CONFIG_2026
    : COMPLETE_BALANCE_SHEET_CONFIG_2026

  // The default layouts are nested (children arrays): created top down.
  const rootConfigs: BalanceSheetLineConfig[] = []
  for (const config of defaultConfigs) {
    rootConfigs.push(await createConfigRecursive(companyId, config, null, config.section ?? null, client))
  }

  return {
    companyId,
    reportVariant,
    lines: rootConfigs,
  }
}

/**
 * Gets or creates default balance sheet configuration
 * 
 * @param companyId - Company ID
 * @param reportVariant - 'complete' | 'simplified'
 * @returns Configuration (existing or newly created)
 */
export async function getOrCreateDefaultBalanceSheetConfig(
  companyId: string,
  reportVariant: 'complete' | 'simplified' = 'complete'
): Promise<BalanceSheetConfig> {
  // Check if configuration already exists
  // Get all active configurations (not just version 1, as versions can be updated)
  // We need to get the latest active version for each config
  const allActiveConfigs = await prisma.balanceSheetLineConfig.findMany({
    where: {
      companyId,
      reportVariant,
      isActive: true,
    },
    include: {
      children: true,
    },
    orderBy: [
      { version: 'desc' }, // Get latest version for each config
      { order: 'asc' },
    ],
  })

  // Group by id and keep only the latest version for each
  const configsById = new Map<string, BalanceSheetLineConfig>()
  for (const config of allActiveConfigs) {
    const existing = configsById.get(config.id)
    if (!existing || config.version > existing.version) {
      configsById.set(config.id, config as BalanceSheetLineConfig)
    }
  }

  // Filter to get only root configs (parentId is null) and sort by order
  const existingConfigs = Array.from(configsById.values())
    .filter(config => !config.parentId)
    .sort((a, b) => a.order - b.order)

  // If configuration exists, return it
  if (existingConfigs.length > 0) {
    return {
      companyId,
      reportVariant,
      lines: existingConfigs,
    }
  }

  // Otherwise, create default configuration
  return createDefaultBalanceSheetConfig(companyId, reportVariant)
}
