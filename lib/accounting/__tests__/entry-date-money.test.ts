/**
 * Calendar days and exact cents, the two primitives of entry dates and
 * amounts. An entry date is a day of the fiscal year whatever the server
 * timezone; an amount is an exact number of cents (no float drift).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { fecDateOf, parisDayOf, toEntryDate } from '../entry-date'
import { centsToDecimal, centsToFecAmount, parseCents, sumCents } from '@/lib/utils/money'
import { calendarDayOf, normalizeDate } from '@/lib/utils/date'

describe('calendar days', () => {
  const originalTz = process.env.TZ
  afterEach(() => {
    process.env.TZ = originalTz
  })

  it.each(['UTC', 'Europe/Paris', 'Pacific/Kiritimati', 'America/Los_Angeles'])('reads the intended day (TZ=%s)', (tz) => {
    process.env.TZ = tz
    expect(calendarDayOf('2025-12-31')).toBe('2025-12-31')
    expect(calendarDayOf(new Date('2025-12-31'))).toBe('2025-12-31') // midnight UTC
    expect(calendarDayOf(new Date(2025, 11, 31))).toBe('2025-12-31') // local midnight (date picker)
    expect(calendarDayOf('2025-12-31T00:00:00.000Z')).toBe('2025-12-31')
    // Local midnight stored by a server in Paris, read anywhere
    expect(calendarDayOf(new Date('2025-12-30T23:00:00.000Z'))).toBe('2025-12-31')
    expect(toEntryDate('2025-12-31').toISOString()).toBe('2025-12-31T00:00:00.000Z')
    expect(fecDateOf(new Date('2026-01-01T00:00:00Z'))).toBe('20260101')
  })

  it('reads 31/12 the same way in normalizeDate and toEntryDate in Los Angeles (it used to move to 30/12)', () => {
    process.env.TZ = 'America/Los_Angeles'
    expect(normalizeDate(new Date('2025-12-31')).toISOString()).toBe('2025-12-31T00:00:00.000Z')
    expect(toEntryDate(new Date('2025-12-31')).toISOString()).toBe('2025-12-31T00:00:00.000Z')
    expect(normalizeDate(new Date(2025, 11, 31)).toISOString()).toBe('2025-12-31T00:00:00.000Z')
  })

  it('refuses what is not a date', () => {
    expect(calendarDayOf('2025-02-30')).toBeNull()
    expect(calendarDayOf('31/12/2025')).toBeNull()
    expect(() => toEntryDate('demain')).toThrow(/AAAA-MM-JJ/)
  })

  it('takes the validation day in France', () => {
    expect(parisDayOf(new Date('2025-12-31T23:30:00Z'))).toBe('2026-01-01')
    expect(parisDayOf(new Date('2025-07-01T21:59:00Z'))).toBe('2025-07-01')
  })
})

describe('exact cents', () => {
  it('converts amounts without floating point drift', () => {
    expect(parseCents(0.1)).toBe(10)
    // 0.30000000000000004 is 30 cents plus float noise; a real third decimal is refused
    expect(parseCents(0.1 + 0.2)).toBe(30)
    expect(parseCents(1234.56 + 0.0000000000002)).toBe(123456)
    expect(parseCents(10.005)).toBeNull()
    expect(parseCents(9999999999999.99)).toBe(999999999999999)
    expect(sumCents([parseCents(0.1)!, parseCents(0.2)!])).toBe(BigInt(30))
    expect(parseCents('1234,56')).toBe(123456)
    expect(parseCents('-0.05')).toBe(-5)
    expect(parseCents('')).toBe(0)
    expect(parseCents('10.005')).toBeNull()
    expect(parseCents('99999999999999.00')).toBeNull() // 14 digits: over Decimal(15, 2)
    expect(parseCents(1e21)).toBeNull()
  })

  it('formats cents for Prisma and the FEC', () => {
    expect(centsToDecimal(123456)).toBe('1234.56')
    expect(centsToDecimal(-5)).toBe('-0.05')
    expect(centsToFecAmount(BigInt('999999999999999'))).toBe('9999999999999,99')
    expect(centsToFecAmount(0)).toBe('0,00')
  })

  it('sums large amounts exactly', () => {
    const max = parseCents('9999999999999.99')!
    expect(sumCents(Array(1000).fill(max))).toBe(BigInt('999999999999999000'))
  })
})
