/**
 * French public holidays (Code du travail, art. L3133-1,
 * https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006902611)
 * and business days. Easter dates checked against the published tables
 * (e.g. Easter 2024: 31 March, 2025: 20 April, 2026: 5 April, 2027: 28 March,
 * 2038: 25 April, the latest possible date; 2285: 22 March, the earliest).
 */

import { describe, expect, it } from 'vitest'
import {
  easterSunday,
  frenchPublicHolidays,
  isBusinessDay,
  isFrenchPublicHoliday,
  nextBusinessDay,
  nthBusinessDayAfter,
} from '../french-holidays'

describe('easterSunday', () => {
  it.each([
    [2008, '2008-03-23'],
    [2019, '2019-04-21'],
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
    [2030, '2030-04-21'],
    [2038, '2038-04-25'],
    [2285, '2285-03-22'],
  ])('%i: %s', (year, expected) => {
    expect(easterSunday(year)).toBe(expected)
  })
})

describe('frenchPublicHolidays', () => {
  it('lists the eleven holidays of L3133-1 for 2026, Easter based ones included', () => {
    expect(frenchPublicHolidays(2026).map((h) => h.date)).toEqual([
      '2026-01-01',
      '2026-04-06', // lundi de Pâques
      '2026-05-01',
      '2026-05-08',
      '2026-05-14', // Ascension: Easter + 39 days
      '2026-05-25', // lundi de Pentecôte: Easter + 50 days
      '2026-07-14',
      '2026-08-15',
      '2026-11-01',
      '2026-11-11',
      '2026-12-25',
    ])
  })

  it('moves the Easter based holidays with Easter (2008: Ascension on 1 May)', () => {
    const dates = frenchPublicHolidays(2008).map((h) => h.date)
    expect(dates).toContain('2008-03-24')
    expect(dates).toContain('2008-05-01')
    expect(dates).toContain('2008-05-12')
    expect(frenchPublicHolidays(2008).filter((h) => h.date === '2008-05-01')).toHaveLength(2)
  })

  it('knows 2027 (lundi de Pâques 29 March, Ascension 6 May, Pentecôte 17 May)', () => {
    expect(isFrenchPublicHoliday('2027-03-29')).toBe(true)
    expect(isFrenchPublicHoliday('2027-05-06')).toBe(true)
    expect(isFrenchPublicHoliday('2027-05-17')).toBe(true)
    expect(isFrenchPublicHoliday('2027-05-18')).toBe(false)
  })
})

describe('business days', () => {
  it('excludes weekends and public holidays', () => {
    expect(isBusinessDay('2026-05-04')).toBe(true) // Monday
    expect(isBusinessDay('2026-05-02')).toBe(false) // Saturday
    expect(isBusinessDay('2026-05-03')).toBe(false) // Sunday
    expect(isBusinessDay('2026-05-14')).toBe(false) // Ascension, Thursday
  })

  it('postpones to the next business day', () => {
    expect(nextBusinessDay('2026-03-16')).toBe('2026-03-16')
    expect(nextBusinessDay('2026-03-15')).toBe('2026-03-16') // Sunday
    expect(nextBusinessDay('2026-11-14')).toBe('2026-11-16') // Saturday
    expect(nextBusinessDay('2027-05-15')).toBe('2027-05-18') // Saturday, then lundi de Pentecôte 17 May
    expect(nextBusinessDay('2026-12-25')).toBe('2026-12-28')
  })

  it('counts the second business day after 1 May', () => {
    expect(nthBusinessDayAfter('2026-05-01', 2)).toBe('2026-05-05') // Fri 1, Mon 4, Tue 5
    expect(nthBusinessDayAfter('2027-05-01', 2)).toBe('2027-05-04') // Sat 1, Mon 3, Tue 4
    expect(nthBusinessDayAfter('2025-05-01', 2)).toBe('2025-05-05') // Thu 1, Fri 2, Mon 5
    expect(nthBusinessDayAfter('2024-05-01', 2)).toBe('2024-05-03') // Wed 1, Thu 2, Fri 3
    expect(nthBusinessDayAfter('2029-05-01', 2)).toBe('2029-05-03') // Tue 1, Wed 2, Thu 3
  })
})
