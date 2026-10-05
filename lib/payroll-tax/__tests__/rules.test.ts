/**
 * Taxe sur les salaires (CGI art. 231, 1679, 1679 A; BOI-TPS-TS-20-30,
 * BOI-TPS-TS-30, BOI-TPS-TS-40; notices 2501-SD 2025 and 2026, 2502-SD).
 */

import { describe, expect, it } from 'vitest'
import {
  annualDeclarationDate,
  appliedRatio,
  computePayrollTax,
  frequencyOf,
  isLiable,
  lineTaxes,
  releveDates,
  PAYROLL_TAX_YEARS,
} from '../rules'

const Y2026 = PAYROLL_TAX_YEARS[2026]
const euro = (n: number) => n * 100

describe('barème', () => {
  it('has the thresholds and abattement of 2025 and 2026 (notices 2501-SD, art. 231, 2 bis, art. 1679 A)', () => {
    expect(PAYROLL_TAX_YEARS[2025]).toEqual({ lowerCents: euro(9_147), upperCents: euro(18_259), associationAbatementCents: euro(24_041) })
    expect(Y2026).toEqual({ lowerCents: euro(9_229), upperCents: euro(18_423), associationAbatementCents: euro(24_256) })
    expect(PAYROLL_TAX_YEARS[2027]).toBeUndefined()
  })

  it('reproduces example 5 of the 2502 notice: 15 300 + 1 549 + 26 831 = 43 680 €', () => {
    expect(lineTaxes(euro(360_000), euro(36_448), euro(286_964))).toEqual({ d0: euro(15_300), d1: euro(1_549), d2: euro(26_831), gross: euro(43_680) })
  })
})

describe('liability and rapport (art. 231, 1; BOI-TPS-TS-20-30)', () => {
  it('is liable when less than 90 % of the turnover of the year before was subject to VAT', () => {
    expect(isLiable(euro(10_001), euro(100_000))).toBe(true)
    expect(isLiable(euro(10_000), euro(100_000))).toBe(false)
    expect(isLiable(0, 0)).toBe(false)
  })

  it('truncates the rapport to the whole percent (§80) and smooths it between 10 and 20 % (§220)', () => {
    expect(appliedRatio(827, 1_000)).toEqual({ exactBasisPoints: 8_270, truncatedPercent: 82, appliedPercent: 82 })
    expect(appliedRatio(137, 1_000)?.appliedPercent).toBe(6)
    expect(appliedRatio(110, 1_000)?.appliedPercent).toBe(2)
    expect(appliedRatio(200, 1_000)?.appliedPercent).toBe(20)
    expect(appliedRatio(105, 1_000)?.appliedPercent).toBe(0)
    expect(appliedRatio(50, 1_000)?.appliedPercent).toBe(0)
    expect(appliedRatio(1_000, 1_000)?.appliedPercent).toBe(100)
    expect(appliedRatio(1, 0)).toBeNull()
  })
})

describe('computation of the 2502', () => {
  it('splits each employee between the brackets of 2026 and applies the rapport to the total', () => {
    // 30 000 €: 20 771 € from 9 229 € to 18 423 € gives 9 194 €, above it 11 577 €; 8 000 €: below the threshold
    const c = computePayrollTax({ rules: Y2026, employeeBasesCents: [euro(30_000), euro(8_000)], ratioPercent: 100, association: false })
    expect(c).toMatchObject({ baseCents: euro(38_000), firstBracketCents: euro(9_194), secondBracketCents: euro(11_577) })
    // 1 615 + 390,745 (391) + 1 082,4495 (1 082) = 3 088 €
    expect(c).toMatchObject({ taxBaseCents: euro(1_615), taxFirstCents: euro(391), taxSecondCents: euro(1_082), grossCents: euro(3_088), afterRatioCents: euro(3_088), decoteCents: 0, dueCents: euro(3_088) })
    const partial = computePayrollTax({ rules: Y2026, employeeBasesCents: [euro(30_000), euro(8_000)], ratioPercent: 60, association: false })
    expect(partial.afterRatioCents).toBe(euro(1_853))
  })

  it('applies the franchise of 1 200 € and the décote up to 2 040 € (art. 1679, notice example: 1 320 € gives 780 €)', () => {
    const small = computePayrollTax({ rules: Y2026, employeeBasesCents: [euro(9_000)], ratioPercent: 100, association: false })
    expect(small).toMatchObject({ afterRatioCents: euro(383), franchise: true, dueCents: 0 })
    const middle = computePayrollTax({ rules: Y2026, employeeBasesCents: [euro(9_000), euro(9_000), euro(9_000), euro(4_059)], ratioPercent: 100, association: false })
    // 31 059 x 4,25 % = 1 320 € (all below the threshold): décote 3/4 x (2 040 - 1 320) = 540, due 780
    expect(middle).toMatchObject({ afterRatioCents: euro(1_320), franchise: false, decoteCents: euro(540), dueCents: euro(780) })
  })

  it('applies the association abattement after franchise and décote, never refunded (art. 1679 A, notice 2502 C.4)', () => {
    const c = computePayrollTax({ rules: Y2026, employeeBasesCents: Array(20).fill(euro(40_000)), ratioPercent: 100, association: true })
    expect(c.abatementCents).toBe(euro(24_256))
    expect(c.dueCents).toBe(c.afterDecoteCents - euro(24_256))
    const below = computePayrollTax({ rules: Y2026, employeeBasesCents: [euro(40_000)], ratioPercent: 100, association: true })
    expect(below.dueCents).toBe(0)
  })
})

describe('payment (ann. III art. 369, notice 2501, BOI-TPS-TS-40)', () => {
  it('pays monthly above 10 000 €, quarterly from 4 000 €, annually below', () => {
    expect(frequencyOf(euro(10_001))).toBe('monthly')
    expect(frequencyOf(euro(10_000))).toBe('quarterly')
    expect(frequencyOf(euro(4_000))).toBe('quarterly')
    expect(frequencyOf(euro(3_999))).toBe('annual')
  })

  it('has no relevé for December or the fourth quarter, and the 2502 by 15 January (31 January admitted)', () => {
    const monthly = releveDates(2026, 'monthly')
    expect(monthly).toHaveLength(11)
    expect(monthly[0]).toEqual({ key: '2026-01', period: '2026-01', date: '2026-02-15' })
    expect(monthly[10].date).toBe('2026-12-15')
    expect(releveDates(2026, 'quarterly').map((r) => r.date)).toEqual(['2026-04-15', '2026-07-15', '2026-10-15'])
    expect(releveDates(2026, 'annual')).toEqual([])
    expect(annualDeclarationDate(2026)).toEqual({ date: '2027-01-15', extendedDate: '2027-01-31' })
  })
})
