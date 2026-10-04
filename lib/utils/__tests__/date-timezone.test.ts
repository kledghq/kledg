/**
 * Accounting dates are calendar days stored at midnight UTC. Period filters
 * and fiscal year arithmetic must give the same days whatever the server
 * timezone: an entry dated 31/12 never falls into the next year.
 *
 * Runs each check under UTC+14 (Pacific/Kiritimati), UTC-8/-7
 * (America/Los_Angeles) and UTC. Node applies a change of process.env.TZ
 * immediately.
 */

import { afterAll, describe, expect, it } from 'vitest'
import {
  addUtcDays,
  endOfDay,
  normalizeDate,
  startOfDay,
  utcDate,
  utcDaysInclusive,
} from '../date'
import { buildDepreciationPlan, sumPlanForPeriod } from '@/lib/fixed-assets/depreciation-plan'

const ORIGINAL_TZ = process.env.TZ
const ZONES = ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe.each(ZONES)('calendar dates with TZ=%s', (zone) => {
  const useZone = () => {
    process.env.TZ = zone
  }

  it('runs in the requested timezone', () => {
    useZone()
    const offset = new Date(Date.UTC(2025, 11, 31)).getTimezoneOffset()
    if (zone === 'Pacific/Kiritimati') expect(offset).toBe(-14 * 60)
    if (zone === 'America/Los_Angeles') expect(offset).toBe(8 * 60)
    if (zone === 'UTC') expect(offset).toBe(0)
  })

  it('keeps 31/12 on the 31st, whether given as an ISO day or a stored date', () => {
    useZone()
    const stored = new Date('2025-12-31T00:00:00.000Z')
    expect(normalizeDate('2025-12-31').toISOString()).toBe('2025-12-31T00:00:00.000Z')
    expect(normalizeDate(stored).toISOString()).toBe('2025-12-31T00:00:00.000Z')
    expect(startOfDay(stored).toISOString()).toBe('2025-12-31T00:00:00.000Z')
    expect(endOfDay(stored).toISOString()).toBe('2025-12-31T23:59:59.999Z')
  })

  it('filters a fiscal year so that 31/12 is in it and 01/01 of the next year is not', () => {
    useZone()
    const fyStart = utcDate(2025, 1, 1)
    const fyEnd = utcDate(2025, 12, 31)
    const from = startOfDay(fyStart)
    const to = endOfDay(fyEnd)
    const inPeriod = (d: Date) => d >= from && d <= to
    expect(inPeriod(new Date('2025-12-31T00:00:00.000Z'))).toBe(true)
    expect(inPeriod(new Date('2025-01-01T00:00:00.000Z'))).toBe(true)
    expect(inPeriod(new Date('2026-01-01T00:00:00.000Z'))).toBe(false)
    expect(inPeriod(new Date('2024-12-31T00:00:00.000Z'))).toBe(false)
  })

  it('does day arithmetic on calendar days', () => {
    useZone()
    expect(addUtcDays(utcDate(2025, 12, 31), 1).toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(addUtcDays(utcDate(2024, 3, 1), -1).toISOString()).toBe('2024-02-29T00:00:00.000Z')
    expect(utcDaysInclusive(utcDate(2025, 1, 1), utcDate(2025, 12, 31))).toBe(365)
    expect(utcDaysInclusive(utcDate(2024, 1, 1), utcDate(2024, 12, 31))).toBe(366)
  })

  it('computes the same depreciation for a fiscal year', () => {
    useZone()
    const plan = buildDepreciationPlan({
      acquisitionValue: 3650,
      amortizableAmount: 3650,
      depreciationMethod: 'linear',
      depreciationRate: null,
      depreciationDuration: 5,
      decliningCoefficient: null,
      depreciationStartDate: new Date('2025-07-01T00:00:00.000Z'),
    })
    // 184 days in service out of 365: 3650 x 20 % x 184 / 365 = 368.00
    expect(sumPlanForPeriod(plan, utcDate(2025, 1, 1), utcDate(2025, 12, 31))).toBe(368)
    expect(sumPlanForPeriod(plan, utcDate(2026, 1, 1), utcDate(2026, 12, 31))).toBe(730)
  })
})
