import { describe, expect, it } from 'vitest'

import { currentStatementPeriod, isStatementMonth } from '../statement-period'

describe('currentStatementPeriod', () => {
  it('runs from January to the current month of the current year', () => {
    expect(currentStatementPeriod(new Date(Date.UTC(2026, 9, 3)))).toEqual({ from: '01-2026', to: '10-2026' })
    expect(currentStatementPeriod(new Date(Date.UTC(2026, 0, 15)))).toEqual({ from: '01-2026', to: '01-2026' })
  })

  it('reads the month in UTC', () => {
    // 31 December 23:30 UTC is still December, whatever the server time zone.
    expect(currentStatementPeriod(new Date(Date.UTC(2025, 11, 31, 23, 30)))).toEqual({ from: '01-2025', to: '12-2025' })
  })
})

describe('isStatementMonth', () => {
  it('accepts complete mm-yyyy months only', () => {
    expect(isStatementMonth('03-2026')).toBe(true)
    expect(isStatementMonth(' 12-2025 ')).toBe(true)
    expect(isStatementMonth('3-2026')).toBe(false)
    expect(isStatementMonth('13-2026')).toBe(false)
    expect(isStatementMonth('03-20')).toBe(false)
    expect(isStatementMonth('')).toBe(false)
  })
})
