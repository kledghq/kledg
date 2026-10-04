/**
 * Size categories (lib/approval/size.ts). Source: C. com. D123-200 and
 * D230-1 (décret n° 2024-152): micro 450 000 € / 900 000 € / 10, petite
 * 7 500 000 € / 15 000 000 € / 50, moyenne 25 000 000 € / 50 000 000 € /
 * 250; two of three thresholds; two consecutive years (L123-16, L230-1).
 */

import { describe, expect, it } from 'vitest'
import { categoryOfYear, proposeCategory, SIZE_THRESHOLDS } from '../size'

const year = (assets: number, revenue: number, employees: number | null) => ({ totalAssetsCents: assets * 100, revenueCents: revenue * 100, employees })

describe('size categories (D123-200)', () => {
  it('uses the thresholds of décret n° 2024-152', () => {
    expect(SIZE_THRESHOLDS.micro).toEqual({ totalAssetsCents: 45_000_000, revenueCents: 90_000_000, employees: 10 })
    expect(SIZE_THRESHOLDS.small).toEqual({ totalAssetsCents: 750_000_000, revenueCents: 1_500_000_000, employees: 50 })
    expect(SIZE_THRESHOLDS.medium).toEqual({ totalAssetsCents: 2_500_000_000, revenueCents: 5_000_000_000, employees: 250 })
  })

  it('stays in a category while at most one threshold is exceeded', () => {
    expect(categoryOfYear(year(450_000, 900_000, 10))).toBe('micro')
    expect(categoryOfYear(year(600_000, 800_000, 5))).toBe('micro')
    expect(categoryOfYear(year(600_000, 950_000, 5))).toBe('small')
    expect(categoryOfYear(year(8_000_000, 16_000_000, 40))).toBe('medium')
    expect(categoryOfYear(year(30_000_000, 60_000_000, 300))).toBe('large')
  })

  it('counts an unknown headcount as exceeded (cautious)', () => {
    expect(categoryOfYear(year(100_000, 200_000, null))).toBe('micro')
    expect(categoryOfYear(year(600_000, 200_000, null))).toBe('small')
  })

  it('proposes the larger category when two years differ, and asks to confirm', () => {
    expect(proposeCategory(year(100_000, 200_000, 3), year(100_000, 200_000, 3))).toEqual({ category: 'micro', certain: true })
    expect(proposeCategory(year(600_000, 950_000, 3), year(100_000, 200_000, 3))).toEqual({ category: 'small', certain: false })
    expect(proposeCategory(year(100_000, 200_000, 3), null)).toEqual({ category: 'micro', certain: false })
  })
})
