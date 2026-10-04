/**
 * Allocation of the result. Sources: Code de commerce art. L. 232-10 (legal
 * reserve: 5 % of the profit less prior losses, until it reaches 10 % of the
 * capital, for SARL and sociétés par actions) and art. L. 232-11
 * (distributable profit).
 */

import { describe, expect, it } from 'vitest'
import { legalReserveApplies, legalReserveFor, planAllocation, type AllocationBalances } from '../compute'

const base: AllocationBalances = {
  resultCents: 2_000_000, // 20 000 €
  legalReserveCents: 0,
  capitalCents: 10_000_000, // 100 000 €
  retainedEarningsCents: 0,
  priorLossesCents: 0,
}
const balanced = (lines: Array<{ debitCents: number; creditCents: number }>) =>
  lines.reduce((s, l) => s + l.debitCents - l.creditCents, 0)

describe('legal reserve (L. 232-10)', () => {
  it('applies to SARL, EURL, SA, SAS and SCA, not to an SCI or an SNC', () => {
    expect(['SARL', 'EURL', 'SELARL', 'SA', 'SAS', 'SASU', 'SELAS', 'SCA'].every(legalReserveApplies)).toBe(true)
    expect(legalReserveApplies(null)).toBe(false)
    expect(['SNC', 'SCS', 'SCI', 'EI'].some(legalReserveApplies)).toBe(false)
  })

  it('takes 5 % of the profit less prior losses', () => {
    expect(legalReserveFor(base)).toBe(100_000)
    expect(legalReserveFor({ ...base, priorLossesCents: 400_000 })).toBe(80_000)
  })

  it('stops at 10 % of the capital', () => {
    expect(legalReserveFor({ ...base, legalReserveCents: 950_000 })).toBe(50_000)
    expect(legalReserveFor({ ...base, legalReserveCents: 1_000_000 })).toBe(0)
  })
})

describe('planAllocation', () => {
  it('allocates a profit to the legal reserve, dividends, other reserves and report à nouveau', () => {
    const plan = planAllocation(base, { dividendsCents: 1_000_000, otherReservesCents: 200_000 }, { legalReserveRequired: true })
    expect(plan.errors).toEqual([])
    expect(plan.lines).toEqual([
      { code: '120', debitCents: 2_000_000, creditCents: 0 },
      { code: '1061', debitCents: 0, creditCents: 100_000 },
      { code: '1068', debitCents: 0, creditCents: 200_000 },
      { code: '457', debitCents: 0, creditCents: 1_000_000 },
      { code: '110', debitCents: 0, creditCents: 700_000 },
    ])
    expect(balanced(plan.lines)).toBe(0)
  })

  it('clears prior losses before the report à nouveau créditeur', () => {
    const plan = planAllocation({ ...base, priorLossesCents: 300_000 }, { dividendsCents: 0, otherReservesCents: 0 }, { legalReserveRequired: true })
    expect(plan.legalReserveCents).toBe(85_000)
    expect(plan.priorLossesClearedCents).toBe(300_000)
    expect(plan.lines).toContainEqual({ code: '119', debitCents: 0, creditCents: 300_000 })
    expect(plan.lines).toContainEqual({ code: '110', debitCents: 0, creditCents: 1_615_000 })
    expect(balanced(plan.lines)).toBe(0)
  })

  it('refuses dividends above the distributable profit (L. 232-11)', () => {
    const plan = planAllocation(base, { dividendsCents: 1_950_000, otherReservesCents: 0 }, { legalReserveRequired: true })
    expect(plan.distributableCents).toBe(1_900_000)
    expect(plan.errors.join(' ')).toMatch(/L\. 232-11/)
  })

  it('may distribute the report à nouveau créditeur on top of the profit', () => {
    const plan = planAllocation(
      { ...base, retainedEarningsCents: 500_000 },
      { dividendsCents: 2_200_000, otherReservesCents: 0 },
      { legalReserveRequired: true }
    )
    expect(plan.errors).toEqual([])
    expect(plan.lines).toContainEqual({ code: '110', debitCents: 300_000, creditCents: 0 })
    expect(balanced(plan.lines)).toBe(0)
  })

  it('has no legal reserve for an SCI', () => {
    const plan = planAllocation(base, { dividendsCents: 0, otherReservesCents: 0 }, { legalReserveRequired: false })
    expect(plan.lines).toEqual([
      { code: '120', debitCents: 2_000_000, creditCents: 0 },
      { code: '110', debitCents: 0, creditCents: 2_000_000 },
    ])
  })

  it('reports a loss to 119 and refuses to distribute it', () => {
    const loss = { ...base, resultCents: -500_000 }
    expect(planAllocation(loss, { dividendsCents: 0, otherReservesCents: 0 }, { legalReserveRequired: true }).lines).toEqual([
      { code: '119', debitCents: 500_000, creditCents: 0 },
      { code: '129', debitCents: 0, creditCents: 500_000 },
    ])
    expect(planAllocation(loss, { dividendsCents: 1, otherReservesCents: 0 }, { legalReserveRequired: true }).errors).not.toEqual([])
  })

  it('has nothing to allocate once 120 and 129 are cleared', () => {
    const plan = planAllocation({ ...base, resultCents: 0 }, { dividendsCents: 0, otherReservesCents: 0 }, { legalReserveRequired: true })
    expect(plan.errors.join(' ')).toMatch(/déjà été affecté/)
  })
})
