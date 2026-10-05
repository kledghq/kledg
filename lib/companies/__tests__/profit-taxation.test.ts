import { describe, expect, it } from 'vitest'
import { corporateTaxRegimeOn, profitTaxationOf } from '../profit-taxation'

const physical = [{ type: 'PHYSICAL' as const }]
const legal = [{ type: 'LEGAL' as const }]

describe('profitTaxationOf (CGI art. 8 and 206)', () => {
  it('reads a recorded regime first', () => {
    expect(profitTaxationOf({ legalType: 'EURL', regime: 'simplified', shareholders: physical })).toMatchObject({ taxation: 'IS', basis: 'regime' })
    expect(profitTaxationOf({ legalType: 'SARL', regime: 'income_tax', shareholders: [] })).toMatchObject({ taxation: 'IR', micro: false, basis: 'regime' })
    expect(profitTaxationOf({ legalType: 'EI', regime: 'micro', shareholders: [] })).toMatchObject({ taxation: 'IR', micro: true })
  })

  it('defaults an EURL whose sole associé is a natural person to IR (CGI art. 8, 4°), a legal person to IS', () => {
    expect(profitTaxationOf({ legalType: 'EURL', regime: null, shareholders: physical })).toMatchObject({ taxation: 'IR', basis: 'legal-form' })
    expect(profitTaxationOf({ legalType: 'EURL', regime: null, shareholders: legal })).toMatchObject({ taxation: 'IS', basis: 'legal-form' })
  })

  it('does not guess an EURL without a recorded associé', () => {
    const t = profitTaxationOf({ legalType: 'EURL', regime: null, shareholders: [] })
    expect(t.taxation).toBe('unknown')
    expect(t.explanation).toContain('Régimes fiscaux')
  })

  it('defaults SAS, SASU, SA and SARL to IS, sociétés de personnes and EI to IR', () => {
    for (const form of ['SAS', 'SASU', 'SA', 'SARL']) expect(profitTaxationOf({ legalType: form, regime: null, shareholders: physical }).taxation).toBe('IS')
    for (const form of ['EI', 'SNC']) expect(profitTaxationOf({ legalType: form, regime: null, shareholders: physical }).taxation).toBe('IR')
  })

  it('is unknown without legal form nor regime', () => {
    expect(profitTaxationOf({ legalType: null, regime: null, shareholders: [] }).taxation).toBe('unknown')
  })
})

describe('corporateTaxRegimeOn', () => {
  const history = [
    { regime: 'income_tax', startDate: '2024-01-01', endDate: '2025-12-31' },
    { regime: 'simplified', startDate: '2026-01-01', endDate: null },
    { regime: 'normal', startDate: '2020-01-01', endDate: null, establishmentId: 'est' },
  ]
  it('takes the company-wide row covering the day, else the company field', () => {
    expect(corporateTaxRegimeOn('2025-06-30', history, null)).toBe('income_tax')
    expect(corporateTaxRegimeOn('2026-03-01', history, null)).toBe('simplified')
    expect(corporateTaxRegimeOn('2021-03-01', history, 'micro')).toBe('micro')
  })
})
