/**
 * French public holidays (jours fériés légaux) and business days, on ISO
 * calendar days (yyyy-mm-dd). Pure, only the pure day helpers of
 * lib/utils/date.ts: usable on both sides.
 *
 * The list is the one of the Code du travail, art. L3133-1
 * (https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006902611):
 * 1er janvier, lundi de Pâques, 1er mai, 8 mai, Ascension, lundi de
 * Pentecôte, 14 juillet, 15 août, 1er novembre, 11 novembre, 25 décembre.
 * Local holidays (Alsace-Moselle: Vendredi saint and 26 décembre; overseas
 * abolition days) are not national and are left out.
 *
 * A business day (jour ouvré) is a Monday to Friday that is not a public
 * holiday: the day the administration counts for "le deuxième jour ouvré
 * suivant le 1er mai" and for deadlines postponed to the next business day.
 */

import { addIsoDays, toIsoDateUtc, utcDate } from '@/lib/utils/date'

const iso = (year: number, month: number, day: number): string => toIsoDateUtc(utcDate(year, month, day))
const shift = addIsoDays

/**
 * Easter Sunday of a Gregorian year (anonymous Gregorian algorithm, Meeus,
 * "Astronomical Algorithms", ch. 8), as yyyy-mm-dd.
 */
export function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return iso(year, month, day)
}

export interface PublicHoliday {
  date: string
  name: string
}

const cache = new Map<number, PublicHoliday[]>()

/** The eleven national public holidays of a year, in date order. */
export function frenchPublicHolidays(year: number): PublicHoliday[] {
  const cached = cache.get(year)
  if (cached) return cached
  const easter = easterSunday(year)
  const holidays: PublicHoliday[] = [
    { date: iso(year, 1, 1), name: "Jour de l'an" },
    { date: shift(easter, 1), name: 'Lundi de Pâques' },
    { date: iso(year, 5, 1), name: 'Fête du travail' },
    { date: iso(year, 5, 8), name: 'Victoire 1945' },
    { date: shift(easter, 39), name: 'Ascension' },
    { date: shift(easter, 50), name: 'Lundi de Pentecôte' },
    { date: iso(year, 7, 14), name: 'Fête nationale' },
    { date: iso(year, 8, 15), name: 'Assomption' },
    { date: iso(year, 11, 1), name: 'Toussaint' },
    { date: iso(year, 11, 11), name: 'Armistice 1918' },
    { date: iso(year, 12, 25), name: 'Noël' },
  ].sort((x, y) => x.date.localeCompare(y.date))
  cache.set(year, holidays)
  return holidays
}

export function isFrenchPublicHoliday(day: string): boolean {
  const year = Number(day.slice(0, 4))
  return frenchPublicHolidays(year).some((h) => h.date === day)
}

/** 0 Sunday to 6 Saturday, of a calendar day. */
function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay()
}

export function isBusinessDay(day: string): boolean {
  const weekday = weekdayOf(day)
  return weekday !== 0 && weekday !== 6 && !isFrenchPublicHoliday(day)
}

/** `day` itself when it is a business day, else the next business day. */
export function nextBusinessDay(day: string): string {
  let current = day
  while (!isBusinessDay(current)) current = shift(current, 1)
  return current
}

/** The `n`th business day strictly after `day` (n >= 1). */
export function nthBusinessDayAfter(day: string, n: number): string {
  let current = day
  let count = 0
  while (count < n) {
    current = shift(current, 1)
    if (isBusinessDay(current)) count++
  }
  return current
}
