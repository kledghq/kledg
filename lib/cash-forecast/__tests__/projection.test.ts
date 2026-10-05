/**
 * Projection of the cash forecast (lib/cash-forecast/projection.ts): the
 * window, the periods by month and by week, the day by day balance, the
 * even split of spread flows, late flows on the first day, the lowest
 * balance and the first day under the threshold. Integer cents only.
 */

import { describe, expect, it } from 'vitest'
import {
  addMonths,
  flowParts,
  forecastPeriods,
  forecastWindow,
  projectCashForecast,
  type CashFlowItem,
  type ProjectionInput,
} from '../projection'
import { DEFAULT_COMPONENTS } from '../components'

const base: ProjectionInput = {
  today: '2026-10-05',
  horizonMonths: 3,
  granularity: 'month',
  openingCents: 1_000_000,
  items: [],
  components: [...DEFAULT_COMPONENTS],
  thresholdCents: null,
}

describe('window and periods', () => {
  it('starts tomorrow and ends the same day of the month N months later, clamped to shorter months', () => {
    expect(forecastWindow('2026-10-05', 3)).toEqual({ start: '2026-10-06', end: '2027-01-05' })
    expect(forecastWindow('2026-08-31', 1)).toEqual({ start: '2026-09-01', end: '2026-09-30' })
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-12-15', 12)).toBe('2027-12-15')
  })

  it('cuts the first and the last month at the window', () => {
    expect(forecastPeriods('2026-10-06', '2027-01-05', 'month')).toEqual([
      { period: '2026-10', start: '2026-10-06', end: '2026-10-31' },
      { period: '2026-11', start: '2026-11-01', end: '2026-11-30' },
      { period: '2026-12', start: '2026-12-01', end: '2026-12-31' },
      { period: '2027-01', start: '2027-01-01', end: '2027-01-05' },
    ])
  })

  it('cuts weeks from Monday to Sunday, keyed by their Monday', () => {
    // 2026-10-06 is a Tuesday
    expect(forecastPeriods('2026-10-06', '2026-10-20', 'week')).toEqual([
      { period: '2026-10-05', start: '2026-10-06', end: '2026-10-11' },
      { period: '2026-10-12', start: '2026-10-12', end: '2026-10-18' },
      { period: '2026-10-19', start: '2026-10-19', end: '2026-10-20' },
    ])
  })
})

describe('flowParts', () => {
  it('splits a spread amount evenly over its days, the parts summing to the amount exactly', () => {
    const parts = flowParts({ component: 'budget', label: 'x', day: '2026-11-01', until: '2026-11-30', amountCents: -100_001 })
    expect(parts).toHaveLength(30)
    expect(parts.reduce((sum, p) => sum + p.cents, 0)).toBe(-100_001)
    expect(new Set(parts.map((p) => Math.abs(p.cents)))).toEqual(new Set([3333, 3334]))
    expect(parts[0].day).toBe('2026-11-01')
    expect(parts[29].day).toBe('2026-11-30')
  })

  it('keeps a dated flow whole', () => {
    expect(flowParts({ component: 'taxes', label: 'TVA', day: '2026-11-19', amountCents: -250_000 })).toEqual([{ day: '2026-11-19', cents: -250_000 }])
  })
})

describe('projectCashForecast', () => {
  const items: CashFlowItem[] = [
    { component: 'receivables', label: 'Studio Nord', day: '2026-09-20', amountCents: 120_000, overdue: true },
    { component: 'taxes', label: 'TVA de septembre', day: '2026-10-19', amountCents: -900_000 },
    { component: 'receivables', label: 'Atelier Sud', day: '2026-10-30', amountCents: 500_000 },
    { component: 'payables', label: 'Imprimerie', day: '2026-11-10', amountCents: -300_000 },
    { component: 'budget', label: 'Budget', day: '2026-12-01', until: '2026-12-31', amountCents: -310_000 },
    { component: 'payables', label: 'Après la fenêtre', day: '2027-02-01', amountCents: -999_999 },
  ]

  it('adds each flow on its day, a late one on the first day, and nothing after the window', () => {
    const p = projectCashForecast({ ...base, items })
    expect(p.start).toBe('2026-10-06')
    const october = p.periods[0]
    expect(october).toMatchObject({ period: '2026-10', openingCents: 1_000_000, inflowsCents: 620_000, outflowsCents: -900_000, closingCents: 720_000 })
    expect(october.byComponent).toEqual({ receivables: 620_000, taxes: -900_000 })
    // The VAT on the 19th dips before the customer pays on the 30th: the lowest of October is inside it.
    expect(october).toMatchObject({ lowestCents: 220_000, lowestDay: '2026-10-19' })
    expect(p.periods[1]).toMatchObject({ period: '2026-11', closingCents: 420_000 })
    // The budget is off by default, the flow after the window is left out.
    expect(p.closingCents).toBe(420_000)
    expect(p.totals.payables).toEqual({ inflowsCents: 0, outflowsCents: -300_000, count: 1 })
    expect(p.totals.budget.count).toBe(0)
  })

  it('counts a spread flow day by day once switched on', () => {
    const p = projectCashForecast({ ...base, items, components: [...DEFAULT_COMPONENTS, 'budget'] })
    const december = p.periods.find((x) => x.period === '2026-12')!
    expect(december.byComponent.budget).toBe(-310_000)
    expect(december.lowestDay).toBe('2026-12-31')
    expect(p.closingCents).toBe(420_000 - 310_000)
  })

  it('gives the first day strictly under the threshold, even when the month ends above it', () => {
    const p = projectCashForecast({ ...base, items, thresholdCents: 300_000 })
    expect(p.firstBelow).toEqual({ day: '2026-10-19', balanceCents: 220_000, period: '2026-10', already: false })
    expect(p.periods[0].belowThreshold).toBe(true)
    expect(p.periods[1].belowThreshold).toBe(false)
    expect(p.lowest).toEqual({ day: '2026-10-19', cents: 220_000 })
  })

  it('does not alert when the balance touches the threshold without going under it', () => {
    expect(projectCashForecast({ ...base, items, thresholdCents: 220_000 }).firstBelow).toBeNull()
  })

  it('says when today’s balance is already under the threshold', () => {
    const p = projectCashForecast({ ...base, openingCents: -5_000, thresholdCents: 0 })
    expect(p.firstBelow).toEqual({ day: '2026-10-05', balanceCents: -5_000, period: null, already: true })
  })

  it('reads the same flows by week', () => {
    const p = projectCashForecast({ ...base, items, granularity: 'week' })
    expect(p.periods[0]).toMatchObject({ period: '2026-10-05', start: '2026-10-06', end: '2026-10-11', inflowsCents: 120_000 })
    expect(p.periods.find((w) => w.start <= '2026-10-19' && w.end >= '2026-10-19')?.outflowsCents).toBe(-900_000)
    expect(p.closingCents).toBe(420_000)
  })

  it('does not depend on the server timezone', () => {
    const previous = process.env.TZ
    const results = ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC'].map((tz) => {
      process.env.TZ = tz
      return projectCashForecast({ ...base, items, granularity: 'week', thresholdCents: 300_000 })
    })
    process.env.TZ = previous
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
  })
})
