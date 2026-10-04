/**
 * SIREN and SIRET keys (Luhn, with the La Poste exception) and French VAT
 * numbers (key (12 + 3 x (SIREN mod 97)) mod 97), plus the rules of tiers
 * fields (auxiliary numbers, collective and line accounts, PCG art. 932-1).
 */

import { describe, expect, it } from 'vitest'
import { checkIdentifiers, frenchVatNumberOf, isValidSiren, isValidSiret, isValidVatNumber, normalizeVatNumber } from '../identifiers'
import { accountCodeError, auxiliaryNumberError, normalizeAuxiliaryNumber } from '../rules'

describe('SIREN and SIRET', () => {
  it('accepts numbers with a valid Luhn key', () => {
    expect(isValidSiren('732829320')).toBe(true)
    expect(isValidSiren('303265045')).toBe(true)
    expect(isValidSiret('73282932000074')).toBe(true)
  })

  it('refuses a wrong key or length', () => {
    expect(isValidSiren('732829321')).toBe(false)
    expect(isValidSiren('12345678')).toBe(false)
    expect(isValidSiret('73282932000075')).toBe(false)
    expect(isValidSiret('7328293200007')).toBe(false)
  })

  it('accepts La Poste (SIREN 356000000) by its own rule', () => {
    expect(isValidSiren('356000000')).toBe(true)
    // Digits summing to a multiple of 5: 3+5+6+0+0+0+0+0+0+0+0+0+0+1 = 15
    expect(isValidSiret('35600000000001')).toBe(true)
    expect(isValidSiret('35600000000002')).toBe(false)
  })
})

describe('VAT numbers', () => {
  it('computes the key of a French number', () => {
    expect(frenchVatNumberOf('303265045')).toBe('FR40303265045')
    expect(frenchVatNumberOf('732829320')).toBe('FR44732829320')
  })

  it('checks the key and the SIREN of a French number, the shape of others', () => {
    expect(isValidVatNumber('FR40303265045')).toBe(true)
    expect(isValidVatNumber('FR41303265045')).toBe(false)
    expect(isValidVatNumber('FR40303265046')).toBe(false)
    expect(isValidVatNumber('BE0123456789')).toBe(true)
    expect(isValidVatNumber('X1')).toBe(false)
    expect(normalizeVatNumber(' fr 40 303 265 045 ')).toBe('FR40303265045')
  })
})

describe('checkIdentifiers', () => {
  it('derives the SIREN from the SIRET and normalizes', () => {
    const { values, errors } = checkIdentifiers({ siret: '732 829 320 00074', vatNumber: 'fr44732829320' })
    expect(errors).toEqual([])
    expect(values).toEqual({ siren: '732829320', siret: '73282932000074', vatNumber: 'FR44732829320' })
  })

  it('reports every inconsistency in French', () => {
    expect(checkIdentifiers({ siren: '123456789' }).errors[0]).toMatch(/SIREN/)
    expect(checkIdentifiers({ siren: '303265045', siret: '73282932000074' }).errors[0]).toMatch(/commencer par le SIREN/)
    expect(checkIdentifiers({ siren: '303265045', vatNumber: 'FR44732829320' }).errors[0]).toMatch(/se terminer par le SIREN/)
    expect(checkIdentifiers({}).errors).toEqual([])
  })
})

describe('tiers fields', () => {
  it('normalizes and checks auxiliary numbers', () => {
    expect(normalizeAuxiliaryNumber(' c00012 ')).toBe('C00012')
    expect(auxiliaryNumberError('C00012')).toBeNull()
    expect(auxiliaryNumberError('DUPONT_SA')).toBeNull()
    expect(auxiliaryNumberError('TROP LONG ESPACE')).toMatch(/17 caractères/)
    expect(auxiliaryNumberError('A'.repeat(18))).toMatch(/17 caractères/)
  })

  it('keeps customers on 41 and class 7, suppliers on 40 and classes 6 or 2', () => {
    expect(accountCodeError('CUSTOMER', 'collective', '411000')).toBeNull()
    expect(accountCodeError('CUSTOMER', 'collective', '401000')).toMatch(/commence par 41/)
    expect(accountCodeError('SUPPLIER', 'collective', '404')).toBeNull()
    expect(accountCodeError('SUPPLIER', 'line', '6064')).toBeNull()
    expect(accountCodeError('SUPPLIER', 'line', '2183')).toBeNull()
    expect(accountCodeError('SUPPLIER', 'line', '706')).toMatch(/classe 6/)
    expect(accountCodeError('CUSTOMER', 'line', '706')).toBeNull()
    expect(accountCodeError('CUSTOMER', 'line', '6064')).toMatch(/classe 7/)
    expect(accountCodeError('CUSTOMER', 'line', 'abc')).toMatch(/pas un numéro de compte/)
  })
})
