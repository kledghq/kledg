/**
 * Reads of the fixed asset register (registre des immobilisations): the
 * list, one asset with its accounts, and the totals of the Immobilisations
 * page. Every read is scoped by company; an asset of another company is a
 * 404 like a missing one.
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { fromCents, sumCents, toCents } from '@/lib/utils/money'

export const FIXED_ASSET_NOT_FOUND = 'Immobilisation introuvable'

/** The three accounts of an asset (immobilisation, amortissement 28, dotation 68), as the UI shows them. */
export const FIXED_ASSET_ACCOUNTS_INCLUDE = {
  assetAccount: true,
  depreciationAccount: true,
  expenseAccount: true,
} as const

/** The company's fixed assets with their accounts, the latest created first. */
export function listFixedAssets(companyId: string) {
  return prisma.fixedAsset.findMany({
    where: { companyId },
    include: FIXED_ASSET_ACCOUNTS_INCLUDE,
    orderBy: { createdAt: 'desc' },
  })
}

/** One fixed asset of the company with its accounts, else a 404. */
export async function getFixedAsset(companyId: string, fixedAssetId: string) {
  const fixedAsset = await prisma.fixedAsset.findFirst({
    where: { id: fixedAssetId, companyId },
    include: FIXED_ASSET_ACCOUNTS_INCLUDE,
  })
  if (!fixedAsset) throw new NotFoundError(FIXED_ASSET_NOT_FOUND)
  return fixedAsset
}

/** Throws a 404 unless the fixed asset belongs to the company. */
export async function assertFixedAssetOwned(companyId: string, fixedAssetId: string): Promise<void> {
  const found = await prisma.fixedAsset.findFirst({ where: { id: fixedAssetId, companyId }, select: { id: true } })
  if (!found) throw new NotFoundError(FIXED_ASSET_NOT_FOUND)
}

export interface FixedAssetStats {
  /** Acquisition value of the active assets, in euros. */
  totalAssets: number
  /** Depreciation recorded on other fiscal years than the current one, in euros. */
  previousDepreciation: number
  /** Depreciation recorded on the current fiscal year, in euros. */
  currentDepreciation: number
}

const centsOf = (value: { toString(): string }): number => toCents(value) ?? 0
const euros = (cents: Iterable<number>): number => fromCents(Number(sumCents(cents)))

/**
 * Totals of the Immobilisations page. The current fiscal year is the latest
 * open one; depreciation comes from the records the user entered
 * (fixed_asset_depreciations), the source of truth of the register. Sums
 * are exact, in cents.
 */
export async function getFixedAssetStats(companyId: string): Promise<FixedAssetStats> {
  const [currentFiscalYear, activeAssets, records] = await Promise.all([
    prisma.fiscalYear.findFirst({
      where: { companyId, isClosed: false },
      orderBy: { endDate: 'desc' },
      select: { id: true },
    }),
    prisma.fixedAsset.findMany({ where: { companyId, isActive: true }, select: { acquisitionValue: true } }),
    prisma.fixedAssetDepreciation.findMany({ where: { companyId }, select: { fiscalYearId: true, amount: true } }),
  ])

  const isCurrent = (r: { fiscalYearId: string }) => currentFiscalYear !== null && r.fiscalYearId === currentFiscalYear.id
  return {
    totalAssets: euros(activeAssets.map((a) => centsOf(a.acquisitionValue))),
    previousDepreciation: euros(records.filter((r) => !isCurrent(r)).map((r) => centsOf(r.amount))),
    currentDepreciation: euros(records.filter(isCurrent).map((r) => centsOf(r.amount))),
  }
}
