/**
 * Worked examples of the intégration fiscale simulation
 * (lib/group/tax-integration.ts):
 * - perimeter: 95 % held directly or through members (CGI art. 223 A;
 *   BOI-IS-GPE-10-20-10, successive percentages multiplied), liable to IS,
 *   same twelve-month dates (BOI-IS-GPE-10-30), parent not held 95 % by
 *   another IS company;
 * - résultat d'ensemble (art. 223 B): sum of the members' results, 1 %
 *   quote-part instead of 5 % on dividends between members (art. 216, I;
 *   BOI-IS-GPE-20-20-20-20), 99 % deduction outside the régime mère-fille,
 *   management fees neutral, typed retraitements;
 * - deficits from before the group on the member's own profit (art. 223 I),
 *   within art. 209, I;
 * - IS of the group with the reduced rate once (art. 219, I, b) and the
 *   contribution sociale once (art. 235 ter ZC).
 */

import { describe, expect, it } from 'vitest'
import { integrationInterests, simulateTaxIntegration, type IntegrationCompanyInput, type IntegrationInput } from '../tax-integration'

const YEAR = { startDate: '2026-01-01', endDate: '2026-12-31', months: 12 }
const EUR = 100

function company(id: string, overrides: Partial<IntegrationCompanyInput> = {}): IntegrationCompanyInput {
  return {
    id,
    name: id.toUpperCase(),
    role: id === 'h' ? 'holding' : 'subsidiary',
    status: 'ready',
    fiscalYear: YEAR,
    resultBeforeDeficitsCents: 0,
    deficitsOpeningCents: 0,
    turnoverCents: 0,
    separateTaxCents: 0,
    separateSocialCents: 0,
    capitalPaidUp: true,
    naturalPersons75: true,
    ...overrides,
  }
}

function input(overrides: Partial<IntegrationInput> = {}): IntegrationInput {
  return {
    holdingId: 'h',
    companies: [],
    holdings: [],
    parentHeldByCompany: false,
    dividends: [],
    managementFees: [],
    manual: {},
    unreachable: 0,
    ...overrides,
  }
}

describe('who can be a member', () => {
  it('multiplies the percentages along the chains through members only (art. 223 A)', () => {
    const interests = integrationInterests('h', ['h', 'a', 'c', 'd', 'b', 'e'], [
      { holderId: 'h', companyId: 'a', bp: 9500 },
      { holderId: 'a', companyId: 'c', bp: 10000 },
      { holderId: 'h', companyId: 'd', bp: 6000 },
      { holderId: 'a', companyId: 'd', bp: 4000 },
      { holderId: 'h', companyId: 'b', bp: 8000 },
      { holderId: 'h', companyId: 'e', bp: 5000 },
      { holderId: 'b', companyId: 'e', bp: 5000 },
    ])
    expect(interests.get('a')).toBe(9500)
    // 95 % x 100 %.
    expect(interests.get('c')).toBe(9500)
    // 60 % + 95 % x 40 % = 98 %.
    expect(interests.get('d')).toBe(9800)
    expect(interests.get('b')).toBe(8000)
    // B is not a member (80 %): its half of E does not count.
    expect(interests.get('e')).toBe(5000)
  })

  it('leaves out a subsidiary under 95 %, one on other dates and one not liable to IS', () => {
    const sim = simulateTaxIntegration(
      input({
        companies: [
          company('h'),
          company('a'),
          company('b'),
          company('c', { fiscalYear: { startDate: '2026-04-01', endDate: '2027-03-31', months: 12 } }),
          company('d', { status: 'not-subject' }),
        ],
        holdings: ['a', 'b', 'c', 'd'].map((id) => ({ holderId: 'h', companyId: id, bp: id === 'b' ? 9000 : 10000 })),
      }),
    )
    expect(sim.members.map((m) => [m.companyId, m.member])).toEqual([
      ['h', true],
      ['a', true],
      ['b', false],
      ['c', false],
      ['d', false],
    ])
    expect(sim.members.find((m) => m.companyId === 'b')?.checks.find((c) => c.id === 'detention')).toMatchObject({ status: 'ko', detail: 'Détention par la holding et les membres du groupe : 90 %.' })
    expect(sim.members.find((m) => m.companyId === 'c')?.checks.find((c) => c.id === 'dates')?.status).toBe('ko')
    expect(sim.members.find((m) => m.companyId === 'd')?.checks.find((c) => c.id === 'is')?.status).toBe('ko')
    expect(sim.possible).toBe(true)
  })

  it('says there is no group when no subsidiary qualifies or the parent cannot head one', () => {
    const only90 = simulateTaxIntegration(input({ companies: [company('h'), company('b')], holdings: [{ holderId: 'h', companyId: 'b', bp: 9000 }] }))
    expect(only90).toMatchObject({ possible: false, group: null, savingCents: 0, separateTotalCents: 0 })
    expect(only90.warnings).toContain('Aucune filiale lue ne remplit les conditions : pas de groupe à simuler.')

    const held = simulateTaxIntegration(input({ parentHeldByCompany: true, companies: [company('h'), company('a')], holdings: [{ holderId: 'h', companyId: 'a', bp: 10000 }] }))
    expect(held.possible).toBe(false)
    expect(held.checks.find((c) => c.id === 'parent-not-held')?.status).toBe('ko')
    expect(held.members.every((m) => !m.member)).toBe(true)

    const shortYear = simulateTaxIntegration(input({ companies: [company('h', { fiscalYear: { startDate: '2026-01-01', endDate: '2026-06-30', months: 6 } }), company('a', { fiscalYear: { startDate: '2026-01-01', endDate: '2026-06-30', months: 6 } })], holdings: [{ holderId: 'h', companyId: 'a', bp: 10000 }] }))
    expect(shortYear.possible).toBe(false)
  })
})

describe('worked example: a holding, a profitable subsidiary and a loss-making one', () => {
  // H: tax result 12 500 € (after deducting A's 50 000 € of dividends and adding back the 5 % quote-part), IS 1 875 €.
  // A (100 %): 200 000 €, IS 45 750 € (6 375 € at 15 % + 39 375 € at 25 %). B (96 %): loss of 80 000 €.
  const sim = simulateTaxIntegration(
    input({
      companies: [
        company('h', { resultBeforeDeficitsCents: 12_500 * EUR, turnoverCents: 30_000 * EUR, separateTaxCents: 1_875 * EUR }),
        company('a', { resultBeforeDeficitsCents: 200_000 * EUR, turnoverCents: 1_000_000 * EUR, separateTaxCents: 45_750 * EUR }),
        company('b', { resultBeforeDeficitsCents: -80_000 * EUR, turnoverCents: 150_000 * EUR }),
      ],
      holdings: [
        { holderId: 'h', companyId: 'a', bp: 10000 },
        { holderId: 'h', companyId: 'b', bp: 9600 },
      ],
      dividends: [{ receiverId: 'h', payerId: 'a', cents: 50_000 * EUR, parentRegime: true }],
      managementFees: [{ sellerId: 'h', buyerId: 'a', revenueCents: 10_000 * EUR, chargeCents: 10_000 * EUR }],
    }),
  )

  it('adds the results up and applies the 1 % quote-part on the dividends between members', () => {
    expect(sim.possible).toBe(true)
    expect(sim.sumOfResultsCents).toBe(132_500 * EUR)
    // 5 % of 50 000 € (2 500 €) were added back by H; in the group 1 % (500 €): 2 000 € come off.
    expect(sim.adjustments.find((a) => a.id === 'dividends-h-a')).toMatchObject({ amountCents: -2_000 * EUR, origin: 'books', source: 'bofipDividendes' })
    // Management fees: a produit of H, a charge of A, neutral in the sum.
    expect(sim.adjustments.find((a) => a.id === 'fees-h-a')).toMatchObject({ amountCents: 0, origin: 'info' })
    // The retraitements the books cannot show are listed, not counted.
    expect(sim.adjustments.filter((a) => a.id.startsWith('manual-')).every((a) => a.origin === 'info' && a.amountCents === 0)).toBe(true)
    expect(sim.resultBeforeDeficitsCents).toBe(130_500 * EUR)
  })

  it('taxes the group once: 15 % on 42 500 €, 25 % above, no contribution sociale', () => {
    expect(sim.turnoverCents).toBe(1_180_000 * EUR)
    expect(sim.group).toMatchObject({
      taxableProfitCents: 130_500 * EUR,
      reducedRate: { applied: true, baseCents: 42_500 * EUR, taxCents: 6_375 * EUR },
      normalRate: { baseCents: 88_000 * EUR, taxCents: 22_000 * EUR },
      corporateTaxCents: 28_375 * EUR,
      socialContribution: { exempt: true, cents: 0 },
      totalCents: 28_375 * EUR,
    })
    // 1 875 + 45 750 + 0 = 47 625 € separately: 19 250 € saved, mostly B's loss offsetting A's profit.
    expect(sim.separateTotalCents).toBe(47_625 * EUR)
    expect(sim.savingCents).toBe(19_250 * EUR)
    expect(sim.sources.map((s) => s.id)).toEqual(expect.arrayContaining(['cgi223A', 'cgi216', 'cgi219', 'bofipDetention']))
  })

  it('counts a typed retraitement, and deducts 99 % of dividends outside the régime mère-fille', () => {
    const withManual = simulateTaxIntegration(
      input({
      companies: [company('h', { resultBeforeDeficitsCents: 0 }), company('a', { resultBeforeDeficitsCents: 100_000 * EUR })],
      holdings: [{ holderId: 'h', companyId: 'a', bp: 10000 }],
      dividends: [{ receiverId: 'h', payerId: 'a', cents: 10_000 * EUR, parentRegime: false }],
      manual: { provisions: 5_000 * EUR },
      }),
    )
    expect(withManual.adjustments.find((a) => a.id === 'dividends-h-a')).toMatchObject({ amountCents: -9_900 * EUR, source: 'cgi223' })
    expect(withManual.adjustments.find((a) => a.id === 'manual-provisions')).toMatchObject({ amountCents: 5_000 * EUR, origin: 'manual' })
    expect(withManual.resultBeforeDeficitsCents).toBe(95_100 * EUR)
  })
})

describe('reduced rate once and deficits', () => {
  it('applies the 42 500 € of the reduced rate once for the group: integrating two small profits costs more', () => {
    // A and B each 40 000 € at 15 % separately: 6 000 € each. Together 80 000 €: 6 375 € + 9 375 €.
    const sim = simulateTaxIntegration(
      input({
        companies: [company('h'), company('a', { resultBeforeDeficitsCents: 40_000 * EUR, separateTaxCents: 6_000 * EUR }), company('b', { resultBeforeDeficitsCents: 40_000 * EUR, separateTaxCents: 6_000 * EUR })],
        holdings: [
          { holderId: 'h', companyId: 'a', bp: 10000 },
          { holderId: 'h', companyId: 'b', bp: 10000 },
        ],
      }),
    )
    expect(sim.group?.corporateTaxCents).toBe(15_750 * EUR)
    expect(sim.savingCents).toBe(-3_750 * EUR)
  })

  it('computes at the normal rate when the parent has not answered the capital conditions, and says what the reduced rate would give', () => {
    const sim = simulateTaxIntegration(
      input({
        companies: [company('h', { naturalPersons75: null }), company('a', { resultBeforeDeficitsCents: 40_000 * EUR })],
        holdings: [{ holderId: 'h', companyId: 'a', bp: 10000 }],
      }),
    )
    expect(sim.group?.reducedRate).toMatchObject({ applied: false, eligible: null })
    expect(sim.group?.corporateTaxCents).toBe(10_000 * EUR)
    expect(sim.group?.ifEligibleCents).toBe(6_000 * EUR)
    expect(sim.group?.socialContribution.exempt).toBe(false)
  })

  it('offsets deficits from before the group only against the profit of the company that made them (art. 223 I)', () => {
    const sim = simulateTaxIntegration(
      input({
        companies: [
          company('h'),
          company('a', { resultBeforeDeficitsCents: 100_000 * EUR, deficitsOpeningCents: 0 }),
          company('b', { resultBeforeDeficitsCents: 10_000 * EUR, deficitsOpeningCents: 50_000 * EUR }),
          company('c', { resultBeforeDeficitsCents: 20_000 * EUR, deficitsOpeningCents: 30_000 * EUR }),
        ],
        holdings: ['a', 'b', 'c'].map((id) => ({ holderId: 'h', companyId: id, bp: 10000 })),
      }),
    )
    // B uses 10 000 € (its own profit), C 20 000 €: 30 000 € of the 80 000 € carried.
    expect(sim.deficits).toMatchObject({ openingCents: 80_000 * EUR, usableCents: 30_000 * EUR, imputedCents: 30_000 * EUR, groupDeficitCents: 0 })
    expect(sim.group?.taxableProfitCents).toBe(100_000 * EUR)
  })

  it('carries a loss of the group forward at the group level, without tax', () => {
    const sim = simulateTaxIntegration(
      input({
        companies: [company('h', { resultBeforeDeficitsCents: -30_000 * EUR }), company('a', { resultBeforeDeficitsCents: 10_000 * EUR, separateTaxCents: 1_500 * EUR })],
        holdings: [{ holderId: 'h', companyId: 'a', bp: 10000 }],
      }),
    )
    expect(sim.deficits.groupDeficitCents).toBe(20_000 * EUR)
    expect(sim.group?.totalCents).toBe(0)
    expect(sim.savingCents).toBe(1_500 * EUR)
  })

  it('warns that a subsidiary not read is left out', () => {
    const sim = simulateTaxIntegration(input({ unreachable: 1, companies: [company('h'), company('a')], holdings: [{ holderId: 'h', companyId: 'a', bp: 10000 }] }))
    expect(sim.warnings[0]).toBe('Une filiale n’est pas lue, faute d’accès : elle n’est pas dans la simulation, même si elle pourrait être membre du groupe.')
  })
})
