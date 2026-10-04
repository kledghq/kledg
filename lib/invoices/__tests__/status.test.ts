/**
 * Invoice status derived from lettering and recorded payments (no partial
 * lettering: docs/lettrage-et-tiers.md), and due dates within Code de
 * commerce art. L441-10 (60 days, or 45 days end of month).
 */

import { describe, expect, it } from 'vitest'
import { defaultDueDate, invoiceStatus, maxDueDate, remainingCents } from '../status'

describe('invoice status', () => {
  it('is a draft until posted', () => {
    expect(invoiceStatus({ posted: false, totalInclTaxCents: 1200, paidCents: 0, lettered: false })).toBe('draft')
  })

  it('is posted, then partially paid, then paid from the payments recorded', () => {
    expect(invoiceStatus({ posted: true, totalInclTaxCents: 1200, paidCents: 0, lettered: false })).toBe('posted')
    expect(invoiceStatus({ posted: true, totalInclTaxCents: 1200, paidCents: 500, lettered: false })).toBe('partially_paid')
    expect(invoiceStatus({ posted: true, totalInclTaxCents: 1200, paidCents: 1200, lettered: false })).toBe('paid')
  })

  it('is paid once its tiers line is lettered, whatever was recorded', () => {
    expect(invoiceStatus({ posted: true, totalInclTaxCents: 1200, paidCents: 0, lettered: true })).toBe('paid')
    expect(remainingCents({ totalInclTaxCents: 1200, paidCents: 0, lettered: true })).toBe(0)
  })

  it('computes what is left to pay', () => {
    expect(remainingCents({ totalInclTaxCents: 1200, paidCents: 500, lettered: false })).toBe(700)
    expect(remainingCents({ totalInclTaxCents: 1200, paidCents: 1300, lettered: false })).toBe(0)
  })
})

describe('due dates (Code de commerce art. L441-10)', () => {
  it('follows the payment terms', () => {
    expect(defaultDueDate('2026-01-10', { days: 30, endOfMonth: false })).toBe('2026-02-09')
    expect(defaultDueDate('2026-01-10', { days: 45, endOfMonth: true })).toBe('2026-02-28')
  })

  it('caps a typed due date at the later of 60 days and 45 days end of month', () => {
    // 10 January: 60 days = 11 March; 45 days end of month = 28 February
    expect(maxDueDate('2026-01-10')).toBe('2026-03-11')
    // 20 March: 60 days = 19 May; 45 days = 4 May, end of month 31 May
    expect(maxDueDate('2026-03-20')).toBe('2026-05-31')
  })
})
