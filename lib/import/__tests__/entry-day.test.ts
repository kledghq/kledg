/**
 * The day of an imported CSV or Excel entry (lib/import/entry-day.ts, #130):
 * read day first as French files write it, never through `new Date(text)`.
 */

import { describe, expect, it } from 'vitest'
import { importEntryDay } from '../entry-day'

const iso = (value: unknown) => importEntryDay(value)?.toISOString().slice(0, 10) ?? null

describe('importEntryDay', () => {
  it('reads French days day first, where new Date reads them month first or not at all', () => {
    expect(iso('05/03/2026')).toBe('2026-03-05')
    expect(iso('31/03/2026')).toBe('2026-03-31')
    expect(iso('5.3.26')).toBe('2026-03-05')
  })

  it('reads ISO and compact days, dropping a time', () => {
    expect(iso('2026-03-05')).toBe('2026-03-05')
    expect(iso('2026-03-05T23:30:00+01:00')).toBe('2026-03-05')
    expect(iso('20260305')).toBe('2026-03-05')
  })

  it('reads Excel date cells and serial numbers', () => {
    expect(iso(new Date(Date.UTC(2026, 2, 5)))).toBe('2026-03-05')
    // 46086 is 5 March 2026 in Excel
    expect(iso(46086)).toBe('2026-03-05')
  })

  it('refuses what is not a day', () => {
    expect(iso('31/02/2026')).toBeNull()
    expect(iso('')).toBeNull()
    expect(iso('demain')).toBeNull()
    expect(iso(null)).toBeNull()
  })
})
