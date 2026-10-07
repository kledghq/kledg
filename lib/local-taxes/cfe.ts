/**
 * Cotisation foncière des entreprises (CFE) of a calendar year: what Kledg
 * can say without the rental value of the premises (CGI art. 1467) nor the
 * rate voted by the commune, which only the avis d'imposition gives. Pure,
 * amounts in integer cents.
 *
 * - Due each year by whoever carries on a non salaried professional
 *   activity on 1 January (CGI art. 1447).
 * - Not due the year of creation; the base is halved the year after
 *   (CGI art. 1478, II). The initial declaration 1447-C-SD is filed by
 *   31 December of the year of creation (CGI art. 1477, II).
 * - Cotisation minimum on a base the commune sets within a scale by
 *   turnover (CGI art. 1647 D); no cotisation minimum when the turnover of
 *   the reference period (the year N-2) is 5 000 € or less.
 * - Acompte of 50 % of the CFE of the year before, by 15 June, when that
 *   CFE reached 3 000 €; the balance by 15 December (CGI art. 1679
 *   quinquies). The monthly payment option is not covered.
 */

import { CFE_ACOMPTE_THRESHOLD_CENTS } from '@/lib/deadlines/engine'

export { CFE_ACOMPTE_THRESHOLD_CENTS }

/** No cotisation minimum up to this turnover of the reference year (CGI art. 1647 D, I). */
const CFE_MINIMUM_EXEMPT_TURNOVER_CENTS = 500_000

/** The PCG account of the CET (CFE and CVAE): 63511 "Contribution économique territoriale". */
export const CFE_CHARGE_ACCOUNT = { code: '63511', label: 'Contribution économique territoriale' } as const

export type CfeYearSituation =
  /** No CFE: the year the company was created (CGI art. 1478, II). */
  | 'creation-year'
  /** First year of imposition: the base is halved (CGI art. 1478, II). */
  | 'half-base'
  | 'normal'
  /** The foundation date is not known. */
  | 'unknown'

export function cfeYearSituation(year: number, foundationYear: number | null): CfeYearSituation {
  if (foundationYear === null) return 'unknown'
  if (year <= foundationYear) return 'creation-year'
  if (year === foundationYear + 1) return 'half-base'
  return 'normal'
}

/** 50 % of the CFE of the year before when it reached 3 000 €, rounded half up to the cent; 0 below. */
export function cfeAcompteOf(previousTotalCents: number): number {
  return previousTotalCents >= CFE_ACOMPTE_THRESHOLD_CENTS ? Math.round(previousTotalCents / 2) : 0
}

export interface CfeAvis {
  totalCents: number
  /** The acompte the avis d'acompte asked, when entered. */
  acompteCents: number | null
}

export interface CfeSchedule {
  /** Acompte of 15 June, 0 when none is due. */
  acompteCents: number
  /** Where the acompte comes from: the avis entered, 50 % of last year's CFE, or none. */
  acompteFrom: 'avis' | 'previous-year' | 'none' | 'unknown'
  /** Balance of 15 December: the total minus the acompte; null without the avis. */
  balanceCents: number | null
}

/**
 * The payments of the CFE of `year`: the acompte entered from the avis
 * d'acompte, else 50 % of the CFE of the year before when it reached
 * 3 000 € (CGI art. 1679 quinquies), and the balance once the avis gives
 * the total.
 */
export function cfeSchedule(avis: CfeAvis | null, previous: CfeAvis | null, situation: CfeYearSituation): CfeSchedule {
  if (situation === 'creation-year') return { acompteCents: 0, acompteFrom: 'none', balanceCents: avis ? avis.totalCents : 0 }
  let acompteCents = 0
  let acompteFrom: CfeSchedule['acompteFrom']
  if (avis && avis.acompteCents !== null) {
    acompteCents = avis.acompteCents
    acompteFrom = acompteCents > 0 ? 'avis' : 'none'
  } else if (situation === 'half-base') {
    // No CFE the year before (the year of creation), so no acompte.
    acompteFrom = 'none'
  } else if (previous) {
    acompteCents = cfeAcompteOf(previous.totalCents)
    acompteFrom = acompteCents > 0 ? 'previous-year' : 'none'
  } else {
    acompteFrom = 'unknown'
  }
  return { acompteCents, acompteFrom, balanceCents: avis ? Math.max(avis.totalCents - acompteCents, 0) : null }
}

export interface ExpectedCfeCharge {
  year: number
  /** Expected CFE of the year, null when nothing is known. */
  cents: number | null
  /** The avis of the year, last year's CFE as an estimate, nothing the year of creation. */
  source: 'avis' | 'previous-year' | 'creation-year' | 'unknown'
  account: typeof CFE_CHARGE_ACCOUNT
  /** The charge by month of payment, for a budget line of 63511 (yyyy-mm). */
  months: Array<{ month: string; cents: number }>
}

/**
 * The CFE to plan for a year, on 63511: the avis when entered, else last
 * year's CFE (the commune rate and the base change little from one year to
 * the next, an estimate the page says is one), split between June (the
 * acompte) and December (the balance).
 */
export function expectedCfeCharge(year: number, avis: CfeAvis | null, previous: CfeAvis | null, situation: CfeYearSituation): ExpectedCfeCharge {
  const base = { year, account: CFE_CHARGE_ACCOUNT }
  if (situation === 'creation-year') return { ...base, cents: 0, source: 'creation-year', months: [] }
  const total = avis?.totalCents ?? previous?.totalCents ?? null
  if (total === null) return { ...base, cents: null, source: 'unknown', months: [] }
  const schedule = cfeSchedule(avis ?? { totalCents: total, acompteCents: null }, previous, situation)
  const acompte = Math.min(schedule.acompteCents, total)
  const months = [
    ...(acompte > 0 ? [{ month: `${year}-06`, cents: acompte }] : []),
    ...(total - acompte > 0 ? [{ month: `${year}-12`, cents: total - acompte }] : []),
  ]
  return { ...base, cents: total, source: avis ? 'avis' : 'previous-year', months }
}

/** Whether the turnover of the reference year (N-2) exempts the company from the cotisation minimum (CGI art. 1647 D). */
export function cfeMinimumExempt(referenceTurnoverCents: number | null): boolean | null {
  return referenceTurnoverCents === null ? null : referenceTurnoverCents <= CFE_MINIMUM_EXEMPT_TURNOVER_CENTS
}
