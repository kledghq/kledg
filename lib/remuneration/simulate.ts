/**
 * "Rémunération et dividendes": what the director-shareholder of a company
 * at the IS keeps from the year's result, paid as remuneration, as
 * dividends, or a mix (docs/remuneration-dividendes.md). An indicative
 * simulation on plain values, never advice. Pure: the page, the simple
 * home card, the routes, the exports and the MCP tool all call this
 * function, so they show the same figures.
 *
 * For a budget R (the result before the director's pay and before the IS)
 * and a part C of it spent on the remuneration (pay and contributions):
 * 1. the pay and its contributions (social-contributions.ts): assimilé
 *    salarié or travailleur non salarié;
 * 2. the company's profit R - C, its IS at 15 % up to the ceiling when
 *    eligible and 25 % above (CGI art. 219, I; lib/corporate-tax/rules.ts);
 * 3. the legal reserve on the profit after tax (C. com. L232-10;
 *    lib/accounting/result-allocation/compute.ts), the distributable profit
 *    of the year (L232-11, here without the report à nouveau of earlier
 *    years) and the share distributed;
 * 4. the director's dividends (his share of the capital), their
 *    prélèvements sociaux of 18,6 %, or, for a TNS, the social contributions
 *    on the part above 10 % of capital, premiums and current account (CSS
 *    art. L131-6);
 * 5. the household's income tax with and without this pay and these
 *    dividends (income-tax.ts): the difference is the director's; dividends
 *    at the PFU of 12,8 % or at the scale after the 40 % abatement (CGI art.
 *    158, 3, 2°) with the 6,8 % CSG deductible, the better of the two when
 *    asked.
 * The optimiser searches the part C that gives the director the highest
 * net income, from 0 to R, on a grid refined around the best point.
 */

import { taxAtRates } from '@/lib/corporate-tax/rules'
import { legalReserveFor } from '@/lib/accounting/result-allocation/compute'
import { incomeTax, mulDiv, rate, salaryAfterDeduction } from './income-tax'
import { RULES } from './rules'
import { employeePayForCost, tnsContributions, tnsPayForCost, type ContributionLine } from './social-contributions'
import type { DividendTaxation, RemunerationInputs } from './schemas'

export type ScenarioId = 'allPay' | 'allDividends' | 'mix' | 'optimum'

const SCENARIO_LABELS: Record<ScenarioId, string> = {
  allPay: 'Tout en rémunération',
  allDividends: 'Tout en dividendes',
  mix: 'Mixte',
  optimum: 'Optimum calculé',
}

export interface ScenarioResult {
  id: ScenarioId
  label: string
  /** Part of the budget spent on the remuneration, in basis points. */
  remunerationShareBp: number
  company: {
    resultBeforePayCents: number
    remunerationCostCents: number
    profitBeforeTaxCents: number
    corporateTaxCents: number
    profitAfterTaxCents: number
    legalReserveCents: number
    distributableCents: number
    dividendsCents: number
    /** What stays in the company: legal reserve and profit not distributed. */
    retainedCents: number
  }
  pay: {
    grossCents: number | null
    /** Contributions paid by the company (employer part, or all the TNS contributions). */
    employerContributionsCents: number
    /** Contributions withheld from the pay (employee part); 0 for a TNS. */
    employeeContributionsCents: number
    netCents: number
    taxableCents: number
    lines: Array<ContributionLine & { side: 'employer' | 'employee' | 'tns' }>
  }
  dividends: {
    receivedCents: number
    /** TNS: 10 % of capital held, premiums and current account (CSS art. L131-6); null for an assimilé salarié. */
    thresholdCents: number | null
    /** TNS: part above the threshold, subject to the TNS contributions instead of the prélèvements sociaux. */
    activityPartCents: number
    socialLeviesCents: number
    tnsContributionsCents: number
    taxation: 'pfu' | 'bareme'
    /** IR part of the PFU (12,8 %); 0 with the scale (the dividends are in the scale). */
    pfuCents: number
  }
  incomeTax: {
    householdWithoutCents: number
    householdWithCents: number
    /** Income tax due to this pay and these dividends (scale difference plus PFU). */
    directorCents: number
    marginalRateBp: number
    /** The other way to tax the dividends, for comparison. */
    other: { taxation: 'pfu' | 'bareme'; directorCents: number } | null
  }
  person: {
    netIncomeCents: number
    socialCents: number
    incomeTaxCents: number
  }
  /** IS, social contributions (company and director) and income tax of the scenario. */
  leviesCents: number
}

export interface CurvePoint {
  remunerationShareBp: number
  remunerationCostCents: number
  netIncomeCents: number
}

export interface Simulation {
  inputs: RemunerationInputs
  scenarios: Record<ScenarioId, ScenarioResult>
  curve: CurvePoint[]
  notes: string[]
}

/** Income tax of the household for a given remuneration and dividends, the dividends at the PFU or at the scale. */
function householdTax(inputs: RemunerationInputs, payTaxableCents: number, dividendCents: number, leviedCents: number, taxation: 'pfu' | 'bareme') {
  const pay = salaryAfterDeduction(payTaxableCents)
  if (taxation === 'pfu') {
    const scale = incomeTax(inputs.otherIncomeCents + pay, inputs.householdParts)
    return { scaleCents: scale.taxCents, pfuCents: rate(dividendCents, RULES.dividends.pfuIncomeTaxBp), marginalRateBp: scale.marginalRateBp }
  }
  const dividends = dividendCents - rate(dividendCents, RULES.dividends.abatementBp)
  const deductibleCsg = rate(leviedCents, RULES.dividends.deductibleCsgBp)
  const scale = incomeTax(Math.max(inputs.otherIncomeCents + pay + dividends - deductibleCsg, 0), inputs.householdParts)
  return { scaleCents: scale.taxCents, pfuCents: 0, marginalRateBp: scale.marginalRateBp }
}

/** One scenario: `costCents` of the budget spent on the remuneration. */
export function simulateScenario(inputs: RemunerationInputs, costCents: number, id: ScenarioId = 'mix'): ScenarioResult {
  const budget = inputs.resultBeforePayCents
  const cost = Math.min(Math.max(costCents, 0), Math.max(budget, 0))

  // 1. Pay
  const tns = inputs.status === 'tns'
  const employee = tns ? null : employeePayForCost(cost)
  const tnsPay = tns ? tnsPayForCost(cost) : null
  const pay: ScenarioResult['pay'] = employee
    ? {
        grossCents: employee.grossCents,
        employerContributionsCents: employee.employerCents,
        employeeContributionsCents: employee.employeeCents,
        netCents: employee.netCents,
        taxableCents: employee.grossCents > 0 ? employee.taxableCents : 0,
        lines: [...employee.employer.map((l) => ({ ...l, side: 'employer' as const })), ...employee.employee.map((l) => ({ ...l, side: 'employee' as const }))],
      }
    : {
        grossCents: null,
        employerContributionsCents: (tnsPay as NonNullable<typeof tnsPay>).contributions.totalCents,
        employeeContributionsCents: 0,
        netCents: (tnsPay as NonNullable<typeof tnsPay>).netCents,
        taxableCents: (tnsPay as NonNullable<typeof tnsPay>).taxableCents,
        lines: (tnsPay as NonNullable<typeof tnsPay>).contributions.lines.map((l) => ({ ...l, side: 'tns' as const })),
      }
  // The company spends the budget part; a TNS whose minimum contributions exceed it pays the rest himself.
  const remunerationCost = cost

  // 2. Company and IS
  const profitBeforeTax = budget - remunerationCost
  const corporateTax = taxAtRates(profitBeforeTax, inputs.reducedRate, inputs.reducedRateCeilingCents).taxCents
  const profitAfterTax = profitBeforeTax - corporateTax

  // 3. Legal reserve and dividends
  const legalReserve =
    inputs.legalReserveRequired && profitAfterTax > 0
      ? legalReserveFor({ resultCents: profitAfterTax, legalReserveCents: inputs.legalReserveCents, capitalCents: inputs.capitalCents, retainedEarningsCents: 0, priorLossesCents: inputs.priorLossesCents })
      : 0
  const distributable = Math.max(profitAfterTax - inputs.priorLossesCents - legalReserve, 0)
  const dividends = Math.floor((distributable * inputs.distributionBp) / 10_000)
  const received = Math.floor((dividends * inputs.shareBp) / 10_000)

  // 4. Social levies on the dividends
  let threshold: number | null = null
  let activityPart = 0
  let tnsOnDividends = 0
  if (tns) {
    const capitalHeld = mulDiv(inputs.capitalCents, inputs.shareBp, 10_000)
    threshold = rate(capitalHeld + inputs.premiumsCents + inputs.currentAccountCents, RULES.dividends.tnsThresholdBp)
    activityPart = Math.max(received - threshold, 0)
    if (activityPart > 0) tnsOnDividends = tnsContributions(cost + activityPart).totalCents - tnsContributions(cost).totalCents
  }
  const levied = received - activityPart
  const socialLevies = rate(levied, RULES.dividends.socialLeviesBp)

  // 5. Income tax
  const without = incomeTax(inputs.otherIncomeCents, inputs.householdParts).taxCents
  const options = (['pfu', 'bareme'] as const).map((taxation) => {
    const t = householdTax(inputs, pay.taxableCents, received, levied, taxation)
    return { taxation, withCents: t.scaleCents + t.pfuCents, scaleCents: t.scaleCents, pfuCents: t.pfuCents, marginalRateBp: t.marginalRateBp }
  })
  const choice: DividendTaxation = inputs.dividendTaxation
  const chosen =
    choice === 'best' ? (options[1].withCents < options[0].withCents ? options[1] : options[0]) : options.find((o) => o.taxation === choice) ?? options[0]
  const other = received > 0 ? options.find((o) => o.taxation !== chosen.taxation) ?? null : null
  const directorTax = chosen.withCents - without

  const social = pay.employerContributionsCents + pay.employeeContributionsCents + socialLevies + tnsOnDividends
  const net = pay.netCents + received - socialLevies - tnsOnDividends - directorTax
  return {
    id,
    label: SCENARIO_LABELS[id],
    remunerationShareBp: budget > 0 ? mulDiv(cost, 10_000, budget) : 0,
    company: {
      resultBeforePayCents: budget,
      remunerationCostCents: remunerationCost,
      profitBeforeTaxCents: profitBeforeTax,
      corporateTaxCents: corporateTax,
      profitAfterTaxCents: profitAfterTax,
      legalReserveCents: legalReserve,
      distributableCents: distributable,
      dividendsCents: dividends,
      retainedCents: profitAfterTax - dividends,
    },
    pay,
    dividends: {
      receivedCents: received,
      thresholdCents: threshold,
      activityPartCents: activityPart,
      socialLeviesCents: socialLevies,
      tnsContributionsCents: tnsOnDividends,
      taxation: chosen.taxation,
      pfuCents: chosen.pfuCents,
    },
    incomeTax: {
      householdWithoutCents: without,
      householdWithCents: chosen.withCents,
      directorCents: directorTax,
      marginalRateBp: chosen.marginalRateBp,
      other: other ? { taxation: other.taxation, directorCents: other.withCents - without } : null,
    },
    person: { netIncomeCents: net, socialCents: social, incomeTaxCents: directorTax },
    leviesCents: corporateTax + social + directorTax,
  }
}

const GRID_STEPS = 100
const MIN_STEP_CENTS = 100

/**
 * The remuneration cost, from 0 to the budget, that gives the director the
 * highest net income: a grid over the whole range, then finer grids around
 * the best point until the step is one euro. Rounded to the euro. On equal
 * net income, the lower cost wins (more stays in the company).
 */
export function optimalCost(inputs: RemunerationInputs): number {
  const budget = Math.max(inputs.resultBeforePayCents, 0)
  if (budget === 0) return 0
  const net = (cost: number) => simulateScenario(inputs, cost).person.netIncomeCents
  let low = 0
  let high = budget
  let best = 0
  let bestNet = net(0)
  for (;;) {
    const step = Math.max(Math.floor((high - low) / GRID_STEPS), 1)
    for (let cost = low; cost <= high; cost += step) {
      const value = net(cost)
      if (value > bestNet) {
        best = cost
        bestNet = value
      }
    }
    const value = net(high)
    if (value > bestNet) {
      best = high
      bestNet = value
    }
    if (step <= MIN_STEP_CENTS) break
    low = Math.max(best - step, 0)
    high = Math.min(best + step, budget)
  }
  const rounded = Math.min(Math.round(best / 100) * 100, budget)
  return net(rounded) >= bestNet ? rounded : best
}

const CURVE_POINTS = 20

export function simulate(inputs: RemunerationInputs): Simulation {
  const budget = Math.max(inputs.resultBeforePayCents, 0)
  const scenarios: Record<ScenarioId, ScenarioResult> = {
    allPay: simulateScenario(inputs, budget, 'allPay'),
    allDividends: simulateScenario(inputs, 0, 'allDividends'),
    mix: simulateScenario(inputs, mulDiv(budget, inputs.mixBp, 10_000), 'mix'),
    optimum: simulateScenario(inputs, optimalCost(inputs), 'optimum'),
  }
  const curve: CurvePoint[] = []
  for (let i = 0; i <= CURVE_POINTS; i++) {
    const cost = mulDiv(budget, i, CURVE_POINTS)
    curve.push({ remunerationShareBp: (i * 10_000) / CURVE_POINTS, remunerationCostCents: cost, netIncomeCents: simulateScenario(inputs, cost).person.netIncomeCents })
  }
  return { inputs, scenarios, curve, notes: simulationNotes(inputs, scenarios) }
}

/** Plain French notes on what the figures of this simulation leave out. */
function simulationNotes(inputs: RemunerationInputs, scenarios: Record<ScenarioId, ScenarioResult>): string[] {
  const notes: string[] = []
  if (inputs.resultBeforePayCents <= 0) notes.push('Le résultat avant rémunération est nul ou négatif : il n’y a rien à verser, ni rémunération ni dividendes.')
  if (inputs.status === 'assimile' && scenarios.optimum.pay.grossCents !== null && scenarios.optimum.pay.grossCents === 0) {
    notes.push('Sans rémunération, un assimilé salarié ne valide pas de trimestres de retraite et n’a pas d’indemnités journalières : les dividendes ne donnent aucun droit social.')
  }
  if (inputs.status === 'tns') {
    notes.push('Gérant non salarié : les cotisations minimales restent dues même sans rémunération, et la part des dividendes au-delà de 10 % du capital, des primes et du compte courant supporte les cotisations sociales (CSS, art. L131-6).')
  }
  if (inputs.shareBp < 10_000) notes.push('Les dividendes versés aux autres associés sortent aussi de la société : l’optimum ne regarde que votre revenu.')
  const highest = Math.max(...Object.values(scenarios).map((s) => s.incomeTax.householdWithCents))
  if (highest > 0 && inputs.otherIncomeCents + Math.max(...Object.values(scenarios).map((s) => s.pay.taxableCents + s.dividends.receivedCents)) > 25_000_000) {
    notes.push('Au-delà de 250 000 € de revenu fiscal de référence (500 000 € pour un couple), la contribution exceptionnelle sur les hauts revenus s’ajoute : elle n’est pas simulée.')
  }
  if (inputs.dividendTaxation !== 'pfu') notes.push('L’option pour le barème est globale : elle vaut pour tous les revenus de capitaux mobiliers et plus-values du foyer de l’année (CGI, art. 200 A, 2).')
  return notes
}
