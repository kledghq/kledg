/**
 * Amounts of an expense report in integer cents. Pure module (it imports
 * only pure modules): the line editor (live totals) and the server (stored
 * amounts, posting) run the same code, so what the user sees is what Kledg
 * records.
 *
 * - An expense line carries the amount paid (TTC) and the VAT shown on the
 *   receipt at one rate (a receipt with two rates is two lines). The VAT
 *   typed may differ from TTC x rate / (1 + rate) by rounding per item on
 *   the receipt, 2 cents at most; empty, it is computed.
 * - The recoverable part of that VAT follows vat-recovery.ts, then, for a
 *   partly exempt company, its coefficient de déduction on the day of the
 *   expense (CGI ann. II art. 205 and 206; lib/vat-deduction/coefficient.ts,
 *   as purchase invoices, simple mode and rules apply it), rounded half up
 *   as lib/invoices/posting-plan.ts does; the charge of the line is TTC
 *   minus the recoverable VAT: VAT the company cannot recover is part of
 *   what the expense costs it.
 * - A mileage line is paid by the scale (mileage-scale.ts), without VAT.
 * - The report owes the claimant the sum of the TTC amounts; its charges
 *   and its recoverable VAT add up to that sum to the cent.
 */

import { type ExpenseCategory } from './categories'
import { mileageAllowance, type VehicleType } from './mileage-scale'
import { formatCentsFr } from '@/lib/utils/money'
import { recoverableVat, vatIncludedCents, VAT_TOLERANCE_CENTS, type ReceiptKind, type RecoveryReason } from './vat-recovery'

export interface LineInput {
  kind: 'EXPENSE' | 'MILEAGE'
  /** yyyy-mm-dd */
  date: string
  category: ExpenseCategory
  /** Expense: amount paid, VAT included. Ignored for mileage. */
  amountInclTaxCents: number
  vatRateBp: number
  /** VAT shown on the receipt; null: computed from the TTC and the rate. */
  vatCents: number | null
  receiptKind: ReceiptKind
  vehicleType?: VehicleType | null
  fiscalPower?: number | null
  electric?: boolean
  distanceKm?: number | null
  /** Distance of the same vehicle already counted in the year before this trip (assignPriorDistances). */
  priorDistanceKm?: number | null
  /**
   * Provisional coefficient de déduction of the company on the line's day,
   * in whole percent (lib/vat-deduction/coefficient.ts); null or absent:
   * the company deducts all of its VAT.
   */
  deductionPercent?: number | null
  /** The company is under the franchise on the line's day (CGI art. 293 B): nothing recovered. */
  franchise?: boolean
}

export interface ComputedLine {
  amountInclTaxCents: number
  vatCents: number
  recoverableVatCents: number
  /** Charge of the line: TTC minus the recoverable VAT. */
  expenseCents: number
  reason: RecoveryReason
  /** Mileage: the scale year and power class applied. */
  scaleYear: number | null
  powerClass: string | null
  /** French problem with the line, when it cannot be recorded as is. */
  error: string | null
}

export interface ReportTotals {
  lines: ComputedLine[]
  /** What the company owes the claimant. */
  totalInclTaxCents: number
  recoverableVatCents: number
  totalExpenseCents: number
  /** Recoverable VAT per rate, highest rate first (one 44566 line each). */
  vatByRate: Array<{ vatRateBp: number; recoverableVatCents: number }>
}

const yearOf = (day: string) => Number(day.slice(0, 4))

/** n x percent / 100 rounded half up, n >= 0 (the deductible share of lib/invoices/posting-plan.ts). */
function percentHalfUp(n: number, percent: number): number {
  return Math.floor((n * Math.max(0, Math.min(percent, 100)) * 2 + 100) / 200)
}

export function computeLine(line: LineInput, company: { vatExempt: boolean }): ComputedLine {
  if (line.kind === 'MILEAGE') {
    const result = mileageAllowance({
      year: yearOf(line.date),
      vehicle: line.vehicleType ?? 'CAR',
      fiscalPower: line.fiscalPower ?? 0,
      electric: line.electric ?? false,
      distanceKm: line.distanceKm ?? 0,
      priorDistanceKm: line.priorDistanceKm ?? 0,
    })
    if (!result.ok) {
      return { amountInclTaxCents: 0, vatCents: 0, recoverableVatCents: 0, expenseCents: 0, reason: 'no-vat', scaleYear: null, powerClass: null, error: result.error }
    }
    return {
      amountInclTaxCents: result.amountCents,
      vatCents: 0,
      recoverableVatCents: 0,
      expenseCents: result.amountCents,
      reason: 'no-vat',
      scaleYear: result.scale.year,
      powerClass: result.powerClass,
      error: null,
    }
  }
  const amount = Math.max(0, line.amountInclTaxCents)
  const computed = vatIncludedCents(amount, line.vatRateBp)
  const vat = line.vatCents ?? computed
  let error: string | null = null
  if (vat > amount) error = 'La TVA dépasse le montant payé.'
  else if (line.vatRateBp === 0 && vat !== 0) error = 'Une dépense sans taux de TVA n’a pas de TVA.'
  else if (Math.abs(vat - computed) > VAT_TOLERANCE_CENTS) {
    error = `La TVA ne correspond pas au taux\u00a0: environ ${formatCentsFr(computed)} pour ce montant. Une note à deux taux se saisit sur deux lignes.`
  }
  const recovery = recoverableVat({ category: line.category, receiptKind: line.receiptKind, amountInclTaxCents: amount, vatCents: error ? 0 : vat, vatExempt: company.vatExempt || line.franchise === true })
  const coefficient = line.deductionPercent ?? null
  const partial = coefficient !== null && coefficient < 100 && recovery.recoverableVatCents > 0
  const recoverableVatCents = partial ? percentHalfUp(recovery.recoverableVatCents, coefficient) : recovery.recoverableVatCents
  return {
    amountInclTaxCents: amount,
    vatCents: error ? 0 : vat,
    recoverableVatCents,
    expenseCents: amount - recoverableVatCents,
    reason: partial ? 'coefficient' : recovery.reason,
    scaleYear: null,
    powerClass: null,
    error,
  }
}

export function computeReport(lines: readonly LineInput[], company: { vatExempt: boolean }): ReportTotals {
  const computed = lines.map((line) => computeLine(line, company))
  const byRate = new Map<number, number>()
  computed.forEach((line, i) => {
    if (line.recoverableVatCents > 0) byRate.set(lines[i].vatRateBp, (byRate.get(lines[i].vatRateBp) ?? 0) + line.recoverableVatCents)
  })
  const totalInclTaxCents = computed.reduce((sum, l) => sum + l.amountInclTaxCents, 0)
  const recoverableVatCents = computed.reduce((sum, l) => sum + l.recoverableVatCents, 0)
  return {
    lines: computed,
    totalInclTaxCents,
    recoverableVatCents,
    totalExpenseCents: totalInclTaxCents - recoverableVatCents,
    vatByRate: [...byRate.entries()].sort(([a], [b]) => b - a).map(([vatRateBp, cents]) => ({ vatRateBp, recoverableVatCents: cents })),
  }
}

/** Key of a vehicle in a year: the annual bands are counted per vehicle. */
export function vehicleKey(line: Pick<LineInput, 'date' | 'vehicleType' | 'fiscalPower' | 'electric'>): string {
  return `${yearOf(line.date)}:${line.vehicleType ?? 'CAR'}:${line.vehicleType === 'MOPED' ? 0 : (line.fiscalPower ?? 0)}:${line.electric ? 'e' : 't'}`
}

/**
 * Sets priorDistanceKm on the mileage lines of a report: the distance of the
 * same vehicle and year counted before (`baselines`, from the claimant's
 * other submitted reports), plus the earlier trips of this report (by date,
 * then by position). Returns new line objects.
 */
export function assignPriorDistances<T extends LineInput>(lines: readonly T[], baselines: Readonly<Record<string, number>>): T[] {
  const order = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.kind === 'MILEAGE')
    .sort((a, b) => a.line.date.localeCompare(b.line.date) || a.index - b.index)
  const running = new Map<string, number>()
  const prior = new Map<number, number>()
  for (const { line, index } of order) {
    const key = vehicleKey(line)
    const before = running.get(key) ?? baselines[key] ?? 0
    prior.set(index, before)
    running.set(key, before + Math.max(0, line.distanceKm ?? 0))
  }
  return lines.map((line, index) => (prior.has(index) ? { ...line, priorDistanceKm: prior.get(index) as number } : line))
}

