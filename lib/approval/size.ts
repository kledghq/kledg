/**
 * Size categories of a company (micro, petite, moyenne, grande), which decide
 * the management report exemption (C. com. L232-1 IV) and the confidentiality
 * options at filing (L232-25). Pure, amounts in cents.
 *
 * Thresholds of décret n° 2024-152 (C. com. D123-200 and D230-1), for fiscal
 * years opened from 1 January 2024: a company belongs to a category when it
 * does not exceed two of the three thresholds (total du bilan, chiffre
 * d'affaires net, average headcount). A change of category only counts when
 * it holds for two consecutive fiscal years (L123-16, L123-16-1, D230-1).
 * Categories are exclusive (L230-1).
 *
 * Kledg reads the balance sheet total and the revenue from the books; the
 * headcount is not in the books and is asked. The category is a proposal:
 * the user confirms it, since an earlier year may keep the company in its
 * previous category.
 */

export const SIZE_CATEGORIES = ['micro', 'small', 'medium', 'large'] as const
export type SizeCategory = (typeof SIZE_CATEGORIES)[number]

export const SIZE_LABELS: Record<SizeCategory, string> = {
  micro: 'Micro-entreprise',
  small: 'Petite entreprise',
  medium: 'Moyenne entreprise',
  large: 'Grande entreprise',
}

interface Thresholds {
  totalAssetsCents: number
  revenueCents: number
  employees: number
}

/** D123-200 / D230-1 (décret n° 2024-152 du 28 février 2024). */
export const SIZE_THRESHOLDS: Record<Exclude<SizeCategory, 'large'>, Thresholds> = {
  micro: { totalAssetsCents: 45_000_000, revenueCents: 90_000_000, employees: 10 },
  small: { totalAssetsCents: 750_000_000, revenueCents: 1_500_000_000, employees: 50 },
  medium: { totalAssetsCents: 2_500_000_000, revenueCents: 5_000_000_000, employees: 250 },
}

export interface YearSize {
  totalAssetsCents: number
  revenueCents: number
  /** Average headcount; null when unknown (then two of the two known figures must stay below). */
  employees: number | null
}

/** Whether a year stays within a set of thresholds: no more than one of the three exceeded. */
function within(year: YearSize, t: Thresholds): boolean {
  let exceeded = 0
  if (year.totalAssetsCents > t.totalAssetsCents) exceeded++
  if (year.revenueCents > t.revenueCents) exceeded++
  if (year.employees === null) return exceeded === 0
  if (year.employees > t.employees) exceeded++
  return exceeded <= 1
}

/** The category of one fiscal year taken alone. */
export function categoryOfYear(year: YearSize): SizeCategory {
  if (within(year, SIZE_THRESHOLDS.micro)) return 'micro'
  if (within(year, SIZE_THRESHOLDS.small)) return 'small'
  if (within(year, SIZE_THRESHOLDS.medium)) return 'medium'
  return 'large'
}

const RANK: Record<SizeCategory, number> = { micro: 0, small: 1, medium: 2, large: 3 }

/**
 * Proposed category from the year and the previous one: the same category
 * both years is certain; otherwise the larger of the two is proposed (the
 * cautious reading) with `certain: false`, and the user confirms.
 */
export function proposeCategory(current: YearSize, previous: YearSize | null): { category: SizeCategory; certain: boolean } {
  const now = categoryOfYear(current)
  if (!previous) return { category: now, certain: false }
  const before = categoryOfYear(previous)
  if (now === before) return { category: now, certain: current.employees !== null && previous.employees !== null }
  return { category: RANK[now] > RANK[before] ? now : before, certain: false }
}
