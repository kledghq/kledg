/**
 * Periods of the VAT returns (CA3 monthly or quarterly, CA12 annual), keyed
 * like the deadline calendar keys its VAT deadlines (lib/deadlines/engine.ts):
 * "2026-09" (CA3 of a month), "2026-T3" (CA3 of a quarter), "2026" (CA12
 * of a calendar year). Pure: no database, no clock.
 *
 * Which return a month belongs to is decided once, by vatFilingAt of the
 * deadline engine (company regime, regime history, CA3 frequency setting):
 * - réel normal: CA3 of the month, or of the quarter on the quarterly option
 *   (annual VAT under 4 000 €, CGI art. 287, 2);
 * - réel simplifié until 2026: CA12 of the calendar year (CGI art. 287, 3;
 *   BOI-TVA-DECLA-20-20-30-10); the CA12E option for an exercice that does
 *   not end on 31 December is not covered (the calendar does not cover it
 *   either);
 * - réel simplifié from 2027: the regime is abolished (loi n° 2025-127,
 *   art. 38), CA3 quarterly by default;
 * - franchise en base (CGI art. 293 B) or exemption: no return.
 */

import { vatFilingAt, type DeadlineCompany } from '@/lib/deadlines/engine'
import type { DeadlineSettings } from '@/lib/deadlines/settings'
import { parsePeriodKey } from './period-keys'

export { PERIOD_KEY_PATTERN, parsePeriodKey, periodKeyOfDeadline } from './period-keys'

export type VatForm = 'CA3' | 'CA12'
export type VatFrequency = 'monthly' | 'quarterly' | 'annual'

export interface VatPeriod {
  /** "2026-09", "2026-T3" or "2026". */
  key: string
  form: VatForm
  frequency: VatFrequency
  /** First and last day, both included (yyyy-mm-dd). */
  start: string
  end: string
  /** "septembre 2026", "3e trimestre 2026", "année 2026". */
  label: string
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const QUARTERS = ['1er', '2e', '3e', '4e']

const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** The period of a key (the form follows the key: a year is a CA12, a month or a quarter a CA3). */
export function periodOfKey(key: string): VatPeriod | null {
  const parsed = parsePeriodKey(key)
  if (!parsed) return null
  const { year, month, quarter } = parsed
  if (month) {
    return { key, form: 'CA3', frequency: 'monthly', start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(lastDay(year, month))}`, label: `${MONTHS[month - 1]} ${year}` }
  }
  if (quarter) {
    const first = (quarter - 1) * 3 + 1
    const last = first + 2
    return {
      key,
      form: 'CA3',
      frequency: 'quarterly',
      start: `${year}-${pad(first)}-01`,
      end: `${year}-${pad(last)}-${pad(lastDay(year, last))}`,
      label: `${QUARTERS[quarter - 1]} trimestre ${year}`,
    }
  }
  return { key, form: 'CA12', frequency: 'annual', start: `${year}-01-01`, end: `${year}-12-31`, label: `année ${year}` }
}

export type FilingAtMonth = 'none' | 'unknown' | VatPeriod

/** The return the month starting on `monthStart` (yyyy-mm-01) belongs to. */
export function periodOfMonth(company: DeadlineCompany, settings: Pick<DeadlineSettings, 'vatCa3Frequency'>, monthStart: string): FilingAtMonth {
  const filing = vatFilingAt(company, settings, monthStart)
  if (filing === null) return 'unknown'
  if (filing.form === 'none') return 'none'
  const year = Number(monthStart.slice(0, 4))
  const month = Number(monthStart.slice(5, 7))
  if (filing.form === 'CA12') return periodOfKey(String(year)) as VatPeriod
  const key = filing.quarterly ? `${year}-T${Math.ceil(month / 3)}` : `${year}-${pad(month)}`
  return periodOfKey(key) as VatPeriod
}

/** Months from `from` to `to` (both yyyy-mm-dd), as their first days. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  let y = Number(from.slice(0, 4))
  let m = Number(from.slice(5, 7))
  const endIndex = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7))
  while (y * 12 + m <= endIndex) {
    out.push(`${y}-${pad(m)}-01`)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

/**
 * The returns covering the months from `from` to `to`, most recent first.
 * A regime change within a quarter or a year keeps the period of the first
 * month that names it (the calendar dates the deadline the same way).
 */
export function listPeriods(company: DeadlineCompany, settings: Pick<DeadlineSettings, 'vatCa3Frequency'>, from: string, to: string): VatPeriod[] {
  const byKey = new Map<string, VatPeriod>()
  for (const month of monthsBetween(from, to)) {
    const period = periodOfMonth(company, settings, month)
    if (typeof period === 'string') continue
    if (!byKey.has(period.key)) byKey.set(period.key, period)
  }
  return [...byKey.values()].sort((a, b) => b.start.localeCompare(a.start))
}

/**
 * The deadline id of a period's return in the calendar ("tva-ca3:2026-09",
 * "tva-ca12:2025"); periodKeyOfDeadline (period-keys.ts) goes the other way.
 */
export function deadlineIdOfPeriod(period: Pick<VatPeriod, 'key' | 'form'>): string {
  return `${period.form === 'CA12' ? 'tva-ca12' : 'tva-ca3'}:${period.key}`
}

/** The period before `period` of the same frequency (the previous return). */
export function previousPeriodKey(period: Pick<VatPeriod, 'key'>): string {
  const parsed = parsePeriodKey(period.key) as { year: number; month?: number; quarter?: number }
  if (parsed.month) return parsed.month === 1 ? `${parsed.year - 1}-12` : `${parsed.year}-${pad(parsed.month - 1)}`
  if (parsed.quarter) return parsed.quarter === 1 ? `${parsed.year - 1}-T4` : `${parsed.year}-T${parsed.quarter - 1}`
  return String(parsed.year - 1)
}
