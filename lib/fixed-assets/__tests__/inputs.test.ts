/**
 * Fixed asset fields read the same way on creation and update, and the
 * depreciation plan reads stored values (Prisma Decimal strings) exactly.
 * Sources of the plan: PCG art. 214-13, CGI art. 39, 1-2°, BOFiP
 * BOI-BIC-AMT-20-20-20-10 (linear allowance base x rate, prorata temporis).
 */

import { describe, expect, it } from 'vitest'
import { amountCents, dateOf, decimalNumber } from '../inputs'
import { buildDepreciationPlan, sumPlanCentsForPeriod, sumPlanForPeriod } from '../depreciation-plan'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const decimal = (value: string) => ({ toString: () => value })

describe('fixed asset inputs', () => {
  it('reads amounts as exact cents and refuses a third decimal or a negative amount', () => {
    expect(amountCents('1234.56', 'Montant')).toBe(123456)
    expect(amountCents(0.1 + 0.2, 'Montant')).toBe(30)
    expect(amountCents('', 'Montant')).toBeNull()
    expect(() => amountCents('10.005', 'Montant amortissable')).toThrow(
      'Montant amortissable : montant invalide (deux décimales au plus)',
    )
    expect(() => amountCents('-1', 'Montant')).toThrow('Montant : montant invalide')
  })

  it('reads rates and coefficients with a decimal comma, never parseFloat prefixes', () => {
    expect(decimalNumber('33,33', 'Taux')).toBe(33.33)
    expect(decimalNumber(2.25, 'Coefficient')).toBe(2.25)
    expect(decimalNumber(null, 'Taux')).toBeNull()
    // parseFloat("20abc") was 20
    expect(() => decimalNumber('20abc', "Taux d'amortissement")).toThrow("Taux d'amortissement invalide")
  })

  it('refuses an invalid date', () => {
    expect(dateOf('2025-03-15', 'Date')?.toISOString()).toBe('2025-03-15T00:00:00.000Z')
    expect(() => dateOf('15/03/2025x', "Date d'acquisition")).toThrow("Date d'acquisition invalide")
  })
})

describe('depreciation plan from stored values', () => {
  const plan = buildDepreciationPlan({
    acquisitionValue: decimal('1000.00'),
    amortizableAmount: decimal('999.99'),
    depreciationMethod: 'linear',
    depreciationRate: decimal('33.33'),
    depreciationDuration: null,
    decliningCoefficient: null,
    depreciationStartDate: day('2025-01-01'),
  })

  it('takes the amortizable amount in cents as the base', () => {
    expect(plan.baseAmount).toBe(999.99)
  })

  it('sums a period in cents, and the plan ends exactly on the base', () => {
    const all = sumPlanCentsForPeriod(plan, day('2025-01-01'), day('2030-12-31'))
    expect(all).toBe(99999)
    expect(sumPlanForPeriod(plan, day('2025-01-01'), day('2030-12-31'))).toBe(999.99)
    // Full first year: base x rate = 999.99 x 33.33 % = 333.30 (rounded to the cent)
    expect(sumPlanCentsForPeriod(plan, day('2025-01-01'), day('2025-12-31'))).toBe(33330)
  })

  it('falls back to the acquisition value when the amortizable amount is empty or zero', () => {
    const fallback = buildDepreciationPlan({
      acquisitionValue: decimal('500.00'),
      amortizableAmount: decimal('0.00'),
      depreciationMethod: 'linear',
      depreciationRate: null,
      depreciationDuration: 5,
      decliningCoefficient: null,
      depreciationStartDate: day('2025-01-01'),
    })
    expect(fallback.baseAmount).toBe(500)
  })
})
