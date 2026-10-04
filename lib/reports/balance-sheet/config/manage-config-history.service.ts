/**
 * Manages balance sheet configuration history
 */

import type { BalanceSheetConfigHistory as HistoryRow, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import type { BalanceSheetConfigHistory, BalanceSheetLineConfig } from '../types'

const CONFIG_NOT_FOUND = 'Configuration introuvable'
const VERSION_NOT_FOUND = 'Version introuvable'

/** A history row with its snapshot, which createConfigHistorySnapshot wrote from a configuration row. */
function historyEntry(row: HistoryRow, data: BalanceSheetLineConfig = row.data as unknown as BalanceSheetLineConfig): BalanceSheetConfigHistory {
  return {
    id: row.id,
    configId: row.configId,
    version: row.version,
    data,
    changedBy: row.changedBy,
    changeReason: row.changeReason,
    createdAt: row.createdAt,
  }
}

/** A configuration row as stored JSON (dates as ISO strings). */
function snapshotOf(config: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(config)) as Prisma.InputJsonValue
}

/**
 * Creates a history snapshot for a configuration
 * 
 * @param configId - Configuration ID
 * @param changedBy - User ID who made the change
 * @param changeReason - Reason for the change
 */
export async function createConfigHistorySnapshot(
  configId: string,
  changedBy?: string,
  changeReason?: string
): Promise<BalanceSheetConfigHistory> {
  // Get current configuration
  const config = await prisma.balanceSheetLineConfig.findUnique({
    where: { id: configId },
  })

  if (!config) {
    throw new NotFoundError(CONFIG_NOT_FOUND)
  }

  // Check if history already exists for this version
  const existing = await prisma.balanceSheetConfigHistory.findUnique({
    where: {
      configId_version: {
        configId,
        version: config.version,
      },
    },
  })

  if (existing) {
    // Return existing history entry
    return historyEntry(existing)
  }

  // Create history entry
  const history = await prisma.balanceSheetConfigHistory.create({
    data: {
      configId,
      version: config.version,
      data: snapshotOf(config),
      changedBy: changedBy || null,
      changeReason: changeReason || null,
    },
  })

  return historyEntry(history, config as BalanceSheetLineConfig)
}

/**
 * Gets configuration history
 * 
 * @param configId - Configuration ID
 * @returns History entries
 */
export async function getConfigHistory(
  configId: string
): Promise<BalanceSheetConfigHistory[]> {
  const history = await prisma.balanceSheetConfigHistory.findMany({
    where: { configId },
    orderBy: { version: 'desc' },
  })

  return history.map((h) => historyEntry(h))
}

/**
 * Gets a specific version of configuration
 * 
 * @param configId - Configuration ID
 * @param version - Version number
 * @returns Configuration at that version
 */
export async function getConfigVersion(
  configId: string,
  version: number
): Promise<BalanceSheetConfigHistory | null> {
  const history = await prisma.balanceSheetConfigHistory.findUnique({
    where: {
      configId_version: {
        configId,
        version,
      },
    },
  })

  if (!history) {
    return null
  }

  return historyEntry(history)
}

export interface ConfigDifference {
  field: string
  oldValue: unknown
  newValue: unknown
}

/**
 * Compares two versions of configuration
 * 
 * @param configId - Configuration ID
 * @param version1 - First version
 * @param version2 - Second version
 * @returns Differences between versions
 */
export async function compareConfigVersions(
  configId: string,
  version1: number,
  version2: number
): Promise<{
  version1: BalanceSheetConfigHistory
  version2: BalanceSheetConfigHistory
  differences: ConfigDifference[]
}> {
  const [v1, v2] = await Promise.all([
    getConfigVersion(configId, version1),
    getConfigVersion(configId, version2),
  ])

  if (!v1 || !v2) {
    throw new NotFoundError(VERSION_NOT_FOUND)
  }

  const differences: ConfigDifference[] = []

  const config1 = v1.data
  const config2 = v2.data

  // Compare fields
  const fieldsToCompare: (keyof typeof config1)[] = [
    'accountCodes',
    'excludedAccountCodes',
    'filterType',
    'filterValue',
    'balanceType',
    'lineLabel',
    'notes',
  ]

  for (const field of fieldsToCompare) {
    const oldValue = config1[field]
    const newValue = config2[field]

    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      differences.push({
        field,
        oldValue,
        newValue,
      })
    }
  }

  return {
    version1: v1,
    version2: v2,
    differences,
  }
}

/**
 * Restores configuration to a specific version
 * Creates a new version with the restored data
 * 
 * @param configId - Configuration ID
 * @param version - Version to restore
 * @returns Restored configuration
 */
export async function restoreConfigVersion(
  configId: string,
  version: number
): Promise<BalanceSheetLineConfig> {
  const history = await getConfigVersion(configId, version)
  
  if (!history) {
    throw new NotFoundError(VERSION_NOT_FOUND)
  }

  const currentConfig = await prisma.balanceSheetLineConfig.findUnique({
    where: { id: configId },
  })

  if (!currentConfig) {
    throw new NotFoundError(CONFIG_NOT_FOUND)
  }

  // Create history snapshot of current version
  await createConfigHistorySnapshot(
    configId,
    undefined,
    `Restored to version ${version}`
  )

  // Create new version with restored data
  const restoredData = history.data
  const newVersion = currentConfig.version + 1

  const restored = await prisma.balanceSheetLineConfig.create({
    data: {
      companyId: currentConfig.companyId,
      reportVariant: currentConfig.reportVariant,
      parentId: currentConfig.parentId,
      lineLabel: restoredData.lineLabel,
      formCode: restoredData.formCode,
      accountCodes: restoredData.accountCodes,
      excludedAccountCodes: restoredData.excludedAccountCodes,
      filterType: restoredData.filterType,
      filterValue: restoredData.filterValue,
      balanceType: restoredData.balanceType,
      order: restoredData.order,
      notes: restoredData.notes,
      version: newVersion,
      templateId: currentConfig.templateId,
      isActive: true,
    },
  })

  // Deactivate old version
  await prisma.balanceSheetLineConfig.update({
    where: { id: configId },
    data: { isActive: false },
  })

  return restored as BalanceSheetLineConfig
}
