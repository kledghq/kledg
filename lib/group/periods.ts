/**
 * Which fiscal year of a company of the group is read for a period of the
 * holding, and percentages of ownership. Pure.
 *
 * Companies of a group usually close on the same day, but nothing forces
 * them to. For the holding's fiscal year [start, end], a company's fiscal
 * year that ends the same day is taken; otherwise the one that overlaps the
 * period the most (the later one on a tie). The view says when the periods
 * differ instead of leaving the company out silently.
 */

export interface YearSpan {
  id: string
  startDate: Date
  endDate: Date
}

const DAY = 86_400_000

function overlapDays(year: YearSpan, start: Date, end: Date): number {
  const from = Math.max(year.startDate.getTime(), start.getTime())
  const to = Math.min(year.endDate.getTime(), end.getTime())
  return to < from ? 0 : Math.round((to - from) / DAY) + 1
}

export function pickFiscalYear<T extends YearSpan>(years: readonly T[], start: Date, end: Date): T | null {
  const sameEnd = years.find((y) => y.endDate.getTime() === end.getTime())
  if (sameEnd) return sameEnd
  let best: { year: T; days: number } | null = null
  for (const year of years) {
    const days = overlapDays(year, start, end)
    if (days > 0 && (!best || days > best.days || (days === best.days && year.endDate > best.year.endDate))) best = { year, days }
  }
  return best?.year ?? null
}

/** Whether a company's fiscal year covers exactly the holding's period. */
export function samePeriod(year: YearSpan, start: Date, end: Date): boolean {
  return year.startDate.getTime() === start.getTime() && year.endDate.getTime() === end.getTime()
}

/** A recorded percentage ("60.00", "33.3") in basis points (6000, 3330). */
export function percentToBp(value: string): number {
  const match = /^(\d{1,3})(?:[.,](\d{0,2})\d*)?$/.exec(value.trim())
  if (!match) return 0
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}

/** Share of an amount for a percentage in basis points, rounded half up to the cent. */
export function shareOfCents(cents: number, bp: number): number {
  const sign = cents < 0 ? -1 : 1
  return sign * Math.floor((Math.abs(cents) * bp + 5_000) / 10_000)
}

export type ParticipationKind = 'filiale' | 'participation' | 'autre'

/**
 * Code de commerce, art. L233-1: a company holding more than half of the
 * capital of another is its parent (filiale); art. L233-2: a holding of 10 %
 * to 50 % is a participation. The 2059-G-SD and 2033-G-SD forms list them
 * in those two groups.
 */
export function participationKindOf(bp: number): ParticipationKind {
  if (bp > 5000) return 'filiale'
  if (bp >= 1000) return 'participation'
  return 'autre'
}
