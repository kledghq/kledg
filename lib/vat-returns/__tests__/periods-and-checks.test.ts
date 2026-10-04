/**
 * Periods of the VAT returns (CGI art. 287: CA3 monthly, quarterly under
 * 4 000 € of annual VAT, CA12 annual at the réel simplifié until 2026,
 * abolished from 2027 by loi n° 2025-127 art. 38; no return under the
 * franchise en base, CGI art. 293 B) and the consistency checks. Pure.
 */

import { describe, expect, it } from 'vitest'
import type { DeadlineCompany } from '@/lib/deadlines/engine'
import { listPeriods, periodOfKey, previousPeriodKey, deadlineIdOfPeriod, periodOfMonth } from '../periods'
import { periodKeyOfDeadline, parsePeriodKey } from '../period-keys'
import { isReliable, vatChecks, type CheckInput } from '../checks'

const company = (over: Partial<DeadlineCompany> = {}): DeadlineCompany => ({
  legalType: 'SAS',
  vatRegime: 'normal',
  isVatExempt: false,
  corporateTaxRegime: 'normal',
  foundationDate: '2020-01-01',
  regimeHistory: [],
  ...over,
})

describe('VAT return periods', () => {
  it('reads period keys like the deadline calendar', () => {
    expect(parsePeriodKey('2026-09')).toEqual({ year: 2026, month: 9 })
    expect(parsePeriodKey('2026-T3')).toEqual({ year: 2026, quarter: 3 })
    expect(parsePeriodKey('2026')).toEqual({ year: 2026 })
    expect(parsePeriodKey('2026-13')).toBeNull()
    expect(periodOfKey('2026-02')).toMatchObject({ form: 'CA3', start: '2026-02-01', end: '2026-02-28', label: 'février 2026' })
    expect(periodOfKey('2026-T4')).toMatchObject({ form: 'CA3', frequency: 'quarterly', start: '2026-10-01', end: '2026-12-31', label: '4e trimestre 2026' })
    expect(periodOfKey('2025')).toMatchObject({ form: 'CA12', start: '2025-01-01', end: '2025-12-31', label: 'année 2025' })
    expect([previousPeriodKey({ id: '2026-01' }), previousPeriodKey({ id: '2026-T1' }), previousPeriodKey({ id: '2026' })]).toEqual(['2025-12', '2025-T4', '2025'])
  })

  it('lists monthly CA3 at the réel normal, quarterly on the option', () => {
    expect(listPeriods(company(), { vatCa3Frequency: 'auto' }, '2026-07-01', '2026-09-30').map((p) => p.id)).toEqual(['2026-09', '2026-08', '2026-07'])
    expect(listPeriods(company(), { vatCa3Frequency: 'quarterly' }, '2026-01-01', '2026-09-30').map((p) => p.id)).toEqual(['2026-T3', '2026-T2', '2026-T1'])
  })

  it('lists the CA12 of each year at the réel simplifié, then quarterly CA3 from 2027', () => {
    const simplified = company({ vatRegime: 'simplified' })
    expect(listPeriods(simplified, { vatCa3Frequency: 'auto' }, '2025-01-01', '2027-04-30').map((p) => p.id)).toEqual(['2027-T2', '2027-T1', '2026', '2025'])
    expect(periodOfMonth(simplified, { vatCa3Frequency: 'monthly' }, '2027-03-01')).toMatchObject({ id: '2027-03' })
  })

  it('has no return under the franchise en base, and none when the regime is unknown', () => {
    expect(periodOfMonth(company({ vatRegime: 'franchise' }), { vatCa3Frequency: 'auto' }, '2026-09-01')).toBe('none')
    expect(periodOfMonth(company({ isVatExempt: true }), { vatCa3Frequency: 'auto' }, '2026-09-01')).toBe('none')
    expect(periodOfMonth(company({ vatRegime: null }), { vatCa3Frequency: 'auto' }, '2026-09-01')).toBe('unknown')
  })

  it('follows the regime history: CA12 until May, CA3 from June', () => {
    const changed = company({
      vatRegime: 'normal',
      regimeHistory: [
        { regimeType: 'vat', regime: 'simplified', startDate: '2020-01-01', endDate: '2026-05-31' },
        { regimeType: 'vat', regime: 'normal', startDate: '2026-06-01', endDate: null },
      ],
    })
    expect(listPeriods(changed, { vatCa3Frequency: 'auto' }, '2026-04-01', '2026-07-31').map((p) => p.id)).toEqual(['2026-07', '2026-06', '2026'])
  })

  it('links calendar deadlines and returns both ways (an acompte reads the previous CA12)', () => {
    expect(deadlineIdOfPeriod({ id: '2026-09', form: 'CA3' })).toBe('tva-ca3:2026-09')
    expect(deadlineIdOfPeriod({ id: '2025', form: 'CA12' })).toBe('tva-ca12:2025')
    expect(periodKeyOfDeadline({ id: 'tva-ca3:2026-T3', ruleId: 'tva-ca3' })).toBe('2026-T3')
    expect(periodKeyOfDeadline({ id: 'tva-ca12:2025', ruleId: 'tva-ca12' })).toBe('2025')
    expect(periodKeyOfDeadline({ id: 'tva-acompte:2026-07', ruleId: 'tva-acompte' })).toBe('2025')
    expect(periodKeyOfDeadline({ id: 'is-solde:2025-12-31', ruleId: 'is-solde' })).toBeNull()
  })
})

const clean: CheckInput = {
  drafts: { count: 0, numbers: [] },
  unreconciled: { count: 0, totalCents: 0 },
  unidentified: [],
  unhandled: [],
  balances: [{ group: 'collected', label: 'TVA collectée (4457)', balanceCents: 20_000, declaredCents: 20_000 }],
  toPay: { openingCents: 50_000, paidCents: 50_000, previousDueCents: 50_000, previousDeadlinePassed: true },
  credit: { carriedCents: 0, previousCreditCents: 0 },
  pendingCollectedCents: 0,
}

describe('consistency checks', () => {
  it('passes books that are complete and settled', () => {
    const checks = vatChecks(clean)
    expect(isReliable(checks)).toBe(true)
    expect(checks.map((c) => [c.id, c.severity])).toEqual([
      ['drafts', 'ok'],
      ['bank', 'ok'],
      ['balances', 'ok'],
      ['to-pay', 'ok'],
    ])
  })

  it('blocks on drafts and unreconciled bank lines of the period (only validated entries are declared, PCG art. 1031-3)', () => {
    const checks = vatChecks({ ...clean, drafts: { count: 2, numbers: ['BR-1', 'BR-2'] }, unreconciled: { count: 1, totalCents: 12_000 } })
    expect(isReliable(checks)).toBe(false)
    expect(checks.find((c) => c.id === 'drafts')).toMatchObject({ severity: 'blocking', title: '2 écritures en brouillon sur la période', items: ['BR-1', 'BR-2'] })
    expect(checks.find((c) => c.id === 'bank')).toMatchObject({ severity: 'blocking', title: '1 opération bancaire non rapprochée sur la période' })
    expect(checks.find((c) => c.id === 'bank')?.detail).toContain('120,00 €')
  })

  it('warns when the VAT accounts carry an earlier, unsettled return', () => {
    const checks = vatChecks({ ...clean, balances: [{ group: 'collected', label: 'TVA collectée (4457)', balanceCents: 35_000, declaredCents: 20_000 }] })
    expect(isReliable(checks)).toBe(true)
    expect(checks.find((c) => c.id === 'balances')).toMatchObject({ severity: 'warning' })
    expect(checks.find((c) => c.id === 'balances')?.items?.[0]).toContain('écart 150,00 €')
  })

  it('warns when 4455 does not match the payment of the previous return, and when the credit differs from the one declared', () => {
    const checks = vatChecks({ ...clean, toPay: { openingCents: 50_000, paidCents: 40_000, previousDueCents: 50_000, previousDeadlinePassed: true }, credit: { carriedCents: 10_000, previousCreditCents: 12_000 } })
    expect(checks.find((c) => c.id === 'to-pay')).toMatchObject({ severity: 'warning' })
    expect(checks.find((c) => c.id === 'credit')).toMatchObject({ severity: 'warning' })
  })

  it('does not ask for the payment before the previous deadline', () => {
    const checks = vatChecks({ ...clean, toPay: { openingCents: 50_000, paidCents: 0, previousDueCents: 50_000, previousDeadlinePassed: false } })
    expect(checks.some((c) => c.id === 'to-pay')).toBe(false)
  })

  it('blocks on rates it could not read and on VAT accounts it does not declare', () => {
    const checks = vatChecks({
      ...clean,
      unidentified: [{ id: 'e1', number: 'VE0001', date: '2026-09-15', vatCents: 2_055, baseCents: 11_000, kind: 'collected' }],
      unhandled: [{ code: '445780', netCents: -1_000, entries: 1 }],
      pendingCollectedCents: 12_500,
    })
    expect(checks.filter((c) => c.severity === 'blocking').map((c) => c.id)).toEqual(['rates', 'accounts'])
    expect(checks.find((c) => c.id === 'pending')).toMatchObject({ severity: 'info' })
  })
})
