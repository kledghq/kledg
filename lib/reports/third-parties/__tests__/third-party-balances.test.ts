/**
 * Aged balance and auxiliary balance on plain lines
 * (lib/reports/third-parties/third-party-balances.ts): open lines on the
 * report day, due date = entry date + payment terms capped by Code de
 * commerce art. L441-10, buckets by days past due, tiers by auxiliary
 * account, and the auxiliary balance per tiers with its unlettered part.
 */

import { describe, expect, it } from 'vitest'
import {
  bucketOf,
  buildAgedBalance,
  buildAuxiliaryBalance,
  lineDueDate,
  openOn,
  overdueCents,
  type ThirdPartyLine,
} from '../third-party-balances'

const NET30 = { days: 30, endOfMonth: false }

function line(partial: Partial<ThirdPartyLine> & Pick<ThirdPartyLine, 'date'>): ThirdPartyLine {
  return {
    accountCode: '411000',
    accountLabel: 'Clients',
    auxiliaryAccountNumber: null,
    auxiliaryAccountLabel: null,
    debitCents: 0,
    creditCents: 0,
    letteringCode: null,
    letteringDate: null,
    ...partial,
  }
}

describe('buckets', () => {
  it('is not due on or before the due date, then 0-30, 31-60, 61-90 and over 90 days late', () => {
    expect(bucketOf(-5)).toBe('notDue')
    expect(bucketOf(0)).toBe('notDue')
    expect(bucketOf(1)).toBe('days0to30')
    expect(bucketOf(30)).toBe('days0to30')
    expect(bucketOf(31)).toBe('days31to60')
    expect(bucketOf(60)).toBe('days31to60')
    expect(bucketOf(61)).toBe('days61to90')
    expect(bucketOf(90)).toBe('days61to90')
    expect(bucketOf(91)).toBe('over90')
  })
})

describe('open lines', () => {
  it('counts a line lettered after the report day as still open', () => {
    expect(openOn({ letteringCode: null, letteringDate: null }, '2026-03-31')).toBe(true)
    expect(openOn({ letteringCode: 'AA', letteringDate: '2026-03-31' }, '2026-03-31')).toBe(false)
    expect(openOn({ letteringCode: 'AA', letteringDate: '2026-04-01' }, '2026-03-31')).toBe(true)
    // Imported with a code and no date: lettered
    expect(openOn({ letteringCode: 'A', letteringDate: null }, '2026-03-31')).toBe(false)
  })

  it('ages invoices from their due date, payments and credit notes from their own date', () => {
    expect(lineDueDate('customers', line({ date: '2026-01-10', debitCents: 100 }), NET30)).toBe('2026-02-09')
    expect(lineDueDate('customers', line({ date: '2026-01-10', creditCents: 100 }), NET30)).toBe('2026-01-10')
    expect(lineDueDate('suppliers', line({ accountCode: '401000', date: '2026-01-10', creditCents: 100 }), NET30)).toBe('2026-02-09')
    expect(lineDueDate('suppliers', line({ accountCode: '401000', date: '2026-01-10', debitCents: 100 }), NET30)).toBe('2026-01-10')
  })
})

describe('aged balance', () => {
  const asOf = '2026-06-30'
  const lines: ThirdPartyLine[] = [
    // C001: an invoice due 30/06 (not due), one 45 days late, a partial payment on account
    line({ auxiliaryAccountNumber: 'C001', auxiliaryAccountLabel: 'Martin SA', date: '2026-05-31', debitCents: 100_000 }),
    line({ auxiliaryAccountNumber: 'C001', auxiliaryAccountLabel: 'Martin SA', date: '2026-04-16', debitCents: 50_000 }),
    line({ auxiliaryAccountNumber: 'C001', auxiliaryAccountLabel: 'Martin SA', date: '2026-06-20', creditCents: 20_000 }),
    // C002: 100 days late, and a settled pair (lettered before the report day)
    line({ auxiliaryAccountNumber: 'C002', auxiliaryAccountLabel: 'Éole', date: '2026-02-20', debitCents: 40_000 }),
    line({ auxiliaryAccountNumber: 'C002', date: '2026-01-05', debitCents: 99_999, letteringCode: 'AA', letteringDate: '2026-02-01' }),
    line({ auxiliaryAccountNumber: 'C002', date: '2026-01-31', creditCents: 99_999, letteringCode: 'AA', letteringDate: '2026-02-01' }),
    // A detailed account without auxiliary: its own tiers
    line({ accountCode: '411DUPONT', accountLabel: 'Dupont', date: '2026-03-10', debitCents: 7_000 }),
    // After the report day: ignored
    line({ auxiliaryAccountNumber: 'C001', date: '2026-07-01', debitCents: 1_000_000 }),
    // Suppliers: an invoice 61 to 90 days late, a credit note
    line({ accountCode: '401000', accountLabel: 'Fournisseurs', auxiliaryAccountNumber: 'F007', auxiliaryAccountLabel: 'Papeterie', date: '2026-03-15', creditCents: 12_000 }),
    line({ accountCode: '401000', accountLabel: 'Fournisseurs', auxiliaryAccountNumber: 'F007', date: '2026-06-01', debitCents: 2_000 }),
    // Other accounts are not third parties of these reports
    line({ accountCode: '512000', accountLabel: 'Banque', date: '2026-03-15', debitCents: 1 }),
  ]
  const report = buildAgedBalance(lines, asOf, NET30)

  it('buckets each open line by its due date and totals per tiers', () => {
    const c001 = report.customers.tiers.find((t) => t.code === 'C001')!
    expect(c001).toMatchObject({ label: 'Martin SA', accountCodes: ['411000'], lineCount: 3, oldestDueDate: '2026-05-16' })
    // 31/05 + 30 days = 30/06: due on the report day, not late
    expect(c001.buckets).toEqual({ notDue: 100_000, days0to30: -20_000, days31to60: 50_000, days61to90: 0, over90: 0, totalCents: 130_000 })

    const c002 = report.customers.tiers.find((t) => t.code === 'C002')!
    // 20/02 + 30 = 22/03, 100 days before 30/06
    expect(c002.buckets).toMatchObject({ over90: 40_000, totalCents: 40_000 })
    expect(c002.lineCount).toBe(1)

    expect(report.customers.tiers.find((t) => t.code === '411DUPONT')).toMatchObject({ label: 'Dupont', buckets: { days61to90: 7_000 } })
  })

  it('sorts tiers by overdue amount and adds up the totals', () => {
    expect(report.customers.tiers.map((t) => t.code)).toEqual(['C002', 'C001', '411DUPONT'])
    expect(report.customers.totals).toEqual({ notDue: 100_000, days0to30: -20_000, days31to60: 50_000, days61to90: 7_000, over90: 40_000, totalCents: 177_000 })
    expect(overdueCents(report.customers.totals)).toBe(77_000)
  })

  it('shows suppliers positive when owed (credit - debit)', () => {
    expect(report.suppliers.tiers).toHaveLength(1)
    // 15/03 + 30 = 14/04, 77 days late; the credit note of 01/06 is 29 days old
    expect(report.suppliers.tiers[0].buckets).toEqual({ notDue: 0, days0to30: -2_000, days31to60: 0, days61to90: 12_000, over90: 0, totalCents: 10_000 })
  })

  it('applies the payment terms of the company, capped by L441-10', () => {
    const sixty = buildAgedBalance(lines, asOf, { days: 60, endOfMonth: false })
    // 16/04 + 60 days = 15/06: 15 days late instead of 45
    expect(sixty.customers.tiers.find((t) => t.code === 'C001')!.buckets).toMatchObject({ notDue: 100_000, days0to30: 30_000, days31to60: 0 })
    const beyondCap = buildAgedBalance(lines, asOf, { days: 120, endOfMonth: false })
    expect(beyondCap).toEqual(sixty)
    const eom = buildAgedBalance([line({ auxiliaryAccountNumber: 'C9', date: '2026-04-20', debitCents: 100 })], '2026-06-30', { days: 45, endOfMonth: true })
    // 20/04 + 45 = 04/06, end of month 30/06: not due on 30/06, 1 day late on 01/07
    expect(eom.customers.tiers[0].buckets.notDue).toBe(100)
  })

  it('leaves out tiers whose open lines cancel out', () => {
    const settled = buildAgedBalance(
      [line({ auxiliaryAccountNumber: 'C5', date: '2026-01-01', debitCents: 500 }), line({ auxiliaryAccountNumber: 'C5', date: '2026-01-02', creditCents: 500 })],
      asOf,
      NET30,
    )
    expect(settled.customers.tiers).toEqual([])
  })
})

describe('auxiliary balance', () => {
  const lines: ThirdPartyLine[] = [
    line({ auxiliaryAccountNumber: 'C001', auxiliaryAccountLabel: 'Martin SA', date: '2026-01-01', debitCents: 10_000, opening: true }),
    line({ auxiliaryAccountNumber: 'C001', date: '2026-01-20', debitCents: 50_000, letteringCode: 'AA', letteringDate: '2026-02-10' }),
    line({ auxiliaryAccountNumber: 'C001', date: '2026-02-10', creditCents: 50_000, letteringCode: 'AA', letteringDate: '2026-02-10' }),
    line({ auxiliaryAccountNumber: 'C001', date: '2026-03-05', debitCents: 20_000 }),
    line({ auxiliaryAccountNumber: 'C001', date: '2026-04-05', debitCents: 99_000 }),
    line({ accountCode: '401000', accountLabel: 'Fournisseurs', auxiliaryAccountNumber: 'F007', date: '2026-02-01', creditCents: 8_000 }),
  ]

  it('splits opening, movements of the period, closing and unlettered part per tiers', () => {
    const report = buildAuxiliaryBalance(lines, '2026-02-01', '2026-03-31')
    const c001 = report.customers.tiers[0]
    expect(c001).toMatchObject({
      code: 'C001',
      label: 'Martin SA',
      // opening entry + the invoice of 20/01, before the period
      openingCents: 60_000,
      debitCents: 20_000,
      creditCents: 50_000,
      closingCents: 30_000,
      // the AN line and the invoice of 05/03; the AA pair is lettered
      unletteredCents: 30_000,
    })
    expect(report.suppliers.tiers[0]).toMatchObject({ code: 'F007', openingCents: 0, creditCents: 8_000, closingCents: -8_000, unletteredCents: -8_000 })
    expect(report.customers.totals.closingCents).toBe(30_000)
  })

  it('counts a lettering done after the period end as unlettered', () => {
    const report = buildAuxiliaryBalance(lines, '2026-01-01', '2026-01-31')
    expect(report.customers.tiers[0]).toMatchObject({ openingCents: 10_000, debitCents: 50_000, closingCents: 60_000, unletteredCents: 60_000 })
  })
})
