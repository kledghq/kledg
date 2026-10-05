/**
 * The bilan pédagogique et financier of a closed fiscal year (Code du
 * travail L6352-11, R6352-22; cerfa 10443*17, notice 50199#17), computed
 * from plain values. Pure.
 *
 * Frame C, origin of the products excluding tax: every revenue line (70 and
 * 74 accounts) of the fiscal year goes to a line of the form, in this order:
 * 1. the origin of its customer (Tiers.trainingOrigin), when the entry names
 *    one customer on a 41 account;
 * 2. the origin of its account or of its longest root
 *    (revenue_account_settings.trainingOrigin);
 * 3. else "to assign": shown apart, never guessed.
 * Amounts are rounded to the euro per line (notice: "en euros, arrondis à
 * l'euro le plus proche"); line 2 is the total of a to h; the total adds
 * lines 1 to 11. The share of the global turnover realised in vocational
 * training is a whole percent, 1 % when below 1 % with some activity
 * (notice); Kledg rounds to the nearest percent (the notice gives no
 * rounding mode) and takes the 70 accounts as the global turnover.
 *
 * Frame D: total charges of the training activity, of which trainers'
 * salaries (account 6411 per the notice) and purchases of training and
 * training fees (604 and 6226 per the notice). Read from the books (class 6
 * without 69 for the total) unless the user entered the figure: the books
 * cannot tell which charges belong to the training activity.
 */

import { settingFor } from '@/lib/vat-deduction/revenue'
import { OPCO_ORIGINS, TRAINING_ORIGINS, type TrainingOrigin } from './origins'
import type { CountHours, TrainingReportData } from './schemas'

export interface RevenueByTiersRow {
  code: string
  label: string
  /** Auxiliary account of the one customer of the entry, null when none or several. */
  auxiliary: string | null
  cents: number
}

export interface OriginInputs {
  tiers: ReadonlyArray<{ id: string; name: string; auxiliaryAccountNumber: string; trainingOrigin: TrainingOrigin | null }>
  accounts: ReadonlyArray<{ accountCode: string; trainingOrigin: TrainingOrigin | null }>
}

export type AssignmentSource = 'tiers' | 'account' | 'unassigned'

export interface AssignedRevenue {
  code: string
  label: string
  tiers: { id: string; name: string } | null
  cents: number
  origin: TrainingOrigin | null
  source: AssignmentSource
}

export interface FrameCLine {
  code: TrainingOrigin
  line: string
  label: string
  cents: number
  euros: number
}

export interface FrameC {
  lines: FrameCLine[]
  /** Line 2: total of a to h. */
  opcoTotalEuros: number
  /** Total of lines 1 to 11. */
  totalEuros: number
  /** Revenue outside vocational training ("none"). */
  outsideEuros: number
  unassignedCents: number
  /** Share of the global turnover realised in vocational training, whole percent; null without turnover. */
  sharePercent: number | null
}

/** Cents to the nearest euro, half away from zero. */
export const toEuros = (cents: number) => Math.sign(cents) * Math.floor((Math.abs(cents) + 50) / 100)

export function assignRevenue(rows: readonly RevenueByTiersRow[], inputs: OriginInputs): AssignedRevenue[] {
  const byAux = new Map(inputs.tiers.map((t) => [t.auxiliaryAccountNumber, t]))
  const settings = inputs.accounts.filter((a) => a.trainingOrigin !== null)
  return rows.map((row) => {
    const tiers = row.auxiliary ? (byAux.get(row.auxiliary) ?? null) : null
    const base = { code: row.code, label: row.label, tiers: tiers ? { id: tiers.id, name: tiers.name } : null, cents: row.cents }
    if (tiers?.trainingOrigin) return { ...base, origin: tiers.trainingOrigin, source: 'tiers' as const }
    const setting = settingFor(row.code, settings)
    if (setting?.trainingOrigin) return { ...base, origin: setting.trainingOrigin, source: 'account' as const }
    return { ...base, origin: null, source: 'unassigned' as const }
  })
}

export function frameC(assigned: readonly AssignedRevenue[], turnoverCents: number): FrameC {
  const cents = new Map<TrainingOrigin, number>()
  let unassignedCents = 0
  for (const a of assigned) {
    if (a.origin === null) unassignedCents += a.cents
    else cents.set(a.origin, (cents.get(a.origin) ?? 0) + a.cents)
  }
  const lines = TRAINING_ORIGINS.filter((o) => o.code !== 'none').map((o) => {
    const c = cents.get(o.code) ?? 0
    return { code: o.code, line: o.line, label: o.label, cents: c, euros: toEuros(c) }
  })
  const opcoTotalEuros = lines.filter((l) => OPCO_ORIGINS.includes(l.code)).reduce((s, l) => s + l.euros, 0)
  const totalEuros = lines.reduce((s, l) => s + l.euros, 0)
  const totalCents = lines.reduce((s, l) => s + l.cents, 0)
  let sharePercent: number | null = null
  if (turnoverCents > 0) {
    const exact = Math.floor((Math.max(totalCents, 0) * 200 + turnoverCents) / (turnoverCents * 2))
    sharePercent = totalCents > 0 && exact < 1 ? 1 : Math.min(exact, 100)
  }
  return { lines, opcoTotalEuros, totalEuros, outsideEuros: toEuros(cents.get('none') ?? 0), unassignedCents, sharePercent }
}

export interface ChargesFromBooks {
  totalCents: number
  trainerSalariesCents: number
  trainingPurchasesCents: number
}

export interface FrameD {
  total: { euros: number; source: 'books' | 'entered' }
  trainerSalaries: { euros: number; source: 'books' | 'entered' }
  trainingPurchases: { euros: number; source: 'books' | 'entered' }
}

export function frameD(books: ChargesFromBooks, entered: TrainingReportData['charges']): FrameD {
  const pick = (value: number | null, fallback: number) => ({ euros: toEuros(value ?? fallback), source: value === null ? ('books' as const) : ('entered' as const) })
  return {
    total: pick(entered.totalCents, books.totalCents),
    trainerSalaries: pick(entered.trainerSalariesCents, books.trainerSalariesCents),
    trainingPurchases: pick(entered.trainingPurchasesCents, books.trainingPurchasesCents),
  }
}

const add = (...pairs: CountHours[]): CountHours => pairs.reduce((s, p) => ({ count: s.count + p.count, hours: s.hours + p.hours }), { count: 0, hours: 0 })

export interface PedagogicalTotals {
  /** F-1 total (1). */
  trainees: CountHours
  /** F-3 total (3). */
  objectives: CountHours
  /** F-4 total (4). */
  specialities: CountHours
}

export function pedagogicalTotals(data: TrainingReportData): PedagogicalTotals {
  const t = data.trainees
  const o = data.objectives
  return {
    trainees: add(t.employees, t.apprentices, t.jobSeekers, t.individuals, t.others),
    objectives: add(o.rncp, o.rs, o.cqpNotRegistered, o.other, o.skillsAssessment, o.vae),
    specialities: add(...data.specialities.map((s) => ({ count: s.count, hours: s.hours })), data.otherSpecialities),
  }
}

/** Consistency checks of the notice, in French, empty when everything holds. */
export function trainingReportChecks(data: TrainingReportData, c: FrameC, unassignedTiers: number): string[] {
  const totals = pedagogicalTotals(data)
  const checks: string[] = []
  const same = (a: CountHours, b: CountHours) => a.count === b.count && a.hours === b.hours
  if (!same(totals.trainees, totals.objectives)) {
    checks.push('Le total du cadre F-3 (objectif des prestations) doit être égal au total du cadre F-1 (type de stagiaires), en nombre et en heures.')
  }
  if (!same(totals.trainees, totals.specialities)) {
    checks.push('Le total du cadre F-4 (spécialités) doit être égal au total du cadre F-1, en nombre et en heures.')
  }
  const levels = add(data.objectives.rncpLevel6to8, data.objectives.rncpLevel5, data.objectives.rncpLevel4, data.objectives.rncpLevel3, data.objectives.rncpLevel2, data.objectives.rncpCqpWithoutLevel)
  if (levels.count > data.objectives.rncp.count || levels.hours > data.objectives.rncp.hours) {
    checks.push('Les formations RNCP par niveau (« dont ») ne peuvent pas dépasser la ligne a du cadre F-3.')
  }
  if (data.subcontracted.count > totals.trainees.count) checks.push('Les stagiaires confiés à un autre organisme (F-2) font partie du total F-1 : ils ne peuvent pas le dépasser.')
  if (c.unassignedCents !== 0) {
    checks.push(`${unassignedTiers > 0 ? `${unassignedTiers} client(s) et des comptes` : 'Des recettes'} n’ont pas d’origine : affectez chaque compte de produits ou chaque client à une ligne du cadre C.`)
  }
  if (c.lines.find((l) => l.code === 'c10')!.cents > 0 && data.entrusted.count === 0) {
    checks.push('Des produits viennent d’autres organismes de formation (ligne 10) : indiquez les stagiaires correspondants au cadre G.')
  }
  return checks
}
