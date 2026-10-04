/**
 * Dates proposed for a new fiscal year (Code de commerce art. L123-12: the
 * accounts are drawn up at the closing of each 12-month fiscal year, which
 * starts the day after the previous closing).
 */

import { describe, expect, it } from 'vitest'
import { closingDayIn, defaultFiscalYearDates } from '../default-fiscal-year-dates'

describe('closingDayIn', () => {
  it('defaults to 31 December', () => {
    expect(closingDayIn(2026, null, null)).toBe('2026-12-31')
  })

  it('clamps the closing day to the length of the month', () => {
    expect(closingDayIn(2026, 29, 2)).toBe('2026-02-28')
    expect(closingDayIn(2028, 29, 2)).toBe('2028-02-29')
    // Closing month known, day missing: the last day of that month, not the 1st of the next
    expect(closingDayIn(2026, null, 9)).toBe('2026-09-30')
  })
})

describe('defaultFiscalYearDates', () => {
  it('runs from the day after the previous closing to the closing day', () => {
    expect(defaultFiscalYearDates({ year: 2026, closingDay: 31, closingMonth: 12, isFirstFiscalYear: false })).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    })
    expect(defaultFiscalYearDates({ year: 2026, closingDay: 30, closingMonth: 6, isFirstFiscalYear: false })).toEqual({
      startDate: '2025-07-01',
      endDate: '2026-06-30',
    })
  })

  it('handles a 29 February closing across common and leap years', () => {
    expect(defaultFiscalYearDates({ year: 2026, closingDay: 29, closingMonth: 2, isFirstFiscalYear: false })).toEqual({
      startDate: '2025-03-01',
      endDate: '2026-02-28',
    })
    expect(defaultFiscalYearDates({ year: 2029, closingDay: 29, closingMonth: 2, isFirstFiscalYear: false })).toEqual({
      startDate: '2028-03-01',
      endDate: '2029-02-28',
    })
  })

  it('starts the first fiscal year at the foundation date, as a calendar day', () => {
    expect(
      defaultFiscalYearDates({ year: 2026, closingDay: 31, closingMonth: 12, foundationDate: '2026-03-15T00:00:00.000Z', isFirstFiscalYear: true }),
    ).toEqual({ startDate: '2026-03-15', endDate: '2026-12-31' })
    // Not the first fiscal year: the foundation date is ignored
    expect(
      defaultFiscalYearDates({ year: 2027, closingDay: 31, closingMonth: 12, foundationDate: '2026-03-15T00:00:00.000Z', isFirstFiscalYear: false }),
    ).toEqual({ startDate: '2027-01-01', endDate: '2027-12-31' })
    // First fiscal year without a foundation date: the usual start
    expect(defaultFiscalYearDates({ year: 2026, closingDay: 31, closingMonth: 12, foundationDate: null, isFirstFiscalYear: true })).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    })
  })
})
