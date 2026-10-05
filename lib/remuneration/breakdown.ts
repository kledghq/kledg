/**
 * The comparison table of the scenarios, one row per figure, in the order
 * the page, the PDF and the CSV show it (docs/remuneration-dividendes.md).
 * Pure: built from the simulation, so every output shows the same figures.
 */

import type { ScenarioId, ScenarioResult, Simulation } from './simulate'

export const SCENARIO_ORDER: readonly ScenarioId[] = ['allPay', 'allDividends', 'mix', 'optimum']

export interface BreakdownRow {
  id: string
  label: string
  /** Rows of a total or the headline figure. */
  strong?: boolean
  /** Section heading of the row. */
  section: 'company' | 'pay' | 'dividends' | 'tax' | 'result'
  values: Record<ScenarioId, number>
}

const row = (id: string, label: string, section: BreakdownRow['section'], value: (s: ScenarioResult) => number, strong = false) => ({ id, label, section, value, strong })

const ROWS = [
  row('result', 'Résultat avant rémunération', 'company', (s) => s.company.resultBeforePayCents),
  row('cost', 'Coût de la rémunération pour la société', 'company', (s) => s.company.remunerationCostCents),
  row('profit', 'Bénéfice avant impôt', 'company', (s) => s.company.profitBeforeTaxCents),
  row('is', 'Impôt sur les sociétés', 'company', (s) => s.company.corporateTaxCents),
  row('reserve', 'Réserve légale', 'company', (s) => s.company.legalReserveCents),
  row('dividends', 'Dividendes distribués (tous les associés)', 'company', (s) => s.company.dividendsCents),
  row('retained', 'Reste dans la société', 'company', (s) => s.company.retainedCents),
  row('gross', 'Rémunération brute', 'pay', (s) => s.pay.grossCents ?? s.company.remunerationCostCents),
  row('employer', 'Cotisations payées par la société', 'pay', (s) => s.pay.employerContributionsCents),
  row('employee', 'Cotisations retenues sur la paie', 'pay', (s) => s.pay.employeeContributionsCents),
  row('net-pay', 'Rémunération nette', 'pay', (s) => s.pay.netCents),
  row('received', 'Dividendes reçus', 'dividends', (s) => s.dividends.receivedCents),
  row('levies', 'Prélèvements sociaux (18,6 %)', 'dividends', (s) => s.dividends.socialLeviesCents),
  row('tns-dividends', 'Cotisations sur la part des dividendes au-delà de 10 %', 'dividends', (s) => s.dividends.tnsContributionsCents),
  row('ir', 'Impôt sur le revenu dû à ces revenus', 'tax', (s) => s.person.incomeTaxCents),
  row('net', 'Net pour vous, après impôt', 'result', (s) => s.person.netIncomeCents, true),
  row('total-levies', 'Total des impôts et cotisations', 'result', (s) => s.leviesCents, true),
]

export function breakdownRows(simulation: Simulation): BreakdownRow[] {
  return ROWS.map((r) => ({
    id: r.id,
    label: r.label,
    section: r.section,
    strong: r.strong || undefined,
    values: Object.fromEntries(SCENARIO_ORDER.map((id) => [id, r.value(simulation.scenarios[id])])) as Record<ScenarioId, number>,
  }))
}

export const TAXATION_LABELS = { pfu: 'Prélèvement forfaitaire unique (31,4 %)', bareme: 'Barème progressif après abattement de 40 %' } as const

export const STATUS_LABELS = { assimile: 'Assimilé salarié', tns: 'Travailleur non salarié (gérant majoritaire)' } as const

/** The warning every output carries: a simulation, not advice. */
export const DISCLAIMER =
  'Simulation indicative, pas un conseil : taux et barèmes connus au 5 octobre 2026, cotisations approchées, situation du foyer simplifiée. Faites valider votre choix par votre expert-comptable avant de décider.'
