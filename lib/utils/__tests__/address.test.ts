/**
 * Address helpers: the one-line address of the PDF headers (formatAddress),
 * the empty address of the forms and the French messages of addressSchema.
 */

import { describe, expect, it } from 'vitest'
import { addressSchema, createEmptyAddress, formatAddress } from '@/lib/utils/address'

describe('formatAddress', () => {
  it('joins street, complement and postal code with city, without the country for France', () => {
    expect(formatAddress({ street: '12 rue des Lilas', street2: 'Bâtiment B', postalCode: '69003', city: 'Lyon', country: 'FR' })).toBe(
      '12 rue des Lilas, Bâtiment B, 69003 Lyon',
    )
    expect(formatAddress({ street: '5 avenue Foch', postalCode: '75116', city: 'Paris', country: 'FR' })).toBe('5 avenue Foch, 75116 Paris')
  })

  it('adds the country code, upper case, outside France', () => {
    expect(formatAddress({ street: 'Rue Neuve 1', postalCode: '1000', city: 'Bruxelles', country: 'be' })).toBe('Rue Neuve 1, 1000 Bruxelles, BE')
  })

  it('skips the missing parts', () => {
    expect(formatAddress({ street: '', postalCode: '', city: 'Lyon', country: 'FR' })).toBe('Lyon')
    expect(formatAddress({ street: 'Lieu-dit Les Granges', postalCode: '', city: '', country: '' })).toBe('Lieu-dit Les Granges')
    expect(formatAddress(createEmptyAddress())).toBe('')
  })

  it('is empty without an address', () => {
    expect(formatAddress(null)).toBe('')
    expect(formatAddress(undefined)).toBe('')
  })
})

describe('createEmptyAddress', () => {
  it('starts in France unless another country is given', () => {
    expect(createEmptyAddress()).toEqual({ street: '', postalCode: '', city: '', country: 'FR' })
    expect(createEmptyAddress('BE').country).toBe('BE')
  })
})

describe('addressSchema', () => {
  it('requires street, postal code, city and a two-letter country, with French messages', () => {
    const result = addressSchema.safeParse({ street: '', postalCode: '', city: '', country: 'FRA' })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.message)).toEqual([
      'La rue est requise',
      'Le code postal est requis',
      'La ville est requise',
      'Le code pays doit contenir 2 caractères (ISO 3166-1 alpha-2)',
    ])
    expect(addressSchema.parse({ street: '1 rue A', postalCode: '69001', city: 'Lyon', country: 'FR' })).toEqual({
      street: '1 rue A',
      postalCode: '69001',
      city: 'Lyon',
      country: 'FR',
    })
  })
})
