/**
 * Depreciation table (tableau des amortissements) of a fiscal year.
 *
 * For each active fixed asset: depreciation of the previous years, of the
 * year, cumulated, and net book value. The year's allowance is the amount
 * recorded for the year (fixed_asset_depreciations, booked or entered by
 * hand) or, when nothing is recorded yet, the plan's allowance
 * (lib/fixed-assets/depreciation-plan.ts, prorata temporis) shown as not
 * booked. Previous years count the records of the years that end before
 * this one, or the plan when an asset has no earlier record (an asset
 * acquired before the books were kept in Kledg).
 */

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { buildDepreciationPlan, sumPlanCentsForPeriod } from '@/lib/fixed-assets/depreciation-plan'
import { addUtcDays } from '@/lib/utils/date'
import { fromCents, parseCents } from '@/lib/utils/money'

export interface DepreciationTableItem {
  id: string
  label: string
  acquisitionDate: Date
  acquisitionValue: number
  amortizableAmount: number
  previousDepreciation: number
  currentDepreciation: number
  totalDepreciation: number
  netBookValue: number
  /** Whether the year's allowance has an accounting entry. */
  currentPosted: boolean
  assetAccount: {
    id: string
    code: string
    label: string
  }
  depreciationAccount: {
    id: string
    code: string
    label: string
  }
  expenseAccount: {
    id: string
    code: string
    label: string
  }
  depreciationMethod: string
  depreciationRate: number | null
  depreciationDuration: number | null
}

export interface DepreciationTableResult {
  fiscalYear: {
    id: string
    year: number
    startDate: Date
    endDate: Date
    isClosed: boolean
  } | null
  depreciationTable: DepreciationTableItem[]
  /** Allowances of the year without accounting entry (see generateDepreciationEntries). */
  unposted: { count: number; amount: number }
}

type FixedAssetWithAccounts = Prisma.FixedAssetGetPayload<{
  include: {
    assetAccount: true
    depreciationAccount: true
    expenseAccount: true
    depreciations: { include: { fiscalYear: { select: { startDate: true; endDate: true } } } }
  }
}>

const cents = (value: Prisma.Decimal | number | null | undefined) => (parseCents(value) ?? 0)

export async function calculateDepreciationTable(
  companyId: string,
  fiscalYearId?: string
): Promise<DepreciationTableResult> {
  const fiscalYear = fiscalYearId
    ? await prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId } })
    : await prisma.fiscalYear.findFirst({
        where: { companyId, startDate: { lte: new Date() }, endDate: { gte: new Date() }, isClosed: false },
      })

  const fixedAssets = await prisma.fixedAsset.findMany({
    where: { companyId, isActive: true },
    include: {
      assetAccount: true,
      depreciationAccount: true,
      expenseAccount: true,
      depreciations: { include: { fiscalYear: { select: { startDate: true, endDate: true } } } },
    },
    orderBy: { acquisitionDate: 'asc' },
  })

  let unpostedCount = 0
  let unpostedCents = 0
  const depreciationTable = fixedAssets.map((asset: FixedAssetWithAccounts) => {
    const base = cents(asset.amortizableAmount ?? asset.acquisitionValue)
    const plan = buildDepreciationPlan({
      acquisitionValue: asset.acquisitionValue,
      amortizableAmount: asset.amortizableAmount,
      depreciationMethod: asset.depreciationMethod,
      depreciationRate: asset.depreciationRate,
      depreciationDuration: asset.depreciationDuration,
      decliningCoefficient: asset.decliningCoefficient,
      depreciationStartDate: asset.depreciationStartDate,
    })

    let previousCents: number
    let currentCents: number
    let currentPosted = true
    if (fiscalYear) {
      const earlier = asset.depreciations.filter((r) => r.fiscalYear.endDate < fiscalYear.startDate)
      previousCents =
        earlier.length > 0
          ? earlier.reduce((s, r) => s + cents(r.amount), 0)
          : sumPlanCentsForPeriod(plan, asset.depreciationStartDate, addUtcDays(fiscalYear.startDate, -1))
      const current = asset.depreciations.filter((r) => r.fiscalYearId === fiscalYear.id)
      if (current.length > 0) {
        currentCents = current.reduce((s, r) => s + cents(r.amount), 0)
        currentPosted = current.every((r) => !!r.accountingEntryId || cents(r.amount) === 0)
      } else {
        currentCents =
          asset.depreciationStartDate > fiscalYear.endDate
            ? 0
            : sumPlanCentsForPeriod(plan, fiscalYear.startDate, fiscalYear.endDate)
        currentPosted = currentCents === 0
      }
      currentCents = Math.max(0, Math.min(currentCents, base - previousCents))
      if (!currentPosted) {
        unpostedCount += 1
        unpostedCents += currentCents
      }
    } else {
      previousCents = 0
      currentCents = asset.depreciations.reduce((s, r) => s + cents(r.amount), 0)
    }

    const totalCents = previousCents + currentCents
    return {
      id: asset.id,
      label: asset.label,
      acquisitionDate: asset.acquisitionDate,
      acquisitionValue: fromCents(cents(asset.acquisitionValue)),
      amortizableAmount: fromCents(base),
      previousDepreciation: fromCents(previousCents),
      currentDepreciation: fromCents(currentCents),
      totalDepreciation: fromCents(totalCents),
      netBookValue: fromCents(cents(asset.acquisitionValue) - totalCents),
      currentPosted,
      assetAccount: asset.assetAccount,
      depreciationAccount: asset.depreciationAccount,
      expenseAccount: asset.expenseAccount,
      depreciationMethod: asset.depreciationMethod,
      depreciationRate: asset.depreciationRate
        ? Number(asset.depreciationRate)
        : asset.depreciationDuration
          ? 100 / Number(asset.depreciationDuration)
          : null,
      depreciationDuration: asset.depreciationDuration,
    }
  })

  return {
    fiscalYear: fiscalYear
      ? {
          id: fiscalYear.id,
          year: fiscalYear.year,
          startDate: fiscalYear.startDate,
          endDate: fiscalYear.endDate,
          isClosed: fiscalYear.isClosed,
        }
      : null,
    depreciationTable,
    unposted: { count: unpostedCount, amount: fromCents(unpostedCents) },
  }
}
