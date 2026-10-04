import { describe, expect, it } from 'vitest'
import { formatVatRate, vatLineDescription } from '../entry-line-calculator'

describe('French labels of generated VAT lines', () => {
  it('formats rates with a comma and a regular space before %', () => {
    expect(formatVatRate(20)).toBe('20 %')
    expect(formatVatRate(5.5)).toBe('5,5 %')
    expect(formatVatRate(2.1)).toBe('2,1 %')
    expect(formatVatRate(null)).toBe('')
  })

  it.each([
    ['deductible', 20, undefined, 'TVA déductible 20 %'],
    ['collectible', 20, undefined, 'TVA collectée 20 %'],
    ['collectible', 5.5, undefined, 'TVA collectée 5,5 %'],
    ['intracom', 20, 'deductible', 'TVA intracommunautaire déductible 20 %'],
    ['intracom', 20, 'due', 'TVA intracommunautaire due 20 %'],
    ['import', 20, 'due', "TVA à l'import due 20 %"],
    ['deductible', null, undefined, 'TVA déductible'],
  ] as const)('%s %s %s -> %s', (type, rate, part, expected) => {
    expect(vatLineDescription(type, rate, part)).toBe(expected)
  })

  it('never produces English', () => {
    for (const type of ['deductible', 'collectible', 'intracom', 'import', 'reverse_charge', 'exempt']) {
      expect(vatLineDescription(type, 20)).not.toMatch(/VAT|deductible|collectible/)
    }
  })
})
