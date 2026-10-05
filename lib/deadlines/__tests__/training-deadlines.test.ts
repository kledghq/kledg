/**
 * Deadlines of training organisations and of the taxe sur les salaires in
 * the calendar: the BPF of each fiscal year before 30 April of the year
 * after its closing (Code du travail R6352-23), the relevés 2501 and the
 * declaration 2502 of the years whose tax is due (CGI art. 231; ann. III
 * art. 369; BOI-TPS-TS-40).
 */

import { describe, expect, it } from 'vitest'
import { computeDeadlines, type DeadlineInput } from '../engine'
import { DEFAULT_DEADLINE_SETTINGS } from '../settings'

const base: DeadlineInput = {
  company: { legalType: 'SAS', vatRegime: null, isVatExempt: true, corporateTaxRegime: null, foundationDate: null, regimeHistory: [] },
  fiscalYears: [{ id: 'fy25', startDate: '2025-01-01', endDate: '2025-12-31' }],
  settings: DEFAULT_DEADLINE_SETTINGS,
  from: '2026-01-01',
  to: '2027-01-31',
}

const of = (input: DeadlineInput, category: string) => computeDeadlines(input).filter((d) => d.category === category)

describe('bilan pédagogique et financier', () => {
  it('is listed only for a training organisation, before 30 April, with the 2026 extension', () => {
    expect(of(base, 'formation')).toEqual([])
    const [bpf] = of({ ...base, trainingOrganisation: true }, 'formation')
    expect(bpf).toMatchObject({ id: 'bpf:2025-12-31', date: '2026-04-29', extendedDate: '2026-05-31', form: 'BPF (cerfa 10443)', label: 'Bilan pédagogique et financier de l\'exercice clos le 31/12/2025' })
  })
})

describe('taxe sur les salaires', () => {
  it('lists the quarterly relevés and the 2502 of a liable year, nothing for a year not due', () => {
    const quarterly = of({ ...base, payrollTax: { 2026: { liable: true, frequency: 'quarterly' }, 2025: { liable: false, frequency: 'annual' } } }, 'salaires')
    expect(quarterly.map((d) => [d.id, d.date])).toEqual([
      ['ts-releve:2026-T1', '2026-04-15'],
      ['ts-releve:2026-T2', '2026-07-15'],
      ['ts-releve:2026-T3', '2026-10-15'],
      ['ts-2502:2026', '2027-01-15'],
    ])
    expect(quarterly[3].extendedDate).toBe('2027-01-31')
  })

  it('lists eleven monthly relevés, none for December', () => {
    const monthly = of({ ...base, payrollTax: { 2026: { liable: true, frequency: 'monthly' } } }, 'salaires')
    expect(monthly.filter((d) => d.ruleId === 'ts-releve')).toHaveLength(11)
    expect(monthly.find((d) => d.id === 'ts-releve:2026-11')?.date).toBe('2026-12-15')
  })
})
