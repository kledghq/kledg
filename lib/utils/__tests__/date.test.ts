/**
 * Tests for date utilities
 */

import { describe, it, expect } from 'vitest'
import {
  formatDate,
  formatDateTime,
  formatDateShort,
  addIsoDays,
  lastDayOfMonth,
} from '../date'

describe('formatDate', () => {
  it('should format date in French format', () => {
    const date = new Date('2024-01-15')
    expect(formatDate(date)).toContain('15/01/2024')
  })

  it('should format date from string', () => {
    expect(formatDate('2024-01-15')).toContain('15/01/2024')
  })

  it('should format date with custom options', () => {
    const date = new Date('2024-01-15')
    expect(formatDate(date, { year: 'numeric', month: 'long' })).toContain('janvier')
  })
})

describe('formatDateTime', () => {
  it('should format date with time', () => {
    const date = new Date('2024-01-15T14:30:00')
    const formatted = formatDateTime(date)
    expect(formatted).toContain('15/01/2024')
    expect(formatted).toContain('14:30')
  })
})

describe('formatDateShort', () => {
  it('should format date in short format', () => {
    const date = new Date('2024-01-15')
    expect(formatDateShort(date)).toContain('15/01/2024')
  })
})

describe('lastDayOfMonth', () => {
  it('gives the number of days of each month, leap years included', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => lastDayOfMonth(2025, m))).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ])
    expect(lastDayOfMonth(2024, 2)).toBe(29)
    expect(lastDayOfMonth(2000, 2)).toBe(29)
    expect(lastDayOfMonth(2100, 2)).toBe(28)
  })
})

describe('addIsoDays', () => {
  it('moves an ISO day across months, years and leap days', () => {
    expect(addIsoDays('2025-12-31', 1)).toBe('2026-01-01')
    expect(addIsoDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addIsoDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addIsoDays('2025-02-28', 1)).toBe('2025-03-01')
    expect(addIsoDays('2025-03-01', -31)).toBe('2025-01-29')
    expect(addIsoDays('2025-06-15', 0)).toBe('2025-06-15')
  })

  // Replaces the local addDay / nextDay helpers of the company wizard and the FEC import plan.
  it('gives the same day as the helpers it replaced', () => {
    const oldAddDay = (iso: string) => {
      const [y, m, d] = iso.split('-').map(Number)
      return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
    }
    let day = '1999-01-01'
    for (let i = 0; i < 12000; i++) {
      expect(addIsoDays(day, 1)).toBe(oldAddDay(day))
      day = oldAddDay(day)
    }
  })
})
