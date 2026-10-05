/**
 * Settings of the deadline calendar (lib/deadlines/settings.ts) and the
 * relative labels of the widget (lib/deadlines/relative.ts). The CA3 day
 * grid is CGI ann. IV art. 39 and BOI-TVA-DECLA-20-20-10-10 §200
 * (https://bofip.impots.gouv.fr/bofip/1001-PGP.html/identifiant=BOI-TVA-DECLA-20-20-10-10-20230118).
 */

import { describe, expect, it } from 'vitest'
import { relativeDeadlineLabel, urgencyOf } from '../relative'
import { DEFAULT_DEADLINE_SETTINGS, DeadlineSettingsBody, defaultVatFilingDay, parseDeadlineSettings } from '../settings'

describe('deadline settings', () => {
  it('defaults to the cautious choices: earliest day, acomptes shown, one month to file the accounts', () => {
    expect(DEFAULT_DEADLINE_SETTINGS).toEqual({
      vatFilingDay: null,
      vatCa3Frequency: 'auto',
      vatSimplifiedAcomptes: true,
      isAcomptes: true,
      cfeAcompte: false,
      das2: false,
      cvae: false,
      cvaeDue: false,
      cvaeAcomptes: false,
      cfeChanges: false,
      accountsFiledOnline: false,
    })
  })

  it('reads the settings added for local taxes as false when a client or a stored value omits them', () => {
    const body = DeadlineSettingsBody.parse({ ...DEFAULT_DEADLINE_SETTINGS, cvaeDue: undefined, cvaeAcomptes: undefined, cfeChanges: undefined })
    expect(body).toMatchObject({ cvaeDue: false, cvaeAcomptes: false, cfeChanges: false })
    expect(parseDeadlineSettings({ cvae: true })).toMatchObject({ cvae: true, cvaeDue: false, cvaeAcomptes: false, cfeChanges: false })
    expect(parseDeadlineSettings({ cvaeDue: true, cfeChanges: 'yes' })).toMatchObject({ cvaeDue: true, cfeChanges: false })
  })

  it('gives the earliest CA3 day of each legal form (art. 39 grid)', () => {
    expect(defaultVatFilingDay('EI')).toBe(15)
    expect(defaultVatFilingDay('SA')).toBe(23)
    expect(defaultVatFilingDay('SAS')).toBe(19)
    expect(defaultVatFilingDay('SARL')).toBe(19)
    expect(defaultVatFilingDay(null)).toBe(15)
  })

  it('reads a stored value field by field, falling back to the defaults', () => {
    expect(parseDeadlineSettings(null)).toEqual(DEFAULT_DEADLINE_SETTINGS)
    expect(parseDeadlineSettings('corrupted')).toEqual(DEFAULT_DEADLINE_SETTINGS)
    expect(parseDeadlineSettings([1])).toEqual(DEFAULT_DEADLINE_SETTINGS)
    expect(parseDeadlineSettings({ vatFilingDay: 21, isAcomptes: false, vatCa3Frequency: 'weekly', unknown: true })).toEqual({
      ...DEFAULT_DEADLINE_SETTINGS,
      vatFilingDay: 21,
      isAcomptes: false,
    })
    expect(parseDeadlineSettings({ vatFilingDay: 30 }).vatFilingDay).toBeNull()
  })

  it('validates request bodies: the whole object, a day from 15 to 24 with a French message', () => {
    expect(DeadlineSettingsBody.safeParse(DEFAULT_DEADLINE_SETTINGS).success).toBe(true)
    expect(DeadlineSettingsBody.safeParse({ ...DEFAULT_DEADLINE_SETTINGS, vatFilingDay: 24 }).success).toBe(true)
    const tooLate = DeadlineSettingsBody.safeParse({ ...DEFAULT_DEADLINE_SETTINGS, vatFilingDay: 25 })
    expect(tooLate.success).toBe(false)
    expect(tooLate.error?.issues[0].message).toBe('Le jour de déclaration de TVA est compris entre le 15 et le 24')
    expect(DeadlineSettingsBody.safeParse({ ...DEFAULT_DEADLINE_SETTINGS, vatFilingDay: 19.5 }).success).toBe(false)
    expect(DeadlineSettingsBody.safeParse({ vatFilingDay: 19 }).success).toBe(false)
  })
})

describe('relative labels', () => {
  it('says today, tomorrow, in n days or late', () => {
    expect(relativeDeadlineLabel('2026-10-04', '2026-10-04')).toBe("aujourd'hui")
    expect(relativeDeadlineLabel('2026-10-05', '2026-10-04')).toBe('demain')
    expect(relativeDeadlineLabel('2026-10-09', '2026-10-04')).toBe('dans 5 jours')
    expect(relativeDeadlineLabel('2026-10-03', '2026-10-04')).toBe('en retard de 1 jour')
    expect(relativeDeadlineLabel('2026-09-30', '2026-10-04')).toBe('en retard de 4 jours')
    expect(relativeDeadlineLabel('2026-09-19', '2026-10-04')).toBe('en retard de 15 jours')
    // Older than the 15 day window: past, Kledg does not know whether it was filed.
    expect(relativeDeadlineLabel('2026-09-18', '2026-10-04')).toBe('passée')
    // Across a change of daylight saving time (25 October 2026 in France): whole calendar days.
    expect(relativeDeadlineLabel('2026-11-03', '2026-10-24')).toBe('dans 10 jours')
  })

  it('grades urgency: past, late, today, within seven days, later', () => {
    expect(urgencyOf('2026-01-19', '2026-10-04')).toBe('past')
    expect(urgencyOf('2026-10-01', '2026-10-04')).toBe('overdue')
    expect(urgencyOf('2026-10-04', '2026-10-04')).toBe('today')
    expect(urgencyOf('2026-10-11', '2026-10-04')).toBe('soon')
    expect(urgencyOf('2026-10-12', '2026-10-04')).toBe('later')
  })
})
