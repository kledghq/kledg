/**
 * Cotisation sur la valeur ajoutée des entreprises (CVAE) of a calendar
 * year, from the turnover and the value added of the fiscal years closed in
 * that year. Pure: no database, amounts in integer cents, rates as integers.
 *
 * Law in force on 5 October 2026 (docs/impots-locaux.md):
 * - CGI art. 1586 ter to 1586 nonies, as amended by the loi de finances
 *   pour 2024 (phase out) and the loi n° 2025-127 du 14 février 2025, art.
 *   62, which postponed the phase out by three years: maximum rate 0,28 %
 *   in 2024, 0,19 % in 2025 (with a contribution complémentaire of 47,4 %
 *   of the CVAE of 2025, paid in 2025 and 2026), 0,28 % in 2026 and 2027,
 *   0,19 % in 2028, 0,09 % in 2029, **abolished from 2030**. The loi de
 *   finances pour 2026 did not bring the abolition forward (the bill did,
 *   the text adopted did not).
 * - Rate (art. 1586 quater, BOI-CVAE-LIQ-10 §60): 0 up to 500 000 € of
 *   turnover, then a progressive rate by band, rounded to the nearest
 *   hundredth of a percent up to 50 000 000 € (example of the BOFiP: 2 700 000 €
 *   in 2026: 0,094 % x 2 200 000 / 2 500 000 = 0,0827 %, rounded to 0,08 %).
 * - Dégrèvement for a turnover under 2 000 000 € (art. 1586 quater, II;
 *   BOI-CVAE-LIQ-10 §170): 188 € in 2024, 2026 and 2027, 125 € in 2025 and
 *   2028, 63 € in 2029.
 * - Franchise (BOI-CVAE-LIQ-10 §180): no CVAE when its annual amount does not
 *   exceed 63 €, applied here after the dégrèvement.
 * - Value added (art. 1586 sexies, VII): capped at 80 % of the turnover up
 *   to 7 600 000 €, 85 % above.
 * - Declaration 1330-CVAE above 152 500 € of turnover (art. 1586 octies,
 *   BOI-CVAE-DECLA-10); CVAE paid above 500 000 €; acomptes 1329-AC when the
 *   CVAE of the year before exceeds 1 500 € (art. 1679 septies).
 *
 * Years before 2024 are not covered (other rates, a cotisation minimum):
 * Kledg says so instead of computing them.
 */

import { CVAE_LAST_YEAR } from '@/lib/deadlines/engine'

export { CVAE_LAST_YEAR }

/** First year computed; earlier ones are historical and not covered. */
export const CVAE_FIRST_YEAR = 2024

export const CVAE_DECLARATION_THRESHOLD_CENTS = 15_250_000
export const CVAE_PAYMENT_THRESHOLD_CENTS = 50_000_000
export const CVAE_ACOMPTE_THRESHOLD_CENTS = 150_000
export const CVAE_FRANCHISE_CENTS = 6_300
const DEGREVEMENT_TURNOVER_CENTS = 200_000_000
const VA_CAP_TURNOVER_CENTS = 760_000_000

/**
 * The scale of a year, rates in thousandths of a percent (0,094 % = 94):
 * the band ending at 3 000 000 €, the increment of the band ending at
 * 10 000 000 €, the start and increment of the band ending at 50 000 000 €,
 * the maximum rate, the dégrèvement under 2 000 000 € (cents) and the
 * contribution complémentaire (thousandths of the CVAE).
 */
interface Scale {
  band1: number
  band2: number
  band3Base: number
  band3: number
  max: number
  degrevementCents: number
  complementaryPerMille: number
}

const FULL: Scale = { band1: 94, band2: 169, band3Base: 263, band3: 19, max: 280, degrevementCents: 18_800, complementaryPerMille: 0 }
const REDUCED: Scale = { band1: 63, band2: 113, band3Base: 175, band3: 13, max: 190, degrevementCents: 12_500, complementaryPerMille: 0 }
const LAST: Scale = { band1: 31, band2: 56, band3Base: 87, band3: 6, max: 90, degrevementCents: 6_300, complementaryPerMille: 0 }

/** Scales by year (BOI-CVAE-LIQ-10 §60 and §170; loi n° 2025-127, art. 62). */
export const CVAE_SCALES: Readonly<Record<number, Scale>> = {
  2024: FULL,
  // 2025: 0,19 % plus a contribution complémentaire of 47,4 % of the CVAE (loi n° 2025-127, art. 62, I, B).
  2025: { ...REDUCED, complementaryPerMille: 474 },
  2026: FULL,
  2027: FULL,
  2028: REDUCED,
  2029: LAST,
}

export type CvaeYearStatus = 'in-force' | 'abolished' | 'not-covered'

export function cvaeYearStatus(year: number): CvaeYearStatus {
  if (year > CVAE_LAST_YEAR) return 'abolished'
  if (year < CVAE_FIRST_YEAR) return 'not-covered'
  return 'in-force'
}

/** The maximum rate of a year as a French percentage ("0,28 %"), null outside the covered years. */
export function cvaeMaxRateLabel(year: number): string | null {
  const scale = CVAE_SCALES[year]
  return scale ? `${(scale.max / 1000).toFixed(2).replace('.', ',')} %` : null
}

const big = (n: number) => BigInt(Math.round(n))

/** a / b rounded half up, on non-negative BigInts. */
function divRound(a: bigint, b: bigint): bigint {
  return (a * BigInt(2) + b) / (BigInt(2) * b)
}

/**
 * The effective rate in hundredths of a percent (0,08 % = 8), from the
 * annual turnover in cents: art. 1586 quater, rounded to the nearest
 * hundredth up to 50 000 000 €; the maximum rate above.
 */
export function cvaeRateHundredths(year: number, turnoverCents: number): number {
  const scale = CVAE_SCALES[year]
  if (!scale || turnoverCents <= CVAE_PAYMENT_THRESHOLD_CENTS) return 0
  const ca = big(turnoverCents)
  // thousandths of a percent times the band width, then to hundredths (divide by 10)
  if (turnoverCents <= 300_000_000) return Number(divRound(big(scale.band1) * (ca - BigInt(50_000_000)), BigInt(250_000_000) * BigInt(10)))
  if (turnoverCents <= 1_000_000_000) {
    return Number(divRound(big(scale.band1) * BigInt(700_000_000) + big(scale.band2) * (ca - BigInt(300_000_000)), BigInt(700_000_000) * BigInt(10)))
  }
  if (turnoverCents <= 5_000_000_000) {
    return Number(divRound(big(scale.band3Base) * BigInt(4_000_000_000) + big(scale.band3) * (ca - BigInt(1_000_000_000)), BigInt(4_000_000_000) * BigInt(10)))
  }
  // Above 50 000 000 €: the maximum rate itself (0,28 %), not rounded.
  return scale.max / 10
}

/** The value added capped at 80 % of the turnover, 85 % above 7 600 000 € (art. 1586 sexies, VII). */
export function capValueAdded(valueAddedCents: number, turnoverCents: number): { cents: number; capCents: number; capped: boolean } {
  const capCents = Number(divRound(big(Math.max(turnoverCents, 0)) * (turnoverCents > VA_CAP_TURNOVER_CENTS ? BigInt(85) : BigInt(80)), BigInt(100)))
  const positive = Math.max(valueAddedCents, 0)
  return positive > capCents ? { cents: capCents, capCents, capped: true } : { cents: positive, capCents, capped: false }
}

export interface CvaeInput {
  year: number
  /** Turnover of the period (comptes 70), in cents. */
  turnoverCents: number
  /** Turnover brought to twelve months, which sets the rate and the thresholds (art. 1586 quater). */
  turnoverAnnualCents: number
  /** Value added of the period after the manual adjustments, before the cap. */
  valueAddedCents: number
}

export interface CvaeComputation {
  year: number
  status: CvaeYearStatus
  /** 1330-CVAE due: turnover above 152 500 €. */
  declarationRequired: boolean
  /** Turnover above 500 000 €: a CVAE may be due. */
  taxable: boolean
  valueAdded: { beforeCapCents: number; capCents: number; capped: boolean; cents: number }
  /** Hundredths of a percent (0,08 % = 8, 0,28 % = 28). */
  rateHundredths: number
  rateLabel: string
  grossCents: number
  degrevementCents: number
  /** After the dégrèvement, zero under the franchise of 63 €. */
  cvaeCents: number
  franchise: boolean
  /** 2025 only: 47,4 % of the CVAE (loi n° 2025-127, art. 62). */
  complementaryCents: number
  totalCents: number
}

/** The rate as a French percentage: "0,08 %", "0,28 %". */
function rateLabelOf(hundredths: number): string {
  return `${(hundredths / 100).toFixed(2).replace('.', ',')} %`
}

export function computeCvae(input: CvaeInput): CvaeComputation {
  const status = cvaeYearStatus(input.year)
  const declarationRequired = status === 'in-force' && input.turnoverAnnualCents > CVAE_DECLARATION_THRESHOLD_CENTS
  const taxable = status === 'in-force' && input.turnoverAnnualCents > CVAE_PAYMENT_THRESHOLD_CENTS
  const cap = capValueAdded(input.valueAddedCents, input.turnoverCents)
  const valueAdded = { beforeCapCents: input.valueAddedCents, capCents: cap.capCents, capped: cap.capped, cents: cap.cents }
  const scale = CVAE_SCALES[input.year]
  if (!taxable || !scale) {
    return { year: input.year, status, declarationRequired, taxable, valueAdded, rateHundredths: 0, rateLabel: rateLabelOf(0), grossCents: 0, degrevementCents: 0, cvaeCents: 0, franchise: false, complementaryCents: 0, totalCents: 0 }
  }
  const rate = cvaeRateHundredths(input.year, input.turnoverAnnualCents)
  // rate / 100 percent = rate / 10 000 of the value added
  const grossCents = Number(divRound(big(cap.cents) * big(rate * 10), BigInt(100_000)))
  const degrevementCents = input.turnoverAnnualCents < DEGREVEMENT_TURNOVER_CENTS ? Math.min(grossCents, scale.degrevementCents) : 0
  const net = grossCents - degrevementCents
  const franchise = net > 0 && net <= CVAE_FRANCHISE_CENTS
  const cvaeCents = franchise ? 0 : net
  const complementaryCents = Number(divRound(big(cvaeCents) * big(scale.complementaryPerMille), BigInt(1000)))
  return {
    year: input.year,
    status,
    declarationRequired,
    taxable,
    valueAdded,
    rateHundredths: rate,
    rateLabel: rateLabelOf(rate),
    grossCents,
    degrevementCents,
    cvaeCents,
    franchise,
    complementaryCents,
    totalCents: cvaeCents + complementaryCents,
  }
}

/**
 * The two acomptes of `year` (1329-AC, art. 1679 septies): due when the
 * CVAE of the year before exceeds 1 500 €, each 50 % of the CVAE computed
 * at the rates of the year on the last value added declared (the year
 * before), rounded half up to the cent; the balance is paid with the
 * 1329-DEF. None after the abolition.
 */
export function cvaeAcomptes(year: number, previousCvaeCents: number | null, cvaeOnLastValueAddedCents: number | null): { due: boolean | null; eachCents: number | null } {
  if (cvaeYearStatus(year) !== 'in-force') return { due: false, eachCents: null }
  if (previousCvaeCents === null) return { due: null, eachCents: null }
  if (previousCvaeCents <= CVAE_ACOMPTE_THRESHOLD_CENTS) return { due: false, eachCents: null }
  return { due: true, eachCents: cvaeOnLastValueAddedCents === null ? null : Number(divRound(big(cvaeOnLastValueAddedCents), BigInt(2))) }
}

/**
 * Plafonnement of the CET (CFE and CVAE) in function of the value added
 * (CGI art. 1647 B sexies; BOI-IF-CFE-40-30-20-30 §190), in thousandths of
 * a percent of the value added: 1,531 % in 2024, 2026 and 2027, 1,438 % in
 * 2025 and 2028, 1,344 % in 2029, 1,25 % from 2030 (CFE alone then).
 */
export function plafonnementRate(year: number): number | null {
  if (year < 2024) return null
  if (year === 2025 || year === 2028) return 1438
  if (year === 2029) return 1344
  if (year >= 2030) return 1250
  return 1531
}

/**
 * An estimate of the dégrèvement of CFE the plafonnement could give: the
 * CET above the rate of the value added, never more than the CFE (the
 * dégrèvement applies to the CFE only, claimed with the 1327-CET-SD). The
 * contribution complémentaire of 2025 is not counted (loi n° 2025-127,
 * art. 62). Null when the CFE or the value added is unknown.
 */
export function plafonnementEstimate(year: number, cfeCents: number | null, cvaeCents: number, valueAddedCents: number | null): { rate: number; ceilingCents: number; excessCents: number } | null {
  const rate = plafonnementRate(year)
  if (rate === null || cfeCents === null || valueAddedCents === null) return null
  const ceilingCents = Number(divRound(big(Math.max(valueAddedCents, 0)) * big(rate), BigInt(100_000)))
  const excessCents = Math.min(Math.max(cfeCents + cvaeCents - ceilingCents, 0), cfeCents)
  return { rate, ceilingCents, excessCents }
}
