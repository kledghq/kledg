/**
 * Share capital = number of shares x nominal value of a share (Code de
 * commerce art. L. 223-2 and L. 224-2: the capital is divided into shares of
 * equal nominal value), computed in cents.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { calculateShareCapital } from '../manage-company.service'

describe('calculateShareCapital', () => {
  it('multiplies the shares by the nominal value in cents', () => {
    expect(calculateShareCapital(1000, 1)).toBe('1000.00')
    // 3 x 0.1 as floats is 0.30000000000000004
    expect(calculateShareCapital(3, 0.1)).toBe('0.30')
    expect(calculateShareCapital('150', '15,25')).toBe('2287.50')
  })

  it('stays exact beyond 2^53 cents', () => {
    expect(calculateShareCapital(10_000_000_000, 9999.99)).toBe('99999900000000.00')
  })

  it('is not computed without both values', () => {
    expect(calculateShareCapital(undefined, 10)).toBeUndefined()
    expect(calculateShareCapital(100, undefined)).toBeUndefined()
    expect(calculateShareCapital(0, 10)).toBeUndefined()
  })

  it('refuses a nominal value that is not an amount', () => {
    expect(() => calculateShareCapital(100, 'dix euros')).toThrow("La valeur nominale d'une part est invalide")
  })
})
