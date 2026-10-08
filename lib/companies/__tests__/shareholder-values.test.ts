/**
 * Share percentages and capital of shareholders are decimals with two
 * places (Decimal(5, 2), Decimal(15, 2)): handled as integer hundredths.
 * A third decimal is rounded half away from zero, as PostgreSQL rounds a
 * value stored in numeric(p, 2) (PostgreSQL documentation, "Numeric Types":
 * the fractional part is rounded to the declared scale, ties away from zero).
 */

import { describe, expect, it } from 'vitest'
import {
  assertTotalPercentage,
  hundredthsToDecimal,
  parseCapitalAmount,
  parseSharePercentage,
} from '../shareholder-values'

const decimal = (value: string) => ({ toString: () => value })

describe('parseSharePercentage', () => {
  it('reads numbers, strings and French decimal commas as hundredths', () => {
    expect(parseSharePercentage(33.33)).toBe(3333)
    expect(parseSharePercentage('50')).toBe(5000)
    expect(parseSharePercentage(' 12,5 ')).toBe(1250)
    expect(parseSharePercentage(100)).toBe(10000)
    expect(parseSharePercentage(0)).toBe(0)
  })

  it('rounds a third decimal half away from zero, like the database', () => {
    expect(parseSharePercentage(100 / 3)).toBe(3333)
    expect(parseSharePercentage('33.335')).toBe(3334)
    expect(hundredthsToDecimal(parseSharePercentage('33.334'))).toBe('33.33')
  })

  it('refuses what is not a percentage between 0 and 100', () => {
    for (const value of ['abc', '', -0.01, 100.01, '1e2', null, true]) {
      expect(() => parseSharePercentage(value), String(value)).toThrow('Le pourcentage de participation doit être entre 0 et 100')
    }
  })
})

describe('assertTotalPercentage', () => {
  it('accepts exactly 100 % made of hundredths that float sums would miss', () => {
    expect(() => assertTotalPercentage([decimal('33.33'), decimal('33.33'), decimal('33.33')], 1)).not.toThrow()
    expect(() => assertTotalPercentage([decimal('0.1'), decimal('0.2')], 9970)).not.toThrow()
  })

  it('refuses a total above 100 % with the total in French notation', () => {
    expect(() => assertTotalPercentage([decimal('60.00'), decimal('40.00')], 1)).toThrow(
      'Le total des pourcentages ne peut pas dépasser 100 %. Total actuel : 100,01 %',
    )
  })
})

describe('parseCapitalAmount', () => {
  it('stores the capital as an exact decimal string', () => {
    expect(parseCapitalAmount(1000)).toBe('1000.00')
    expect(parseCapitalAmount('1500,5')).toBe('1500.50')
    expect(parseCapitalAmount(0.1 + 0.2)).toBe('0.30')
  })

  it('treats an empty value as no capital', () => {
    expect(parseCapitalAmount('')).toBeNull()
    expect(parseCapitalAmount(null)).toBeNull()
    expect(parseCapitalAmount(0)).toBeNull()
  })

  it('refuses an amount that is not a number', () => {
    expect(() => parseCapitalAmount('mille')).toThrow('Le montant du capital détenu est invalide')
  })
})
