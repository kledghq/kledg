/**
 * Flows of the cash forecast (lib/cash-forecast/flows.ts): open customer
 * and supplier invoices at their due date (Code de commerce art. L441-10
 * terms, unlettered payments set against the oldest invoice first), the
 * recurring payments at their cadence, the budget without its non cash
 * lines, and the recent pace.
 */

import { describe, expect, it } from 'vitest'
import { averageMonthlyChange, budgetFlows, monthLabel, openItemFlows, recurringFlows, trendFlows, type RecurringSeries } from '../flows'
import type { ThirdPartyLine } from '@/lib/reports/third-parties/third-party-balances'

const line = (over: Partial<ThirdPartyLine>): ThirdPartyLine => ({
  accountCode: '411000',
  accountLabel: 'Clients',
  auxiliaryAccountNumber: 'C001',
  auxiliaryAccountLabel: 'Studio Nord',
  date: '2026-09-15',
  debitCents: 0,
  creditCents: 0,
  letteringCode: null,
  letteringDate: null,
  ...over,
})

const TERMS = { days: 30, endOfMonth: false }

describe('openItemFlows', () => {
  it('puts each open invoice on its due date, late ones flagged, lettered lines out', () => {
    const items = openItemFlows(
      [
        line({ date: '2026-08-01', debitCents: 120_000 }),
        line({ date: '2026-09-20', debitCents: 50_000 }),
        line({ date: '2026-07-01', debitCents: 80_000, letteringCode: 'AA', letteringDate: '2026-08-01' }),
        line({ accountCode: '401000', accountLabel: 'Fournisseurs', auxiliaryAccountNumber: 'F001', auxiliaryAccountLabel: 'Imprimerie', date: '2026-10-01', creditCents: 30_000 }),
      ],
      '2026-10-05',
      '2026-10-06',
      TERMS,
    )
    expect(items).toEqual([
      { component: 'receivables', label: 'Studio Nord', day: '2026-08-31', amountCents: 120_000, overdue: true },
      { component: 'receivables', label: 'Studio Nord', day: '2026-10-20', amountCents: 50_000 },
      { component: 'payables', label: 'Imprimerie', day: '2026-10-31', amountCents: -30_000 },
    ])
  })

  it('sets an unlettered payment against the oldest invoice first', () => {
    const items = openItemFlows(
      [line({ date: '2026-08-01', debitCents: 120_000 }), line({ date: '2026-09-20', debitCents: 50_000 }), line({ date: '2026-09-25', creditCents: 130_000 })],
      '2026-10-05',
      '2026-10-06',
      TERMS,
    )
    expect(items).toEqual([{ component: 'receivables', label: 'Studio Nord', day: '2026-10-20', amountCents: 40_000 }])
  })

  it('gives nothing for a tiers that owes nothing on balance, and uses the tiers’ own terms', () => {
    const directory = new Map([['C002', { name: 'Maison Est', terms: { days: 45, endOfMonth: true } }]])
    const items = openItemFlows(
      [
        line({ date: '2026-09-01', creditCents: 10_000 }),
        line({ auxiliaryAccountNumber: 'C002', auxiliaryAccountLabel: 'ignored', date: '2026-10-01', debitCents: 99_000 }),
      ],
      '2026-10-05',
      '2026-10-06',
      TERMS,
      directory,
    )
    // 1 October + 45 days = 15 November, end of month: 30 November (L441-10).
    expect(items).toEqual([{ component: 'receivables', label: 'Maison Est', day: '2026-11-30', amountCents: 99_000 }])
  })
})

describe('recurringFlows', () => {
  const series = (over: Partial<RecurringSeries>): RecurringSeries => ({
    name: 'Logiciel',
    cadence: 'monthly',
    typicalAmountCents: 4_999,
    nextExpectedDay: '2026-10-31',
    status: 'active',
    chargeReason: null,
    ignored: false,
    ...over,
  })

  it('repeats a monthly payment anchored on its next day (the 31st falls on the 30th, then back)', () => {
    expect(recurringFlows([series({})], '2026-10-06', '2027-01-05').map((i) => [i.day, i.amountCents])).toEqual([
      ['2026-10-31', -4_999],
      ['2026-11-30', -4_999],
      ['2026-12-31', -4_999],
    ])
  })

  it('counts weekly and quarterly cadences, a late payment on the first day', () => {
    const items = recurringFlows(
      [series({ name: 'Ménage', cadence: 'weekly', typicalAmountCents: 8_000, nextExpectedDay: '2026-10-02' }), series({ name: 'Assurance', cadence: 'quarterly', nextExpectedDay: '2026-11-15' })],
      '2026-10-06',
      '2026-10-31',
    )
    expect(items.filter((i) => i.label === 'Ménage').map((i) => [i.day, Boolean(i.overdue)])).toEqual([
      ['2026-10-02', true],
      ['2026-10-09', false],
      ['2026-10-16', false],
      ['2026-10-23', false],
      ['2026-10-30', false],
    ])
    expect(items.some((i) => i.label === 'Assurance')).toBe(false)
  })

  it('leaves out ignored, possibly stopped and tax series', () => {
    const items = recurringFlows(
      [series({ ignored: true }), series({ status: 'possibly_stopped' }), series({ chargeReason: 'state' }), series({ name: 'Salaires', chargeReason: 'personnel', typicalAmountCents: 300_000 })],
      '2026-10-06',
      '2026-11-05',
    )
    expect(items.map((i) => i.label)).toEqual(['Salaires'])
  })
})

describe('budgetFlows', () => {
  it('spreads the planned months from the first day’s month on, without the non cash lines', () => {
    const items = budgetFlows(
      [
        {
          months: ['2026-10', '2026-11', '2026-12'],
          lines: [
            { accountPrefix: '706', plannedMonths: [1_000_000, 1_100_000, 1_200_000] },
            { accountPrefix: '62', plannedMonths: [400_000, 400_000, 400_000] },
            { accountPrefix: '681', plannedMonths: [50_000, 50_000, 50_000] },
            { accountPrefix: '603', plannedMonths: [10_000, 10_000, 10_000] },
          ],
        },
      ],
      '2026-11-01',
      '2026-12-05',
    )
    expect(items).toEqual([
      { component: 'budget', label: 'Rentrées prévues au budget, novembre 2026', day: '2026-11-01', until: '2026-11-30', amountCents: 1_100_000 },
      { component: 'budget', label: 'Dépenses prévues au budget, novembre 2026', day: '2026-11-01', until: '2026-11-30', amountCents: -400_000 },
      { component: 'budget', label: 'Rentrées prévues au budget, décembre 2026', day: '2026-12-01', until: '2026-12-31', amountCents: 1_200_000 },
      { component: 'budget', label: 'Dépenses prévues au budget, décembre 2026', day: '2026-12-01', until: '2026-12-31', amountCents: -400_000 },
    ])
  })
})

describe('recent pace', () => {
  it('averages the complete months, rounded half away from zero', () => {
    expect(averageMonthlyChange([100, 200, 201])).toBe(167)
    expect(averageMonthlyChange([-100, -200, -201])).toBe(-167)
    expect(averageMonthlyChange([])).toBeNull()
  })

  it('repeats it each month from the next one', () => {
    expect(trendFlows(-30_000, '2026-10-05', '2026-12-05')).toEqual([
      { component: 'trend', label: 'Rythme récent, novembre 2026', day: '2026-11-01', until: '2026-11-30', amountCents: -30_000 },
      { component: 'trend', label: 'Rythme récent, décembre 2026', day: '2026-12-01', until: '2026-12-31', amountCents: -30_000 },
    ])
    expect(trendFlows(0, '2026-10-05', '2026-12-05')).toEqual([])
    expect(monthLabel('2027-02')).toBe('février 2027')
  })
})
