import { describe, expect, it } from 'vitest'
import {
  formatIsoDateFr,
  isIsoDate,
  isoDateToLocal,
  isoDateToUtc,
  localDateToIso,
  parseFrenchDate,
  toIsoDateUtc,
} from '../date'

describe('parseFrenchDate', () => {
  it.each([
    ['31/12/2026', '2026-12-31'],
    ['1/2/2026', '2026-02-01'],
    ['01-02-2026', '2026-02-01'],
    ['01.02.2026', '2026-02-01'],
    ['01 02 2026', '2026-02-01'],
    ['01022026', '2026-02-01'],
    ['15/03/26', '2026-03-15'],
    ['2026-03-15', '2026-03-15'],
    ['  29/02/2024 ', '2024-02-29'],
    ['29/02/2000', '2000-02-29'],
  ])('reads %j as %s', (input, iso) => {
    expect(parseFrenchDate(input)).toBe(iso)
  })

  it.each([
    '12/31/2026', // month first (US): refused, never swapped
    '31/13/2026',
    '00/01/2026',
    '32/01/2026',
    '29/02/2025',
    '29/02/1900',
    '31/04/2026',
    '2026-02-30',
    '2026/03/15',
    '1/1/1',
    'demain',
    '',
    '01/01/1899',
  ])('refuses %j', (input) => {
    expect(parseFrenchDate(input)).toBeNull()
  })
})

describe('ISO date helpers', () => {
  it('formats ISO dates the French way', () => {
    expect(formatIsoDateFr('2026-12-31')).toBe('31/12/2026')
    expect(formatIsoDateFr('31/12/2026')).toBe('')
  })

  it('validates ISO dates', () => {
    expect(isIsoDate('2024-02-29')).toBe(true)
    expect(isIsoDate('2023-02-29')).toBe(false)
    expect(isIsoDate('2026-1-1')).toBe(false)
    expect(isIsoDate(20260101)).toBe(false)
  })

  it('reads the calendar day of stored dates in UTC', () => {
    expect(toIsoDateUtc(new Date('2026-03-05T00:00:00.000Z'))).toBe('2026-03-05')
    expect(toIsoDateUtc('2026-03-05T23:30:00.000Z')).toBe('2026-03-05')
    expect(toIsoDateUtc('2026-03-05')).toBe('2026-03-05')
  })

  it('stores ISO dates at midnight UTC', () => {
    expect(isoDateToUtc('2026-12-31').toISOString()).toBe('2026-12-31T00:00:00.000Z')
    expect(() => isoDateToUtc('2026-02-30')).toThrow(RangeError)
  })

  it('converts to and from local dates for date pickers', () => {
    const local = isoDateToLocal('2026-01-01')!
    expect(local.getFullYear()).toBe(2026)
    expect(local.getMonth()).toBe(0)
    expect(local.getDate()).toBe(1)
    expect(localDateToIso(local)).toBe('2026-01-01')
    expect(isoDateToLocal('nope')).toBeUndefined()
  })
})

describe('randomized dates', () => {
  let seed = 424242
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }

  it('round-trips every day through the French format and storage, without drift', () => {
    const start = Date.UTC(1990, 0, 1)
    for (let i = 0; i < 3000; i++) {
      const day = new Date(start + Math.floor(random() * 365 * 80) * 86400000)
      const iso = day.toISOString().slice(0, 10)
      const typed = formatIsoDateFr(iso)
      expect(parseFrenchDate(typed)).toBe(iso)
      expect(parseFrenchDate(typed.replace(/\//g, ''))).toBe(iso)
      expect(toIsoDateUtc(isoDateToUtc(iso))).toBe(iso)
      expect(localDateToIso(isoDateToLocal(iso)!)).toBe(iso)
    }
  })

  it('accepts a day/month pair only when it is a real date', () => {
    for (let i = 0; i < 3000; i++) {
      const d = 1 + Math.floor(random() * 33)
      const m = 1 + Math.floor(random() * 14)
      const y = 1990 + Math.floor(random() * 60)
      const parsed = parseFrenchDate(`${d}/${m}/${y}`)
      const real = new Date(Date.UTC(y, m - 1, d))
      const exists = real.getUTCFullYear() === y && real.getUTCMonth() === m - 1 && real.getUTCDate() === d
      expect(parsed, `${d}/${m}/${y}`).toBe(exists ? real.toISOString().slice(0, 10) : null)
    }
  })
})
