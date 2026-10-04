/**
 * Depreciation status of one fixed asset (the "Amortissements" dialog): per
 * fiscal year and per month, the amount the user recorded
 * (fixed_asset_depreciations, not accounting entries) next to the amount the
 * theoretical plan suggests (lib/fixed-assets/depreciation-plan.ts).
 *
 * - Fiscal years before the depreciation start are left out, and so are
 *   years after the end of the plan that hold no record.
 * - Calendar years of the plan without a fiscal year yet are listed as
 *   "virtual" years (read only until the fiscal year is created).
 * - The suggestions of the years without a record share what remains to
 *   depreciate (base minus recorded) in proportion to the plan, so the
 *   remainder is not concentrated on one real year.
 *
 * Amounts are computed in cents and returned in euros; dates are UTC
 * calendar days.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { fromCents, sumCents, toCents } from '@/lib/utils/money'
import { buildDepreciationPlan, sumPlanCentsForPeriod } from './depreciation-plan'
import { FIXED_ASSET_NOT_FOUND } from './read-fixed-assets.service'

const LINKED_ENTRY_SELECT = { id: true, entryNumber: true, date: true } as const

type DepreciationRecord = Prisma.FixedAssetDepreciationGetPayload<{
  include: { accountingEntry: { select: typeof LINKED_ENTRY_SELECT } }
}>

type FixedAssetRow = Prisma.FixedAssetGetPayload<object>

interface FiscalYearRow {
  id: string
  year: number
  startDate: Date
  endDate: Date
  isClosed: boolean
}

interface LinkedEntry {
  id: string
  entryNumber: string
  date: Date
}

interface RecordedAmount {
  id: string
  amount: number
  note: string | null
  accountingEntry: LinkedEntry | null
}

export interface DepreciationMonth {
  monthIndex: number
  calendarYear: number
  monthStart: string
  monthEnd: string
  suggestedAmount: number
  posted: RecordedAmount | null
}

export interface DepreciationYear {
  fiscalYearId: string
  virtual: boolean
  year: number
  startDate: Date | string
  endDate: Date | string
  isClosed: boolean
  entriesCount: number
  postedAmount: number
  /** Same as postedAmount, read by the list of the Immobilisations page. */
  amount: number
  suggestedAmount: number
  done: boolean
  yearlyRecord: RecordedAmount | null
  /** The records in the shape of entries, read by the list of the Immobilisations page. */
  entries: Array<{
    id: string
    entryNumber: string
    date: Date
    amount: number
    accountingEntry: LinkedEntry | null
    description: string
  }>
  months: DepreciationMonth[]
  lastEntryDate: null
}

export interface DepreciationStatus {
  done: boolean
  date: undefined
  baseAmount: number
  totalPosted: number
  remainingCapacity: number
  depreciationMethod: string
  depreciationStartDate: Date
  fiscalYears: DepreciationYear[]
}

const centsOf = (value: { toString(): string } | null | undefined): number => (value == null ? 0 : (toCents(value) ?? 0))
const totalCents = (values: number[]): number => Number(sumCents(values))
const utcMonthStart = (year: number, monthIndex: number) => new Date(Date.UTC(year, monthIndex, 1))
const utcMonthEnd = (year: number, monthIndex: number) => new Date(Date.UTC(year, monthIndex + 1, 0))
const monthLabel = (year: number, monthIndex: number) =>
  utcMonthStart(year, monthIndex).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })

function recordedAmount(record: DepreciationRecord): RecordedAmount {
  return {
    id: record.id,
    amount: fromCents(centsOf(record.amount)),
    note: record.note,
    accountingEntry: record.accountingEntry
      ? { id: record.accountingEntry.id, entryNumber: record.accountingEntry.entryNumber, date: record.accountingEntry.date }
      : null,
  }
}

export interface DepreciationStatusInput {
  fixedAsset: FixedAssetRow
  fiscalYears: FiscalYearRow[]
  records: DepreciationRecord[]
  /** Today, to tell whether the current fiscal year is depreciated. */
  now: Date
}

/** The status from loaded rows (pure: no database, no clock). */
export function buildDepreciationStatus({ fixedAsset, fiscalYears, records, now }: DepreciationStatusInput): DepreciationStatus {
  const plan = buildDepreciationPlan({
    acquisitionValue: fixedAsset.acquisitionValue,
    amortizableAmount: fixedAsset.amortizableAmount,
    depreciationMethod: fixedAsset.depreciationMethod,
    depreciationRate: fixedAsset.depreciationRate,
    depreciationDuration: fixedAsset.depreciationDuration,
    decliningCoefficient: fixedAsset.decliningCoefficient,
    depreciationStartDate: new Date(fixedAsset.depreciationStartDate),
  })
  // Suggestions are kept in cents until the response.
  const suggestedCents = (from: Date, to: Date) => sumPlanCentsForPeriod(plan, from, to)

  const totalPostedCents = totalCents(records.map((r) => centsOf(r.amount)))

  // Years from the depreciation start, up to the end of the plan (or with a record).
  const depStart = new Date(fixedAsset.depreciationStartDate)
  const planKeys = Array.from(plan.byMonth.keys()).sort()
  const lastPlanKey = planKeys[planKeys.length - 1]
  const lastPlanDate = lastPlanKey
    ? (() => {
        const [y, m] = lastPlanKey.split('-').map((part) => parseInt(part, 10))
        return utcMonthEnd(y, m - 1)
      })()
    : null

  const relevantFiscalYears = fiscalYears.filter((fy) => {
    if (new Date(fy.endDate) < depStart) return false
    const hasRecord = records.some((r) => r.fiscalYearId === fy.id)
    return !(lastPlanDate && new Date(fy.startDate) > lastPlanDate && !hasRecord)
  })

  // Plan suggestion of each year in cents, before the remainder is shared.
  const planCentsOf = new Map<DepreciationYear, number>()

  const byYear: DepreciationYear[] = relevantFiscalYears.map((fy) => {
    const fyStart = new Date(fy.startDate)
    const fyEnd = new Date(fy.endDate)
    const fyRecords = records.filter((r) => r.fiscalYearId === fy.id)
    const yearRecord = fyRecords.find((r) => r.periodType === 'year') ?? null
    const monthRecords = fyRecords.filter((r) => r.periodType === 'month')
    const postedAmount = fromCents(totalCents(fyRecords.map((r) => centsOf(r.amount))))
    const yearSuggestedCents = suggestedCents(fyStart, fyEnd)

    const months: DepreciationMonth[] = []
    let cursor = utcMonthStart(fyStart.getUTCFullYear(), fyStart.getUTCMonth())
    const lastMonth = utcMonthStart(fyEnd.getUTCFullYear(), fyEnd.getUTCMonth())
    while (cursor <= lastMonth) {
      const monthIndex = cursor.getUTCMonth()
      const calendarYear = cursor.getUTCFullYear()
      const monthStart = utcMonthStart(calendarYear, monthIndex)
      const monthEnd = utcMonthEnd(calendarYear, monthIndex)
      const clampedStart = monthStart < fyStart ? fyStart : monthStart
      const clampedEnd = monthEnd > fyEnd ? fyEnd : monthEnd
      const record = monthRecords.find((r) => r.monthIndex === monthIndex) ?? null
      months.push({
        monthIndex,
        calendarYear,
        monthStart: clampedStart.toISOString(),
        monthEnd: clampedEnd.toISOString(),
        suggestedAmount: fromCents(suggestedCents(clampedStart, clampedEnd)),
        posted: record ? recordedAmount(record) : null,
      })
      cursor = utcMonthStart(calendarYear, monthIndex + 1)
    }

    const year: DepreciationYear = {
      fiscalYearId: fy.id,
      virtual: false,
      year: fy.year,
      startDate: fy.startDate,
      endDate: fy.endDate,
      isClosed: fy.isClosed,
      entriesCount: fyRecords.length,
      postedAmount,
      amount: postedAmount,
      suggestedAmount: fromCents(yearSuggestedCents),
      done: fyRecords.length > 0,
      yearlyRecord: yearRecord ? recordedAmount(yearRecord) : null,
      entries: fyRecords.map((r) => ({
        id: r.id,
        entryNumber: r.accountingEntry?.entryNumber ?? `AMR-${r.id.slice(-6).toUpperCase()}`,
        date: r.updatedAt ?? r.createdAt,
        amount: fromCents(centsOf(r.amount)),
        accountingEntry: r.accountingEntry
          ? { id: r.accountingEntry.id, entryNumber: r.accountingEntry.entryNumber, date: r.accountingEntry.date }
          : null,
        description: r.periodType === 'year' ? `Amortissement ${fy.year}` : `Amortissement ${monthLabel(r.year, r.monthIndex ?? 0)}`,
      })),
      months,
      lastEntryDate: null,
    }
    planCentsOf.set(year, yearSuggestedCents)
    return year
  })

  // Calendar years of the plan without a fiscal year: listed as virtual years.
  const planYears = new Set<number>()
  for (const key of plan.byMonth.keys()) planYears.add(parseInt(key.split('-')[0], 10))
  const existingYears = new Set<number>()
  for (const fy of relevantFiscalYears) {
    for (let y = new Date(fy.startDate).getUTCFullYear(); y <= new Date(fy.endDate).getUTCFullYear(); y++) existingYears.add(y)
  }
  const virtualYears: DepreciationYear[] = Array.from(planYears)
    .filter((y) => !existingYears.has(y))
    .sort()
    .map((y) => {
      const yStart = utcMonthStart(y, 0)
      const yEnd = new Date(Date.UTC(y, 11, 31))
      const months: DepreciationMonth[] = []
      for (let m = 0; m < 12; m++) {
        const monthStart = utcMonthStart(y, m)
        const monthEnd = utcMonthEnd(y, m)
        const cents = suggestedCents(monthStart, monthEnd)
        // Months entirely before the start of the plan are skipped.
        if (cents <= 0 && m < 11 && monthEnd < depStart) continue
        months.push({
          monthIndex: m,
          calendarYear: y,
          monthStart: monthStart.toISOString(),
          monthEnd: monthEnd.toISOString(),
          suggestedAmount: fromCents(cents),
          posted: null,
        })
      }
      const yearCents = suggestedCents(yStart, yEnd)
      const year: DepreciationYear = {
        fiscalYearId: `virtual-${y}`,
        virtual: true,
        year: y,
        startDate: yStart.toISOString(),
        endDate: yEnd.toISOString(),
        isClosed: false,
        entriesCount: 0,
        postedAmount: 0,
        amount: 0,
        suggestedAmount: fromCents(yearCents),
        done: false,
        yearlyRecord: null,
        entries: [],
        months,
        lastEntryDate: null,
      }
      planCentsOf.set(year, yearCents)
      return year
    })

  const allYears = [...byYear, ...virtualYears].sort((a, b) => a.year - b.year)
  const baseCents = centsOf(fixedAsset.amortizableAmount ?? fixedAsset.acquisitionValue)
  const remainingCents = Math.max(0, baseCents - totalPostedCents)

  // The years without a record share the remainder with the weights of the plan.
  const unpostedYears = allYears.filter((fy) => fy.entries.length === 0)
  const unpostedPlanCents = totalCents(unpostedYears.map((fy) => planCentsOf.get(fy) ?? 0))
  if (unpostedPlanCents > 0) {
    for (const fy of unpostedYears) {
      fy.suggestedAmount = fromCents(Math.round((remainingCents * (planCentsOf.get(fy) ?? 0)) / unpostedPlanCents))
    }
  }

  const currentYear = byYear.find((y) => new Date(y.startDate) <= now && now <= new Date(y.endDate))

  return {
    done: !!currentYear?.done,
    date: undefined,
    baseAmount: fromCents(baseCents),
    totalPosted: fromCents(totalPostedCents),
    remainingCapacity: fromCents(remainingCents),
    depreciationMethod: fixedAsset.depreciationMethod,
    depreciationStartDate: fixedAsset.depreciationStartDate,
    fiscalYears: allYears,
  }
}

/** The depreciation status of a fixed asset of the company (404 for another company's). */
export async function getDepreciationStatus(companyId: string, fixedAssetId: string, now = new Date()): Promise<DepreciationStatus> {
  const fixedAsset = await prisma.fixedAsset.findFirst({ where: { id: fixedAssetId, companyId } })
  if (!fixedAsset) throw new NotFoundError(FIXED_ASSET_NOT_FOUND)

  const [fiscalYears, records] = await Promise.all([
    prisma.fiscalYear.findMany({
      where: { companyId },
      orderBy: { year: 'asc' },
      select: { id: true, year: true, startDate: true, endDate: true, isClosed: true },
    }),
    prisma.fixedAssetDepreciation.findMany({
      where: { fixedAssetId, companyId },
      include: { accountingEntry: { select: LINKED_ENTRY_SELECT } },
    }),
  ])

  return buildDepreciationStatus({ fixedAsset, fiscalYears, records, now })
}
