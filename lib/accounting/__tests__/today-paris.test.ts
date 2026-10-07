/**
 * KLEDG-R3-QUAL-16: the "today" of business rules is the calendar day in
 * France, whatever the server timezone (docs/conventions.md#dates).
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { todayParis } from '@/lib/accounting/entry-date'

const ORIGINAL_TZ = process.env.TZ
const ZONES = ['Pacific/Kiritimati', 'America/Los_Angeles', 'Pacific/Pago_Pago', 'UTC']

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe.each(ZONES)('todayParis with TZ=%s', (zone) => {
  beforeEach(() => {
    process.env.TZ = zone
  })

  it('00:30 in Paris on 16 May (22:30 UTC on the 15th) is the 16th', () => {
    expect(todayParis(new Date('2026-05-15T22:30:00Z'))).toBe('2026-05-16')
  })

  it('follows winter time: 23:30 UTC on 31 December is 1 January in Paris', () => {
    expect(todayParis(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01')
    expect(todayParis(new Date('2026-12-31T22:59:59Z'))).toBe('2026-12-31')
  })
})
