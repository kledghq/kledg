/**
 * Accounting treatment of changes of method, changes of estimate and
 * corrections of errors (règlement ANC 2014-03, PCG version of 1 January
 * 2026, art. 122-1 to 122-6) and the catch-up entry Kledg prepares.
 */

import { describe, expect, it } from 'vitest'
import { allowedTreatments, changeEntryLines, counterpartError, defaultTreatment, netImpactCents, treatmentError } from '../methods/rules'

const balanced = (lines: Array<{ debitCents: number; creditCents: number }>) => lines.reduce((s, l) => s + l.debitCents - l.creditCents, 0) === 0

describe('treatments allowed by the PCG', () => {
  it('a change of method goes to report à nouveau by default, to the result under tax rules, prospective when not computable (art. 122-3)', () => {
    expect(defaultTreatment('METHOD_CHANGE')).toBe('EQUITY')
    expect(allowedTreatments('METHOD_CHANGE')).toEqual(['EQUITY', 'RESULT', 'PROSPECTIVE'])
    expect(allowedTreatments('REGULATION_CHANGE')).toEqual(['EQUITY', 'RESULT', 'PROSPECTIVE'])
  })

  it('a change of estimate is always prospective (art. 122-5)', () => {
    expect(allowedTreatments('ESTIMATE_CHANGE')).toEqual(['PROSPECTIVE'])
    expect(treatmentError('ESTIMATE_CHANGE', 'EQUITY')).toMatch(/122-5/)
  })

  it('a correction of error goes to the result, or to report à nouveau when it corrects an entry booked in equity (art. 122-6)', () => {
    expect(defaultTreatment('ERROR_CORRECTION')).toBe('RESULT')
    expect(treatmentError('ERROR_CORRECTION', 'EQUITY')).toBeNull()
    expect(treatmentError('ERROR_CORRECTION', 'PROSPECTIVE')).toMatch(/122-6/)
  })

  it('the adjusted account is a balance sheet account, never report à nouveau or the result', () => {
    expect(counterpartError('310000')).toBeNull()
    expect(counterpartError('151100')).toBeNull()
    expect(counterpartError('110000')).toMatch(/report à nouveau/)
    expect(counterpartError('607000')).toMatch(/classes 1 à 5/)
  })
})

describe('catch-up entry', () => {
  it('stocks revalued upwards by 10 000 €, 2 500 € of tax: report à nouveau credited of the impact after tax (art. 122-3)', () => {
    const lines = changeEntryLines({ kind: 'METHOD_CHANGE', treatment: 'EQUITY', label: 'CMUP', impactCents: 1_000_000, taxCents: 250_000, accountCode: '310000' }, 'Stocks')!
    expect(lines).toEqual([
      { code: '310000', label: 'Stocks', debitCents: 1_000_000, creditCents: 0 },
      { code: '444', label: 'État - Impôts sur les bénéfices', debitCents: 0, creditCents: 250_000 },
      { code: '110', label: 'Report à nouveau - solde créditeur', debitCents: 0, creditCents: 750_000 },
    ])
    expect(balanced(lines)).toBe(true)
    expect(netImpactCents(1_000_000, 250_000)).toBe(750_000)
  })

  it('a provision omitted last year, 3 000 €: exceptional charge 678 of the year it is found (art. 122-6, 821-2)', () => {
    const lines = changeEntryLines({ kind: 'ERROR_CORRECTION', treatment: 'RESULT', label: 'Provision omise', impactCents: -300_000, taxCents: 75_000, accountCode: '151100' }, 'Provisions pour litiges')!
    // The tax of a correction in the result is carried by the corporate tax of the year: no 444 line
    expect(lines).toEqual([
      { code: '151100', label: 'Provisions pour litiges', debitCents: 0, creditCents: 300_000 },
      { code: '678', label: 'Autres charges exceptionnelles', debitCents: 300_000, creditCents: 0 },
    ])
    expect(netImpactCents(-300_000, 75_000)).toBe(-225_000)
  })

  it('a decrease in equity: report à nouveau débiteur 119', () => {
    const lines = changeEntryLines({ kind: 'METHOD_CHANGE', treatment: 'EQUITY', label: 'Retraites', impactCents: -400_000, taxCents: 100_000, accountCode: '153000' }, 'Provisions pour pensions')!
    expect(lines.map((l) => [l.code, l.debitCents, l.creditCents])).toEqual([
      ['153000', 0, 400_000],
      ['444', 100_000, 0],
      ['119', 300_000, 0],
    ])
    expect(balanced(lines)).toBe(true)
  })

  it('no entry for a prospective change or without impact', () => {
    expect(changeEntryLines({ kind: 'ESTIMATE_CHANGE', treatment: 'PROSPECTIVE', label: 'Durée', impactCents: 100, taxCents: 0, accountCode: '281830' }, '')).toBeNull()
    expect(changeEntryLines({ kind: 'METHOD_CHANGE', treatment: 'EQUITY', label: 'x', impactCents: 0, taxCents: 0, accountCode: '310000' }, '')).toBeNull()
  })
})
