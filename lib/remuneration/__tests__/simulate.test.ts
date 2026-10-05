/**
 * "Rémunération et dividendes" on plain values (lib/remuneration): worked
 * examples per status, the TNS dividends above 10 % of the capital, PFU
 * against the scale, the IS thresholds, the legal reserve, the income tax
 * and the optimiser. Fictitious figures. Sources: CGI art. 83, 158, 197,
 * 200 A, 219; CSS art. L131-6, L136-8 (LFSS 2026); C. com. L232-10;
 * décret n° 2024-688; PASS 2026 (48 060 €).
 */

import { describe, expect, it } from 'vitest'
import { incomeTax, salaryAfterDeduction } from '../income-tax'
import { PASS_CENTS } from '../rules'
import { employeePay, employeePayForCost, tnsContributions, tnsPayForCost } from '../social-contributions'
import { optimalCost, simulate, simulateScenario } from '../simulate'
import { breakdownRows, SCENARIO_ORDER } from '../breakdown'
import { RemunerationInputsSchema, type RemunerationInputs } from '../schemas'
import { sourcesFor } from '../sources'
import { simpleCardSentence, simpleSplitSentence, SIMPLE_CARD_HINT, SIMPLE_CARD_TITLE } from '../simple-wording'
import { jargonIn } from '@/lib/simple/vocabulary'

const k = (euros: number) => Math.round(euros * 100)

/** A SASU whose président holds the whole capital, single, no other income. */
const SASU: RemunerationInputs = {
  resultBeforePayCents: k(100_000),
  status: 'assimile',
  reducedRate: true,
  reducedRateCeilingCents: k(42_500),
  legalReserveRequired: true,
  capitalCents: k(1_000),
  legalReserveCents: k(100),
  priorLossesCents: 0,
  shareBp: 10_000,
  premiumsCents: 0,
  currentAccountCents: 0,
  householdParts: 1,
  otherIncomeCents: 0,
  dividendTaxation: 'best',
  distributionBp: 10_000,
  mixBp: 5_000,
}

/** An EURL whose gérant is the associé unique (TNS), capital 10 000 €, current account 5 000 €. */
const EURL: RemunerationInputs = { ...SASU, status: 'tns', resultBeforePayCents: k(50_000), capitalCents: k(10_000), legalReserveCents: 0, currentAccountCents: k(5_000) }

describe('income tax (CGI art. 197, scale of LFI 2026)', () => {
  it('applies the scale per part', () => {
    // (29 579 - 11 600) x 11 % + (30 000 - 29 579) x 30 % = 1 977,69 + 126,30
    expect(incomeTax(k(30_000), 1).taxCents).toBe(k(2_103.99))
    expect(incomeTax(k(30_000), 1).marginalRateBp).toBe(3_000)
    expect(incomeTax(k(11_600), 1).taxCents).toBe(0)
  })

  it('grants the décote under 1 982 € of tax for a single person', () => {
    // 924 € by the scale; décote 897 - 45,25 % x 924 = 478,89
    const r = incomeTax(k(20_000), 1)
    expect(r.grossTaxCents).toBe(k(924))
    expect(r.decoteCents).toBe(k(478.89))
    expect(r.taxCents).toBe(k(445.11))
  })

  it('caps the advantage of each half part above the couple at 1 807 €', () => {
    const couple = incomeTax(k(150_000), 2)
    const withChild = incomeTax(k(150_000), 2.5)
    expect(withChild.capped).toBe(true)
    expect(withChild.taxCents).toBe(couple.taxCents - k(1_807))
  })

  it('deducts 10 % for professional expenses within 509 € and 14 555 € (CGI art. 83, 3°)', () => {
    expect(salaryAfterDeduction(k(40_000))).toBe(k(36_000))
    expect(salaryAfterDeduction(k(3_000))).toBe(k(2_491))
    expect(salaryAfterDeduction(k(200_000))).toBe(k(185_445))
    expect(salaryAfterDeduction(0)).toBe(0)
  })
})

describe('assimilé salarié contributions (cadre, 2026)', () => {
  it('computes each contribution on its base for a gross pay of 40 000 €', () => {
    const pay = employeePay(k(40_000))
    // Employer: 13 + 8,55 + 2,11 + 5,25 + 0,30 + 0,10 + 0,75 + 4,72 + 1,29 + 0,04 + 1,50 + 0,55 + 0,68 = 38,84 %
    expect(pay.employerCents).toBe(k(15_536))
    // Employee: 6,90 + 0,40 + 3,15 + 0,86 + 0,02 % of the gross, CSG and CRDS 9,7 % of 98,25 %
    expect(pay.employeeCents).toBe(k(8_344.1))
    expect(pay.netCents).toBe(k(31_655.9))
    // The non deductible CSG and CRDS (2,9 % of 39 300 €) stay taxable
    expect(pay.taxableCents).toBe(k(32_795.6))
    expect(pay.employee.find((l) => l.id === 'csg-crds')?.baseCents).toBe(k(39_300))
  })

  it('adds the T2 contributions above the PASS (48 060 €)', () => {
    const pay = employeePay(k(100_000))
    expect(pay.employer.find((l) => l.id === 'agirc-arrco-t2')).toMatchObject({ baseCents: k(100_000) - PASS_CENTS, cents: k(6_726.23) })
    expect(pay.employer.find((l) => l.id === 'cet')?.baseCents).toBe(k(100_000))
  })

  it('finds the largest gross pay within a budget', () => {
    const pay = employeePayForCost(k(100_000))
    expect(pay.costCents).toBeLessThanOrEqual(k(100_000))
    expect(employeePay(pay.grossCents + 1).costCents).toBeGreaterThan(k(100_000))
    expect(employeePayForCost(0).grossCents).toBe(0)
  })
})

describe('TNS contributions (assiette unique, décret n° 2024-688)', () => {
  it('computes the contributions of a 50 000 € budget on the base after the 26 % abatement', () => {
    const c = tnsContributions(k(50_000))
    expect(c.abatementCents).toBe(k(13_000))
    expect(c.baseCents).toBe(k(37_000))
    const line = (id: string) => c.lines.find((l) => l.id === id)?.cents
    expect(line('indemnites-journalieres')).toBe(k(185))
    // 17,15 % up to the PASS and 0,72 % on the whole base
    expect(line('retraite-base')).toBe(k(6_611.9))
    expect(line('retraite-complementaire')).toBe(k(2_997))
    expect(line('invalidite-deces')).toBe(k(481))
    expect(line('allocations-familiales')).toBe(0)
    expect(line('csg-crds')).toBe(k(3_589))
    expect(line('formation')).toBe(k(120.15))
    // Maladie: between 4 % at 60 % of the PASS and 6,5 % at 110 %
    expect(line('maladie')).toBeGreaterThan(k(37_000 * 0.04))
    expect(line('maladie')).toBeLessThan(k(37_000 * 0.065))
    const pay = tnsPayForCost(k(50_000))
    expect(pay.netCents).toBe(k(50_000) - c.totalCents)
    expect(pay.taxableCents).toBe(pay.netCents + k(1_073))
  })

  it('keeps the minimum contributions without any pay', () => {
    const c = tnsContributions(0)
    expect(c.baseCents).toBe(0)
    // Minimum bases: 11,5 % of the PASS (pension, disability), 40 % (daily allowances)
    expect(c.totalCents).toBeGreaterThan(k(1_000))
    expect(tnsPayForCost(0).netCents).toBe(-c.totalCents)
  })

  it('charges maladie at 8,5 % up to 3 PASS and 6,5 % above', () => {
    const base = 4 * PASS_CENTS
    const c = tnsContributions(Math.round(base / 0.74))
    const sick = c.lines.find((l) => l.id === 'maladie')?.cents ?? 0
    const expected = Math.round((3 * PASS_CENTS * 850) / 10_000) + Math.round(((c.baseCents - 3 * PASS_CENTS) * 650) / 10_000)
    expect(sick).toBe(expected)
  })
})

describe('SASU président, 100 000 € before pay (worked example)', () => {
  const sim = simulate(SASU)

  it('all in dividends: IS 20 750 €, scale better than the PFU, net 58 757,21 €', () => {
    const s = sim.scenarios.allDividends
    // IS: 42 500 x 15 % + 57 500 x 25 %
    expect(s.company.corporateTaxCents).toBe(k(20_750))
    // Legal reserve already at a tenth of the capital: nothing more
    expect(s.company.legalReserveCents).toBe(0)
    expect(s.dividends.receivedCents).toBe(k(79_250))
    // Prélèvements sociaux of 18,6 % (LFSS 2026)
    expect(s.dividends.socialLeviesCents).toBe(k(14_740.5))
    // Scale: 79 250 x 60 % - 6,8 % x 79 250 = 42 161 €; tax 1 977,69 + 12 582 x 30 %
    expect(s.dividends.taxation).toBe('bareme')
    expect(s.incomeTax.directorCents).toBe(k(5_752.29))
    // PFU would have been 12,8 % x 79 250
    expect(s.incomeTax.other).toEqual({ taxation: 'pfu', directorCents: k(10_144) })
    expect(s.person.netIncomeCents).toBe(k(58_757.21))
  })

  it('all in pay: no IS, no dividends, the net after income tax', () => {
    const s = sim.scenarios.allPay
    expect(s.company.profitBeforeTaxCents).toBeGreaterThanOrEqual(0)
    expect(s.company.corporateTaxCents).toBe(0)
    expect(s.dividends.receivedCents).toBe(0)
    expect(s.person.netIncomeCents).toBe(s.pay.netCents - s.incomeTax.directorCents)
    expect(s.leviesCents).toBe(s.pay.employerContributionsCents + s.pay.employeeContributionsCents + s.incomeTax.directorCents)
  })

  it('the optimum gives at least what each scenario and each point of the curve gives', () => {
    const best = sim.scenarios.optimum.person.netIncomeCents
    for (const id of SCENARIO_ORDER) expect(best).toBeGreaterThanOrEqual(sim.scenarios[id].person.netIncomeCents)
    for (const point of sim.curve) expect(best).toBeGreaterThanOrEqual(point.netIncomeCents)
    expect(sim.curve).toHaveLength(21)
  })

  it('shows the same figures in the comparison rows', () => {
    const rows = breakdownRows(sim)
    expect(rows.find((r) => r.id === 'net')?.values.allDividends).toBe(k(58_757.21))
    expect(rows.find((r) => r.id === 'is')?.values.allDividends).toBe(k(20_750))
  })
})

describe('EURL gérant majoritaire (TNS), 50 000 € before pay (worked example)', () => {
  it('all in dividends: the part above 10 % of capital and current account bears the TNS contributions (CSS L131-6)', () => {
    const s = simulateScenario(EURL, 0, 'allDividends')
    // IS 42 500 x 15 % + 7 500 x 25 % = 8 250; legal reserve 1 000 (a tenth of the capital, below 5 %)
    expect(s.company.corporateTaxCents).toBe(k(8_250))
    expect(s.company.legalReserveCents).toBe(k(1_000))
    expect(s.dividends.receivedCents).toBe(k(40_750))
    // Threshold: 10 % x (10 000 + 5 000)
    expect(s.dividends.thresholdCents).toBe(k(1_500))
    expect(s.dividends.activityPartCents).toBe(k(39_250))
    // Prélèvements sociaux only on the 1 500 € under the threshold
    expect(s.dividends.socialLeviesCents).toBe(k(279))
    expect(s.dividends.tnsContributionsCents).toBe(tnsContributions(k(39_250)).totalCents - tnsContributions(0).totalCents)
    expect(s.dividends.tnsContributionsCents).toBeGreaterThan(k(10_000))
  })

  it('pays no social contributions on dividends under the threshold', () => {
    const s = simulateScenario({ ...EURL, capitalCents: k(500_000), legalReserveCents: k(50_000) }, 0, 'allDividends')
    expect(s.dividends.activityPartCents).toBe(0)
    expect(s.dividends.tnsContributionsCents).toBe(0)
    expect(s.dividends.socialLeviesCents).toBe(Math.round((s.dividends.receivedCents * 1_860) / 10_000))
  })

  it('all in pay: the whole budget goes to the gérant and his contributions', () => {
    const s = simulateScenario(EURL, k(50_000), 'allPay')
    expect(s.company.corporateTaxCents).toBe(0)
    expect(s.pay.employerContributionsCents).toBe(tnsContributions(k(50_000)).totalCents)
    expect(s.pay.netCents).toBe(k(50_000) - s.pay.employerContributionsCents)
    expect(s.pay.grossCents).toBeNull()
  })

  it('an assimilé salarié never pays social contributions on dividends', () => {
    const s = simulateScenario({ ...EURL, status: 'assimile' }, 0, 'allDividends')
    expect(s.dividends.thresholdCents).toBeNull()
    expect(s.dividends.socialLeviesCents).toBe(Math.round((k(40_750) * 1_860) / 10_000))
  })
})

describe('PFU against the scale (CGI art. 200 A, 158, 3, 2°)', () => {
  it('takes the flat 12,8 % when asked, the scale with the 40 % abatement when asked', () => {
    const pfu = simulateScenario({ ...SASU, dividendTaxation: 'pfu' }, 0)
    expect(pfu.dividends.taxation).toBe('pfu')
    expect(pfu.dividends.pfuCents).toBe(k(10_144))
    expect(pfu.incomeTax.directorCents).toBe(k(10_144))
    const scale = simulateScenario({ ...SASU, dividendTaxation: 'bareme' }, 0)
    expect(scale.dividends.pfuCents).toBe(0)
    expect(scale.incomeTax.directorCents).toBe(k(5_752.29))
  })

  it('prefers the PFU for a household already in the top brackets', () => {
    const s = simulateScenario({ ...SASU, otherIncomeCents: k(250_000) }, 0)
    expect(s.dividends.taxation).toBe('pfu')
    expect(s.incomeTax.directorCents).toBe(k(10_144))
    expect(s.incomeTax.other?.directorCents).toBeGreaterThan(k(10_144))
  })
})

describe('IS thresholds (CGI art. 219, I)', () => {
  const allDividends = (inputs: Partial<RemunerationInputs>) => simulateScenario({ ...SASU, ...inputs }, 0).company.corporateTaxCents

  it('taxes 15 % up to 42 500 € then 25 %', () => {
    expect(allDividends({ resultBeforePayCents: k(42_500) })).toBe(k(6_375))
    expect(allDividends({ resultBeforePayCents: k(42_504) })).toBe(k(6_376))
  })

  it('taxes everything at 25 % without the reduced rate, and follows a prorated ceiling', () => {
    expect(allDividends({ resultBeforePayCents: k(42_500), reducedRate: false })).toBe(k(10_625))
    // Six months: ceiling 21 250 €
    expect(allDividends({ resultBeforePayCents: k(42_500), reducedRateCeilingCents: k(21_250) })).toBe(k(21_250 * 0.15 + 21_250 * 0.25))
  })

  it('pays no IS and no dividends on a loss', () => {
    const s = simulateScenario({ ...SASU, resultBeforePayCents: k(-5_000) }, 0)
    expect(s.company.corporateTaxCents).toBe(0)
    expect(s.company.dividendsCents).toBe(0)
    expect(simulate({ ...SASU, resultBeforePayCents: k(-5_000) }).notes[0]).toContain('rien à verser')
  })
})

describe('legal reserve (C. com. L232-10)', () => {
  const base = { ...SASU, resultBeforePayCents: k(42_500), capitalCents: k(100_000), legalReserveCents: 0 }

  it('sets aside a twentieth of the profit after tax until a tenth of the capital', () => {
    // Profit after IS: 42 500 - 6 375 = 36 125; 5 % = 1 806,25
    const s = simulateScenario(base, 0)
    expect(s.company.legalReserveCents).toBe(k(1_806.25))
    expect(s.company.dividendsCents).toBe(k(36_125 - 1_806.25))
    // Only 500 € missing to reach 10 000 €
    expect(simulateScenario({ ...base, legalReserveCents: k(9_500) }, 0).company.legalReserveCents).toBe(k(500))
  })

  it('works on the profit less prior losses, and keeps the prior losses out of the dividends', () => {
    const s = simulateScenario({ ...base, priorLossesCents: k(6_125) }, 0)
    // (36 125 - 6 125) / 20 = 1 500
    expect(s.company.legalReserveCents).toBe(k(1_500))
    expect(s.company.distributableCents).toBe(k(36_125 - 6_125 - 1_500))
  })

  it('does not apply to a form without legal reserve', () => {
    expect(simulateScenario({ ...base, legalReserveRequired: false }, 0).company.legalReserveCents).toBe(0)
  })

  it('distributes only the share asked, the rest stays in the company', () => {
    const s = simulateScenario({ ...base, distributionBp: 5_000 }, 0)
    expect(s.company.dividendsCents).toBe(Math.floor((k(36_125 - 1_806.25) * 5_000) / 10_000))
    expect(s.company.retainedCents).toBe(k(36_125) - s.company.dividendsCents)
  })

  it('gives the director his share of the dividends only', () => {
    const s = simulateScenario({ ...base, shareBp: 6_000 }, 0)
    expect(s.dividends.receivedCents).toBe(Math.floor((s.company.dividendsCents * 6_000) / 10_000))
  })
})

describe('optimiser', () => {
  it('never does worse as the result before pay grows (monotonicity)', () => {
    for (const status of ['assimile', 'tns'] as const) {
      let previous = Number.NEGATIVE_INFINITY
      for (const result of [10_000, 30_000, 60_000, 100_000, 150_000, 250_000]) {
        const net = simulate({ ...SASU, status, resultBeforePayCents: k(result) }).scenarios.optimum.person.netIncomeCents
        expect(net).toBeGreaterThanOrEqual(previous)
        previous = net
      }
    }
  })

  it('stays within the budget, rounded to the euro', () => {
    const cost = optimalCost(EURL)
    expect(cost).toBeGreaterThanOrEqual(0)
    expect(cost).toBeLessThanOrEqual(EURL.resultBeforePayCents)
    expect(optimalCost({ ...SASU, resultBeforePayCents: 0 })).toBe(0)
  })

  it('beats every scenario of a TNS too', () => {
    const sim = simulate(EURL)
    for (const id of SCENARIO_ORDER) expect(sim.scenarios.optimum.person.netIncomeCents).toBeGreaterThanOrEqual(sim.scenarios[id].person.netIncomeCents)
  })
})

describe('inputs, sources and plain words', () => {
  it('validates the inputs with French messages', () => {
    expect(RemunerationInputsSchema.safeParse(SASU).success).toBe(true)
    const wrong = RemunerationInputsSchema.safeParse({ ...SASU, shareBp: 12_000, householdParts: 1.3 })
    expect(wrong.success).toBe(false)
    expect(wrong.error?.issues.map((i) => i.message)).toEqual(['Part du capital invalide\u00a0: entre 0 et 100 %', 'Les parts vont par quarts (1 ; 1,25 ; 1,5...)'])
  })

  it('cites the TNS texts for a gérant, the URSSAF rates for a président', () => {
    expect(sourcesFor('tns').map((s) => s.label).join(' ')).toContain('L131-6')
    expect(sourcesFor('assimile').map((s) => s.label).join(' ')).toContain('URSSAF')
    expect(sourcesFor('assimile').every((s) => s.url.startsWith('https://'))).toBe(true)
  })

  it('words the simple home card without jargon', () => {
    const texts = [SIMPLE_CARD_TITLE, SIMPLE_CARD_HINT, simpleCardSentence(k(80_000), k(55_000)), simpleSplitSentence(k(10_000), k(40_000)), simpleSplitSentence(0, k(40_000)), simpleSplitSentence(k(10_000), 0), simpleSplitSentence(0, 0)]
    for (const text of texts) expect(jargonIn(text)).toEqual([])
    expect(simpleCardSentence(k(80_000), k(55_000))).toBe('Avec 80 000 € de bénéfice prévu avant votre rémunération, vous pourriez garder environ 55 000 € après impôts et cotisations.')
  })
})
