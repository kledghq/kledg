import { describe, expect, it } from 'vitest'

import { compactEuros } from '../chart-format'

describe('compactEuros', () => {
  it('rounds to the euro below 1 000', () => {
    expect(compactEuros(0)).toBe('0 €')
    expect(compactEuros(999.4)).toBe('999 €')
    expect(compactEuros(-250.6)).toBe('-251 €')
  })

  it('rounds to the thousand from 1 000, negative values included', () => {
    expect(compactEuros(1000)).toBe('1 k€')
    expect(compactEuros(12_499)).toBe('12 k€')
    expect(compactEuros(12_500)).toBe('13 k€')
    expect(compactEuros(-48_200)).toBe('-48 k€')
  })
})
