/**
 * Dates of a report request read as calendar days (parseCalendarDay): a
 * yyyy-mm-dd day is midnight UTC whatever the server timezone, a stored
 * timestamp is brought back to its UTC day, anything else is a French 400.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { parseCalendarDay } from '@/lib/reports/ledger/query'

const originalTz = process.env.TZ

describe('parseCalendarDay', () => {
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  it.each(['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles'])('reads yyyy-mm-dd as midnight UTC under TZ=%s', (tz) => {
    process.env.TZ = tz
    expect(parseCalendarDay('2025-03-01', 'Date de début')?.toISOString()).toBe('2025-03-01T00:00:00.000Z')
    expect(parseCalendarDay('2024-02-29', 'Date de fin')?.toISOString()).toBe('2024-02-29T00:00:00.000Z')
  })

  it('brings a stored timestamp back to its calendar day (nearest UTC midnight)', () => {
    process.env.TZ = 'UTC'
    expect(parseCalendarDay('2025-12-31T00:00:00.000Z', 'Date de fin')?.toISOString()).toBe('2025-12-31T00:00:00.000Z')
    expect(parseCalendarDay('2025-06-15T09:30:00.000Z', 'Date de fin')?.toISOString()).toBe('2025-06-15T00:00:00.000Z')
    // A midnight of another timezone (Paris, UTC+2 in June) still names its day.
    expect(parseCalendarDay('2025-06-14T22:00:00.000Z', 'Date de fin')?.toISOString()).toBe('2025-06-15T00:00:00.000Z')
  })

  it('is undefined when the parameter is absent or empty', () => {
    expect(parseCalendarDay(null, 'Date de début')).toBeUndefined()
    expect(parseCalendarDay('', 'Date de début')).toBeUndefined()
  })

  it('refuses a value that is not a date, naming the parameter', () => {
    expect(() => parseCalendarDay('demain', 'Date de début')).toThrow('Date de début invalide : demain')
    expect(() => parseCalendarDay('2025-13-45T00:00:00Z', 'Date de fin')).toThrow(expect.objectContaining({ name: 'ValidationError' }))
  })
})
