/**
 * The date range checks of the entry validator (validateDateRange) and of
 * the image fidèle principle (PCG art. 121-1) accept an entry up to 30
 * calendar days after today. Days are UTC calendar days, like stored entry
 * dates, so the limit does not move with the server timezone.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { validateAmount, validateDateRange } from '../validator'
import { validateImageFidele } from '@/lib/pcg/principles/image-fidele'

const ORIGINAL_TZ = process.env.TZ
const ZONES = ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

// 31 December 2025, 23:30 UTC: already 1 January in Kiritimati, still the 31st afternoon in Los Angeles
const NOW = new Date('2025-12-31T23:30:00.000Z')
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const lines = [
  { accountId: 'a', debit: 10, credit: 0 },
  { accountId: 'b', debit: 0, credit: 10 },
]

describe.each(ZONES)('entry date range with TZ=%s', (zone) => {
  beforeEach(() => {
    process.env.TZ = zone
  })

  it('accepts up to today + 30 calendar days and refuses the day after', () => {
    expect(validateDateRange(day('2025-12-31'), 30, NOW)).toBe(true)
    expect(validateDateRange(day('2026-01-30'), 30, NOW)).toBe(true)
    expect(validateDateRange(day('2026-01-31'), 30, NOW)).toBe(false)
  })

  it('refuses dates before 1900', () => {
    expect(validateDateRange(day('1899-12-31'), 30, NOW)).toBe(false)
    expect(validateDateRange(day('1900-01-01'), 30, NOW)).toBe(true)
  })

  it('leaves future dates to the fiscal year guard in the image fidèle principle (a year-end entry is allowed)', () => {
    expect(validateImageFidele({ date: day('2026-12-31'), description: 'Provision de fin d\'exercice', lines }, NOW).errors).toEqual([])
  })
})

describe('validateAmount', () => {
  it('accepts decimals and Decimal-like values, refuses what is not a number', () => {
    expect(validateAmount({ toString: () => '1234.56' })).toBe(true)
    expect(validateAmount('-12.5')).toBe(true)
    expect(validateAmount({})).toBe(false)
    expect(validateAmount(true)).toBe(false)
  })
})
