/**
 * Transfer of an investment grant to the result (pure module): the part of
 * the grant that should have been transferred by the end of a fiscal year.
 * The share of a year is the difference between two consecutive cumulative
 * amounts, each rounded to the cent, so the shares add up to the grant.
 *
 * Sources:
 * - PCG art. 312-1 (ANC 2014-03): a grant recorded in equity is transferred
 *   to the result:
 *   - when it finances a depreciable asset, over the same period and at the
 *     same rhythm as the depreciation of that asset;
 *   - when it finances a non-depreciable asset with an inalienability
 *     clause, over the number of years the asset is inalienable;
 *   - when it finances a non-depreciable asset without such a clause, by a
 *     tenth of its amount each year.
 * - CGI art. 42 septies and BOFiP BOI-BIC-PDSTK-10-30-10-20: the same
 *   spreading for corporate tax; when the asset is sold, the part not yet
 *   transferred is taken into the result of the year of the sale.
 * - Chart of accounts (ANC 2022-06, fiscal years from 2025): 131 grant
 *   received, 139 subventions d'investissement inscrites au compte de
 *   résultat, 747 quote-part des subventions d'investissement virée au
 *   résultat de l'exercice. The former chart used 777 in exceptional
 *   income; the account can be changed per grant.
 */

import { buildDepreciationPlan, sumPlanCentsForPeriod } from '@/lib/fixed-assets/depreciation-plan'
import { isoDateToUtc } from '@/lib/utils/date'
import { fromCents } from '@/lib/utils/money'

export const GRANT_SPREADINGS = ['ASSET', 'LINEAR', 'INALIENABILITY', 'TENTHS'] as const
export type GrantSpreading = (typeof GRANT_SPREADINGS)[number]

export const SPREADING_LABELS: Record<GrantSpreading, string> = {
  ASSET: 'Au rythme de l\'amortissement de l\'immobilisation',
  LINEAR: 'Linéaire sur la durée d\'amortissement',
  INALIENABILITY: 'Sur la durée d\'inaliénabilité',
  TENTHS: 'Par dixièmes (bien non amortissable)',
}

export interface GrantTerms {
  amountCents: number
  spreading: GrantSpreading
  /** yyyy-mm-dd */
  grantedOn: string
  /** LINEAR: years of depreciation; INALIENABILITY: years of inalienability. */
  durationYears: number | null
}

export interface ScheduleYear {
  /** Number of the fiscal year (FiscalYear.year). */
  year: number
  /** yyyy-mm-dd */
  startDate: string
  /** yyyy-mm-dd */
  endDate: string
}

/** The financed asset at the end of the fiscal year (ASSET spreading). */
export interface FinancedAsset {
  depreciable: boolean
  /** Depreciable base, in cents. */
  baseCents: number
  /** Depreciation accumulated at the end of the fiscal year (lib/fixed-assets/cumulative-depreciation.ts). */
  depreciatedCents: number
  /** Sold or scrapped on or before the end of the fiscal year. */
  disposed: boolean
}

export interface ScheduleContext {
  /** Number of the fiscal year containing grantedOn (its calendar year when the company has no such year). */
  grantYear: number
  asset?: FinancedAsset | null
}

/** Share `numerator / denominator` of `amountCents`, rounded half up, between 0 and the amount. */
function prorata(amountCents: number, numerator: number, denominator: number): number {
  if (denominator <= 0 || numerator <= 0) return 0
  if (numerator >= denominator) return amountCents
  return Math.round((amountCents * numerator) / denominator)
}

/**
 * Part of the grant that should be in the result at the end of the fiscal
 * year (cumulative, in cents). Nothing before the year the grant is
 * awarded; the whole grant once the financed asset is sold (CGI art. 42
 * septies).
 */
export function cumulativeTransferCents(terms: GrantTerms, year: ScheduleYear, context: ScheduleContext): number {
  const amount = terms.amountCents
  if (amount <= 0 || terms.grantedOn > year.endDate) return 0
  switch (terms.spreading) {
    case 'ASSET': {
      const asset = context.asset
      if (!asset) return 0
      if (asset.disposed) return amount
      if (!asset.depreciable) return 0
      return prorata(amount, asset.depreciatedCents, asset.baseCents)
    }
    case 'LINEAR': {
      const years = terms.durationYears ?? 0
      if (years <= 0) return 0
      // The grant spread like a linear depreciation of its own amount from the day it was awarded (prorata temporis)
      const plan = buildDepreciationPlan({
        acquisitionValue: fromCents(amount),
        amortizableAmount: null,
        depreciationMethod: 'linear',
        depreciationRate: null,
        depreciationDuration: years,
        decliningCoefficient: null,
        depreciationStartDate: isoDateToUtc(terms.grantedOn),
      })
      return Math.min(amount, sumPlanCentsForPeriod(plan, plan.start, isoDateToUtc(year.endDate)))
    }
    case 'INALIENABILITY':
    case 'TENTHS': {
      const years = terms.spreading === 'TENTHS' ? 10 : (terms.durationYears ?? 0)
      const elapsed = year.year - context.grantYear + 1
      return prorata(amount, elapsed, years)
    }
  }
}

/**
 * Share of the fiscal year still to transfer: what should be in the result
 * at its end, less what already is (`transferredCents`: carried over from
 * before Kledg and booked in Kledg). Never negative: a share booked too
 * early is not taken back, it only reduces the next ones.
 */
export function transferDueCents(terms: GrantTerms, year: ScheduleYear, context: ScheduleContext, transferredCents: number): number {
  return Math.max(0, cumulativeTransferCents(terms, year, context) - transferredCents)
}

/** Lines of the transfer entry: debit 139, credit 747 (or the grant's accounts). */
export function transferLines(
  cents: number,
  accounts: { transfer: { code: string; label: string }; income: { code: string; label: string } },
): Array<{ code: string; label: string; debitCents: number; creditCents: number }> {
  if (cents <= 0) return []
  return [
    { code: accounts.transfer.code, label: accounts.transfer.label, debitCents: cents, creditCents: 0 },
    { code: accounts.income.code, label: accounts.income.label, debitCents: 0, creditCents: cents },
  ]
}

export const GRANT_ACCOUNTS = {
  grant: { code: '131', label: 'Subventions d\'investissement octroyées' },
  transfer: { code: '139', label: 'Subventions d\'investissement inscrites au compte de résultat' },
  income: { code: '747', label: 'Quote-part des subventions d\'investissement virée au résultat de l\'exercice' },
} as const
