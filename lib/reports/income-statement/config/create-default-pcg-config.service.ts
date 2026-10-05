/**
 * Creates default PCG 2026 compliant income statement configurations
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { SIMPLIFIED_INCOME_STATEMENT_CONFIG_2026 } from './default-pcg-config-simplified-2026'
import { COMPLETE_INCOME_STATEMENT_CONFIG_2026, type DefaultIncomeStatementConfigEntry } from './default-pcg-config-complete-2026'
import { buildConfigTree } from '../../config/shared/config-tree'
import type { IncomeStatementConfig, IncomeStatementLineConfig } from '../types'
import { LAYOUT_TRANSACTION_OPTIONS, lockLayout } from '../../statements/layout-lock'
import { withWorksAsGoods, worksSoldAsGoods } from './works-as-goods'

/**
 * Recursively creates income statement line configurations from nested structure
 */
async function createConfigRecursive(
  companyId: string,
  config: DefaultIncomeStatementConfigEntry,
  parentId: string | null,
  parentSection: 'produits' | 'charges' | null = null,
  client: Pick<Prisma.TransactionClient, 'incomeStatementLineConfig'> = prisma
): Promise<IncomeStatementLineConfig> {
  // Income statement lines have no stored type: sums are the lines with balanceType 'auto'.
  // Determine section: use explicit section from config, or inherit from parent
  const section = config.section || parentSection || null
  
  // Create the configuration
  const created = await client.incomeStatementLineConfig.create({
    data: {
      companyId,
      reportVariant: config.reportVariant,
      parentId,
      section,
      lineLabel: config.lineLabel,
      formCode: config.formCode || null,
      accountCodes: config.accountCodes || [],
      excludedAccountCodes: config.excludedAccountCodes || [],
      filterType: config.filterType || null,
      filterValue: null,
      balanceType: config.balanceType || 'credit',
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

  return created as IncomeStatementLineConfig
}

export async function createDefaultIncomeStatementConfig(
  companyId: string,
  reportVariant: 'complete' | 'simplified' = 'complete',
  /** Pass a transaction client to create the layout inside a transaction. */
  client: Pick<Prisma.TransactionClient, 'incomeStatementLineConfig'> = prisma
): Promise<IncomeStatementConfig> {
  // The 2026 default of the variant; the works (704) go with the goods for a
  // construction company (works-as-goods.ts)
  const base = reportVariant === 'complete' ? COMPLETE_INCOME_STATEMENT_CONFIG_2026 : SIMPLIFIED_INCOME_STATEMENT_CONFIG_2026
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { sector: true } })
  const defaultConfigs = worksSoldAsGoods(company?.sector) ? withWorksAsGoods(base) : base

  // The default layouts are nested (children arrays): created top down.
  const rootConfigs: IncomeStatementLineConfig[] = []
  for (const config of defaultConfigs) {
    rootConfigs.push(await createConfigRecursive(companyId, config, null, config.section ?? null, client))
  }

  return {
    companyId,
    reportVariant,
    lines: rootConfigs,
  }
}

export async function getOrCreateDefaultIncomeStatementConfig(
  companyId: string,
  reportVariant: 'complete' | 'simplified' = 'complete'
): Promise<IncomeStatementConfig> {
  // Check if configuration already exists
  // Get all active configurations (not just version 1, as versions can be updated)
  // We need to get the latest active version for each config
  const allActiveConfigs = await prisma.incomeStatementLineConfig.findMany({
    where: {
      companyId,
      reportVariant,
      isActive: true,
    },
    orderBy: [
      { version: 'desc' }, // Get latest version for each config
      { order: 'asc' },
    ],
  })

  // Group by id and keep only the latest version for each
  const configsById = new Map<string, IncomeStatementLineConfig>()
  for (const config of allActiveConfigs) {
    const existing = configsById.get(config.id)
    if (!existing || config.version > existing.version) {
      configsById.set(config.id, config as IncomeStatementLineConfig)
    }
  }

  // If a layout exists (it has root lines), return it as a tree
  const latest = Array.from(configsById.values())
  if (latest.some((config) => !config.parentId)) {
    return { companyId, reportVariant, lines: buildConfigTree(latest) }
  }

  // Otherwise, create the default configuration under the layout lock, unless
  // another report created it while this one waited (two reports computed at
  // once create one layout, not one each), then reload it as a tree
  await prisma.$transaction(async (tx) => {
    await lockLayout(tx, companyId, 'income-statement', reportVariant)
    const rows = await tx.incomeStatementLineConfig.count({ where: { companyId, reportVariant, isActive: true } })
    if (rows === 0) await createDefaultIncomeStatementConfig(companyId, reportVariant, tx)
  }, LAYOUT_TRANSACTION_OPTIONS)
  const allNewConfigs = await prisma.incomeStatementLineConfig.findMany({
    where: { companyId, reportVariant, isActive: true },
    orderBy: { order: 'asc' },
  })

  return {
    companyId,
    reportVariant,
    lines: buildConfigTree(allNewConfigs) as IncomeStatementLineConfig[],
  }
}
