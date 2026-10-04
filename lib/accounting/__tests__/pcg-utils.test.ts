/**
 * Account code helpers (lib/accounting/pcg-utils.ts): lookup in the PCG 2026
 * chart of accounts (list of accounts, PCG art. 932-1), code format and class.
 */

import { describe, expect, it } from 'vitest'
import { getAccountByCode, getAccountClass, isValidAccountCode } from '../pcg-utils'

describe('getAccountByCode', () => {
  it('finds the account of the chart with its parent', () => {
    expect(getAccountByCode('512')).toEqual({ code: '512', label: 'Banques', parentCode: '51' })
    expect(getAccountByCode('2154')).toEqual({ code: '2154', label: 'Matériels industriels', parentCode: '215' })
    expect(getAccountByCode('2')).toEqual({ code: '2', label: "Comptes d'immobilisations" })
  })

  it('returns undefined for a code outside the chart', () => {
    expect(getAccountByCode('999')).toBeUndefined()
    expect(getAccountByCode('512000')).toBeUndefined()
  })
})

describe('isValidAccountCode', () => {
  it.each([
    ['51', true],
    ['512', true],
    ['51200000', true],
    ['5', false],
    ['512000000', false],
    ['512A', false],
    ['', false],
  ])('%s -> %s', (code, valid) => {
    expect(isValidAccountCode(code)).toBe(valid)
  })
})

describe('getAccountClass', () => {
  it('reads the class from the first digit', () => {
    expect(getAccountClass('411000')).toBe(4)
    expect(getAccountClass('801')).toBe(8)
    expect(getAccountClass('X12')).toBeNull()
    expect(getAccountClass('')).toBeNull()
  })
})
