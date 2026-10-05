/**
 * Social contributions on the director's pay, approximated for the
 * remuneration simulator (docs/remuneration-dividendes.md). Pure.
 *
 * Assimilé salarié: each contribution of RULES.employee on its base (the
 * whole gross pay, T1 up to 1 PASS, T2 from 1 to 8 PASS, CSG and CRDS on
 * 98,25 % of the gross pay up to 4 PASS). The company spends the gross pay
 * plus the employer contributions; the director receives the gross pay
 * minus the employee contributions. A budget is turned into a gross pay by
 * searching the gross pay whose cost fits it (the cost grows with the pay).
 *
 * Travailleur non salarié: the assiette unique (LFSS 2024 art. 18; décret
 * n° 2024-688): the base is the income before social contributions, here
 * the whole budget the company spends on the gérant (pay plus the
 * contributions it pays for him), less 26 % within 1,76 % and 130 % of the
 * PASS. The contributions of RULES.tns apply to that base, with their
 * minimum bases; the pay is the budget less the contributions. Below the
 * minimum contributions the pay is negative: the gérant owes them anyway.
 *
 * Approximations, stated on the page: no réduction générale, AT/MP at an
 * indicative rate, prévoyance of the cadres included, no mutuelle, no
 * provisional instalments of the TNS (only the regularised year).
 */

import { mulDiv, rate } from './income-tax'
import { PASS_CENTS, RULES, type ContributionBase } from './rules'

export interface ContributionLine {
  id: string
  label: string
  baseCents: number
  cents: number
}

const passShare = (bp: number) => mulDiv(PASS_CENTS, bp, 10_000)

function baseOf(kind: ContributionBase, gross: number): number {
  const t1 = Math.min(gross, PASS_CENTS)
  switch (kind) {
    case 'total':
      return gross
    case 't1':
      return t1
    case 't2':
      return Math.max(Math.min(gross, 8 * PASS_CENTS) - PASS_CENTS, 0)
    case 'cet':
      // CET: on the whole pay up to 8 PASS, only when it exceeds 1 PASS.
      return gross > PASS_CENTS ? Math.min(gross, 8 * PASS_CENTS) : 0
    case 'apec':
      return Math.min(gross, 4 * PASS_CENTS)
    case 'csg': {
      const ceiling = RULES.employee.csgAbatementCeilingPass * PASS_CENTS
      const abated = Math.min(gross, ceiling)
      return abated - rate(abated, RULES.employee.csgAbatementBp) + Math.max(gross - ceiling, 0)
    }
  }
}

export interface EmployeePay {
  grossCents: number
  employer: ContributionLine[]
  employee: ContributionLine[]
  employerCents: number
  employeeCents: number
  /** What the company spends: gross pay and employer contributions. */
  costCents: number
  /** Net pay before income tax. */
  netCents: number
  /** Net taxable pay: net pay plus the CSG and CRDS that are not deductible. */
  taxableCents: number
}

/** Contributions of an assimilé salarié on a gross pay. */
export function employeePay(grossCents: number): EmployeePay {
  const gross = Math.max(grossCents, 0)
  const lines = (list: ReadonlyArray<{ id: string; label: string; base: ContributionBase; rateBp: number }>) =>
    list.map((c) => {
      const base = baseOf(c.base, gross)
      return { id: c.id, label: c.label, baseCents: base, cents: rate(base, c.rateBp) }
    })
  const employer = lines(RULES.employee.employer)
  const employee = lines(RULES.employee.employee)
  const employerCents = employer.reduce((s, l) => s + l.cents, 0)
  const employeeCents = employee.reduce((s, l) => s + l.cents, 0)
  const netCents = gross - employeeCents
  const nonDeductible = employee.find((l) => l.id === 'csg-crds')?.cents ?? 0
  return { grossCents: gross, employer, employee, employerCents, employeeCents, costCents: gross + employerCents, netCents, taxableCents: netCents + nonDeductible }
}

/** The largest gross pay whose cost for the company does not exceed `costCents` (binary search, the cost grows with the pay). */
export function employeePayForCost(costCents: number): EmployeePay {
  if (costCents <= 0) return employeePay(0)
  let low = 0
  let high = costCents
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (employeePay(mid).costCents <= costCents) low = mid
    else high = mid - 1
  }
  return employeePay(low)
}

export interface TnsContributions {
  /** Income before social contributions (the budget, plus dividends taxed as activity income). */
  incomeCents: number
  abatementCents: number
  /** Assiette unique: income less the abatement. */
  baseCents: number
  lines: ContributionLine[]
  totalCents: number
  /** CSG and CRDS not deductible from the taxable income. */
  nonDeductibleCents: number
}

/** Rate on the whole base by linear interpolation between points (share of PASS in bp, rate in bp). */
function interpolatedRate(base: number, points: ReadonlyArray<readonly [number, number]>): number {
  const share = mulDiv(base, 10_000, PASS_CENTS)
  if (share <= points[0][0]) return points[0][1]
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]
    const [x1, y1] = points[i]
    if (share <= x1) return y0 + ((y1 - y0) * (share - x0)) / (x1 - x0)
  }
  return points[points.length - 1][1]
}

/** Contributions of a travailleur non salarié on an income before social contributions. */
export function tnsContributions(incomeCents: number): TnsContributions {
  const t = RULES.tns
  const income = Math.max(incomeCents, 0)
  const abatement = income === 0 ? 0 : Math.min(Math.max(rate(income, t.abatementBp), passShare(t.abatementMinPassBp)), passShare(t.abatementMaxPassBp))
  const base = Math.max(income - abatement, 0)
  const lines: ContributionLine[] = []
  const add = (id: string, label: string, baseCents: number, cents: number) => lines.push({ id, label, baseCents, cents })

  const sicknessCeiling = t.sicknessCeilingPass * PASS_CENTS
  const sicknessBelow = Math.min(base, sicknessCeiling)
  const sicknessRate = base >= sicknessCeiling ? t.sicknessPoints[t.sicknessPoints.length - 1][1] : interpolatedRate(base, t.sicknessPoints)
  add('maladie', 'Maladie-maternité', base, Math.round((sicknessBelow * sicknessRate) / 10_000) + rate(Math.max(base - sicknessCeiling, 0), t.sicknessAboveRateBp))
  const daily = Math.min(Math.max(base, passShare(t.dailyAllowanceMinPassBp)), t.dailyAllowanceCeilingPass * PASS_CENTS)
  add('indemnites-journalieres', 'Indemnités journalières', daily, rate(daily, t.dailyAllowanceBp))
  const pensionBase = Math.max(base, passShare(t.basicPensionMinPassBp))
  add('retraite-base', 'Retraite de base', pensionBase, rate(Math.min(pensionBase, PASS_CENTS), t.basicPensionT1Bp) + rate(pensionBase, t.basicPensionTotalBp))
  const complementary = Math.min(base, t.complementaryCeilingPass * PASS_CENTS)
  add('retraite-complementaire', 'Retraite complémentaire', complementary, rate(Math.min(complementary, PASS_CENTS), t.complementaryT1Bp) + rate(Math.max(complementary - PASS_CENTS, 0), t.complementaryT2Bp))
  const disability = Math.min(Math.max(base, passShare(t.disabilityMinPassBp)), PASS_CENTS)
  add('invalidite-deces', 'Invalidité-décès', disability, rate(disability, t.disabilityBp))
  const low = passShare(t.familyLowPassBp)
  const high = passShare(t.familyHighPassBp)
  const familyRate = base <= low ? 0 : base >= high ? t.familyRateBp : (t.familyRateBp * (base - low)) / (high - low)
  add('allocations-familiales', 'Allocations familiales', base, Math.round((base * familyRate) / 10_000))
  add('csg-crds', 'CSG et CRDS', base, rate(base, t.csgCrdsBp))
  add('formation', 'Contribution à la formation professionnelle', PASS_CENTS, passShare(t.trainingPassBp))

  return {
    incomeCents: income,
    abatementCents: abatement,
    baseCents: base,
    lines,
    totalCents: lines.reduce((s, l) => s + l.cents, 0),
    nonDeductibleCents: rate(base, t.nonDeductibleCsgCrdsBp),
  }
}

export interface TnsPay {
  /** What the company spends on the gérant: pay and the contributions it pays for him. */
  costCents: number
  contributions: TnsContributions
  /** Pay after contributions (negative when the minimum contributions exceed the budget). */
  netCents: number
  /** Taxable pay (CGI art. 62): the pay plus the CSG and CRDS that are not deductible. */
  taxableCents: number
}

/** Pay of a TNS gérant for a budget of the company. */
export function tnsPayForCost(costCents: number): TnsPay {
  const cost = Math.max(costCents, 0)
  const contributions = tnsContributions(cost)
  const net = cost - contributions.totalCents
  return { costCents: cost, contributions, netCents: net, taxableCents: Math.max(net + contributions.nonDeductibleCents, 0) }
}
