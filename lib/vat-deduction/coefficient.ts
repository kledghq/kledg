/**
 * The share of its deductible VAT a company recovers on a day, for the
 * postings Kledg prepares (simple mode, assignment rules, purchase
 * invoices), and the coefficients of a calendar year
 * (docs/organisme-de-formation.md, lib/vat-deduction/rules.ts).
 *
 * - Subject to VAT on all its operations (neither exempt nor partial): full
 *   deduction (null), the behaviour of every other company.
 * - Franchise en base (CGI art. 293 B): no deduction at all (0).
 * - Exempt (isVatExempt) or partly exempt (partialVatDeduction): the
 *   provisional coefficient de déduction of the year of the day, the
 *   coefficient d'assujettissement times the provisional coefficient de
 *   taxation, rounded up to the whole percent (CGI ann. II art. 206).
 *
 * Every query is scoped by the company.
 */

import { prisma } from '@/lib/prisma'
import { calendarDayOf } from '@/lib/utils/date'
import { loadRevenueRows } from './load-revenue'
import { summarizeRevenue, type AccountSetting, type RevenueSummary, type VatTreatment } from './revenue'
import { deductionPercent, provisionalTaxation, roundUpPercent, type ProvisionalSource } from './rules'

export type DeductionMode = 'full' | 'franchise' | 'coefficient'

/** Settings rows read at most (a chart has a few hundred revenue accounts at most). */
const MAX_SETTINGS = 1_000

interface CompanyVat {
  isVatExempt: boolean
  partialVatDeduction: boolean
  vatRegime: string | null
}

/** The VAT regime written on a day: the history row covering it (whole company), else the company field. */
async function regimeOn(companyId: string, company: CompanyVat, day: string): Promise<string | null> {
  const at = new Date(`${day}T00:00:00.000Z`)
  const row = await prisma.taxRegimeHistory.findFirst({
    where: { companyId, regimeType: 'vat', establishmentId: null, startDate: { lte: at }, OR: [{ endDate: null }, { endDate: { gte: at } }] },
    orderBy: { startDate: 'desc' },
    select: { regime: true },
  })
  return row?.regime ?? company.vatRegime
}

export async function deductionModeOn(companyId: string, day: string): Promise<{ mode: DeductionMode; company: CompanyVat | null }> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { isVatExempt: true, partialVatDeduction: true, vatRegime: true } })
  if (!company || (!company.isVatExempt && !company.partialVatDeduction)) return { mode: 'full', company }
  if ((await regimeOn(companyId, company, day)) === 'franchise') return { mode: 'franchise', company }
  return { mode: 'coefficient', company }
}

export async function loadAccountSettings(companyId: string): Promise<Array<AccountSetting & { trainingOrigin: string | null }>> {
  const rows = await prisma.revenueAccountSetting.findMany({
    where: { companyId },
    select: { accountCode: true, vatTreatment: true, trainingOrigin: true },
    orderBy: { accountCode: 'asc' },
    take: MAX_SETTINGS,
  })
  return rows.map((r) => ({ accountCode: r.accountCode, vatTreatment: (r.vatTreatment as VatTreatment | null) ?? null, trainingOrigin: r.trainingOrigin }))
}

export interface TaxationOfPeriod {
  revenue: RevenueSummary
  /** Coefficient de taxation in whole percent, rounded up; null without turnover. */
  percent: number | null
}

export async function taxationOf(companyId: string, from: string, to: string, settings?: readonly AccountSetting[]): Promise<TaxationOfPeriod> {
  const [rows, accountSettings] = await Promise.all([loadRevenueRows(companyId, from, to), settings ? Promise.resolve(settings) : loadAccountSettings(companyId)])
  const revenue = summarizeRevenue(rows, accountSettings)
  return { revenue, percent: roundUpPercent(revenue.numeratorCents, revenue.denominatorCents) }
}

export interface ProvisionalCoefficient {
  year: number
  taxationPercent: number
  source: ProvisionalSource
  assujettissementPercent: number
  /** Coefficient de déduction applied to the VAT of the year's expenses. */
  deductionPercent: number
}

/** The provisional coefficient of a year (rules.ts, provisionalTaxation), computed from the books up to `asOf` for a first year. */
export async function provisionalCoefficientOf(companyId: string, year: number, asOf: string, settings?: readonly AccountSetting[]): Promise<ProvisionalCoefficient> {
  const [row, previous] = await Promise.all([
    prisma.vatDeductionYear.findUnique({ where: { companyId_year: { companyId, year } }, select: { estimatedTaxationPercent: true, assujettissementPercent: true } }),
    taxationOf(companyId, `${year - 1}-01-01`, `${year - 1}-12-31`, settings),
  ])
  const estimate = row?.estimatedTaxationPercent ?? null
  const needsToDate = previous.percent === null && estimate === null
  const toDate = needsToDate ? await taxationOf(companyId, `${year}-01-01`, asOf < `${year}-12-31` ? asOf : `${year}-12-31`, settings) : null
  const provisional = provisionalTaxation({ previousYearPercent: previous.percent, estimatePercent: estimate, yearToDatePercent: toDate?.percent ?? null })
  const assujettissement = row?.assujettissementPercent ?? 100
  return {
    year,
    taxationPercent: provisional.percent,
    source: provisional.source,
    assujettissementPercent: assujettissement,
    deductionPercent: deductionPercent(assujettissement, provisional.percent),
  }
}

/** What a posting needs on a day: whether the company is under the franchise, and the share of deductible VAT it recovers. */
export interface VatDeductionOnDay {
  /** Franchise en base (CGI art. 293 B): no VAT collected, none deducted. */
  franchise: boolean
  /** Share (0 to 1) of deductible VAT recovered, null when the company deducts all of it. */
  share: number | null
  /** The same in whole percent (the provisional coefficient de déduction), null when the company deducts all of it. */
  percent: number | null
}

/**
 * The deduction of a company on `day`. Collected VAT does not depend on it:
 * a partly exempt company collects VAT on its taxed sales like any other
 * (CGI art. 256); only the franchise collects none (art. 293 B).
 */
export async function vatDeductionOn(companyId: string, day: Date | string): Promise<VatDeductionOnDay> {
  const iso = typeof day === 'string' ? day : (calendarDayOf(day) as string)
  const { mode } = await deductionModeOn(companyId, iso)
  if (mode === 'full') return { franchise: false, share: null, percent: null }
  if (mode === 'franchise') return { franchise: true, share: 0, percent: 0 }
  const coefficient = await provisionalCoefficientOf(companyId, Number(iso.slice(0, 4)), iso)
  return { franchise: false, share: coefficient.deductionPercent / 100, percent: coefficient.deductionPercent }
}

/**
 * The share (0 to 1) of deductible VAT the company recovers on `day`, null
 * when it deducts all of it. Replaces the monthly ratio of revenue with VAT
 * Kledg used before (an approximation without legal basis).
 */
export async function vatDeductionShareOn(companyId: string, day: Date | string): Promise<number | null> {
  return (await vatDeductionOn(companyId, day)).share
}
