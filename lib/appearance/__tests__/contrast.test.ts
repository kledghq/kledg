/** WCAG contrast helper (lib/appearance/contrast.ts). Reference values: WCAG 2.2 definitions. */

import { describe, expect, it } from 'vitest'
import { contrastRatio, formatContrastRatio, meetsNonTextContrast, NON_TEXT_MIN_CONTRAST, relativeLuminance } from '../contrast'

describe('contrast', () => {
  it('computes the relative luminance of black, white and a mid gray', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10)
    expect(relativeLuminance('#777777')).toBeCloseTo(0.1845, 3)
  })

  it('gives 21:1 for black on white, 1:1 for a colour on itself, in either order', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#1c7f55', '#1C7F55')).toBe(1)
  })

  it('matches known ratios against white', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    expect(contrastRatio('#949494', '#ffffff')).toBeCloseTo(3.03, 2)
    expect(contrastRatio('#a1a1a1', '#ffffff')).toBeCloseTo(2.58, 2)
  })

  it('applies the 3:1 non-text minimum (WCAG 2.2, 1.4.11)', () => {
    expect(NON_TEXT_MIN_CONTRAST).toBe(3)
    expect(meetsNonTextContrast('#949494', '#ffffff')).toBe(true)
    expect(meetsNonTextContrast('#a1a1a1', '#ffffff')).toBe(false)
    expect(meetsNonTextContrast('#0072b2', '#101010')).toBe(true)
  })

  it('formats in French and never rounds a failing ratio up to 3', () => {
    expect(formatContrastRatio(2.58)).toBe('2,5:1')
    expect(formatContrastRatio(2.999)).toBe('2,9:1')
    expect(formatContrastRatio(21)).toBe('21,0:1')
  })

  it('refuses anything but #rrggbb', () => {
    expect(() => relativeLuminance('red')).toThrow()
    expect(() => relativeLuminance('#fff')).toThrow()
  })
})
