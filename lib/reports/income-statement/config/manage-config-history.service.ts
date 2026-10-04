/**
 * Manages income statement configuration history
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import type { IncomeStatementLineConfig } from '../types'

export interface CreateHistorySnapshotData {
  changedBy?: string | null
  changeReason?: string | null
}

export async function createConfigHistorySnapshot(
  configId: string,
  version: number,
  data: CreateHistorySnapshotData
): Promise<void> {
  const config = await prisma.incomeStatementLineConfig.findUnique({
    where: { id: configId },
  })

  if (!config) {
    throw new NotFoundError('Configuration introuvable')
  }

  // Check if history already exists for this version
  const existing = await prisma.incomeStatementConfigHistory.findUnique({
    where: {
      configId_version: {
        configId,
        version,
      },
    },
  })

  if (existing) {
    return // History already exists
  }

  // Create history snapshot
  await prisma.incomeStatementConfigHistory.create({
    data: {
      configId,
      version,
      data: config as unknown as Prisma.InputJsonValue,
      changedBy: data.changedBy || null,
      changeReason: data.changeReason || null,
    },
  })
}

export async function getConfigHistory(
  configId: string
): Promise<Array<{
  id: string
  version: number
  createdAt: Date
  changedBy: string | null
  changeReason: string | null
}>> {
  return prisma.incomeStatementConfigHistory.findMany({
    where: { configId },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      version: true,
      createdAt: true,
      changedBy: true,
      changeReason: true,
    },
  })
}

export async function getConfigVersion(
  configId: string,
  version: number
): Promise<IncomeStatementLineConfig | null> {
  const history = await prisma.incomeStatementConfigHistory.findUnique({
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

  return history.data as unknown as IncomeStatementLineConfig
}

export async function restoreConfigVersion(
  configId: string,
  version: number
): Promise<IncomeStatementLineConfig> {
  const versionData = await getConfigVersion(configId, version)

  if (!versionData) {
    throw new NotFoundError('Version introuvable')
  }

  // Update current config with version data
  const updated = await prisma.incomeStatementLineConfig.update({
    where: { id: configId },
    data: {
      accountCodes: versionData.accountCodes,
      excludedAccountCodes: versionData.excludedAccountCodes,
      filterType: versionData.filterType,
      filterValue: versionData.filterValue,
      balanceType: versionData.balanceType,
      lineLabel: versionData.lineLabel,
      formCode: versionData.formCode,
      notes: versionData.notes,
      order: versionData.order,
    },
  })

  return updated as IncomeStatementLineConfig
}
