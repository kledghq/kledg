/**
 * Payment terms and due dates (lib/reports/third-parties/payment-terms.ts),
 * Code de commerce art. L441-10, I: 30 days by default (al. 1), at most 60
 * days from the invoice date or 45 days end of month when agreed (al. 2).
 * Run under several timezones: due dates are calendar days.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  capPaymentTerms,
  daysBetween,
  DEFAULT_PAYMENT_TERMS,
  describePaymentTerms,
  dueDateOf,
  MAX_END_OF_MONTH_DAYS,
  MAX_PAYMENT_DAYS,
  paymentTermsErrors,
} from '../payment-terms'

const ORIGINAL_TZ = process.env.TZ

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe.each(['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles'])('payment terms (TZ=%s)', (tz) => {
  // Node applies a change of process.env.TZ immediately.
  beforeEach(() => {
    process.env.TZ = tz
  })

  it('defaults to 30 days, the legal term when nothing is agreed (L441-10, I, al. 1)', () => {
    expect(DEFAULT_PAYMENT_TERMS).toEqual({ days: 30, endOfMonth: false })
    expect(dueDateOf('2026-01-15', DEFAULT_PAYMENT_TERMS)).toBe('2026-02-14')
    expect(dueDateOf('2026-12-15', DEFAULT_PAYMENT_TERMS)).toBe('2027-01-14')
  })

  it('counts calendar days across month ends and leap years', () => {
    expect(dueDateOf('2026-01-31', { days: 30, endOfMonth: false })).toBe('2026-03-02')
    expect(dueDateOf('2028-01-31', { days: 30, endOfMonth: false })).toBe('2028-03-01')
    expect(dueDateOf('2026-03-31', { days: 0, endOfMonth: false })).toBe('2026-03-31')
  })

  it('caps the term at 60 days from the invoice date (L441-10, I, al. 2)', () => {
    expect(MAX_PAYMENT_DAYS).toBe(60)
    expect(dueDateOf('2026-01-01', { days: 90, endOfMonth: false })).toBe('2026-03-02')
    expect(capPaymentTerms({ days: 90, endOfMonth: false })).toEqual({ days: 60, endOfMonth: false })
  })

  it('computes "45 jours fin de mois" as 45 days then the end of that month, capped at 45 days', () => {
    expect(MAX_END_OF_MONTH_DAYS).toBe(45)
    // 10 January + 45 days = 24 February, end of month 28 February (2026 is not a leap year)
    expect(dueDateOf('2026-01-10', { days: 45, endOfMonth: true })).toBe('2026-02-28')
    expect(dueDateOf('2028-01-10', { days: 45, endOfMonth: true })).toBe('2028-02-29')
    // 31 January + 45 days = 17 March: end of March
    expect(dueDateOf('2026-01-31', { days: 45, endOfMonth: true })).toBe('2026-03-31')
    // A longer end-of-month term is capped at 45 days
    expect(dueDateOf('2026-01-10', { days: 60, endOfMonth: true })).toBe('2026-02-28')
    // 30 days end of month, across the year end
    expect(dueDateOf('2026-12-05', { days: 30, endOfMonth: true })).toBe('2027-01-31')
  })

  it('refuses terms above the caps when they are saved, citing the article', () => {
    expect(paymentTermsErrors({ days: 60, endOfMonth: false })).toEqual([])
    expect(paymentTermsErrors({ days: 45, endOfMonth: true })).toEqual([])
    expect(paymentTermsErrors({ days: 61, endOfMonth: false })[0]).toContain('art. L441-10')
    expect(paymentTermsErrors({ days: 46, endOfMonth: true })[0]).toContain('45 jours')
    expect(paymentTermsErrors({ days: -1, endOfMonth: false })).toHaveLength(1)
    expect(paymentTermsErrors({ days: 1.5, endOfMonth: false })).toHaveLength(1)
    expect(paymentTermsErrors({ days: Number.NaN, endOfMonth: false })).toHaveLength(1)
  })

  it('describes the terms in French', () => {
    expect(describePaymentTerms({ days: 30, endOfMonth: false })).toBe('30 jours')
    expect(describePaymentTerms({ days: 45, endOfMonth: true })).toBe('45 jours fin de mois')
    expect(describePaymentTerms({ days: 1, endOfMonth: false })).toBe('1 jour')
  })

  it('counts days between two calendar days', () => {
    expect(daysBetween('2026-02-14', '2026-02-14')).toBe(0)
    expect(daysBetween('2026-02-14', '2026-03-16')).toBe(30)
    expect(daysBetween('2026-03-29', '2026-03-30')).toBe(1) // daylight saving change in Europe and the US
    expect(daysBetween('2026-03-16', '2026-02-14')).toBe(-30)
  })
})
