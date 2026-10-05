/**
 * Bilan pédagogique et financier (cerfa 10443*17, notice 50199#17): origin
 * of the products by customer then account, lines rounded to the euro,
 * line 2 and total, share of turnover, frame D from the books unless
 * entered, consistency checks of the notice, deadline (R6352-23).
 */

import { describe, expect, it } from 'vitest'
import { assignRevenue, frameC, frameD, pedagogicalTotals, toEuros, trainingReportChecks } from '../compute'
import { bpfDeadlineOf } from '../deadline'
import { EMPTY_TRAINING_REPORT, parseTrainingReportData } from '../schemas'

const rows = [
  { code: '706100', label: 'Formations', auxiliary: 'C00001', cents: 1_000_050 },
  { code: '706100', label: 'Formations', auxiliary: 'C00002', cents: 500_049 },
  { code: '706200', label: 'Formations CPF', auxiliary: null, cents: 300_000 },
  { code: '706300', label: 'Conseil', auxiliary: null, cents: 200_000 },
  { code: '740000', label: 'Subventions', auxiliary: null, cents: 99_999 },
]
const tiers = [
  { id: 't1', name: 'Atelier SAS', auxiliaryAccountNumber: 'C00001', trainingOrigin: 'c1' as const },
  { id: 't2', name: 'OPCO Atlas', auxiliaryAccountNumber: 'C00002', trainingOrigin: null },
]
const accounts = [
  { accountCode: '706', trainingOrigin: 'c2h' as const },
  { accountCode: '7062', trainingOrigin: 'c2e' as const },
  { accountCode: '7063', trainingOrigin: 'none' as const },
]

describe('frame C', () => {
  const assigned = assignRevenue(rows, { tiers, accounts })

  it('takes the customer’s origin first, then the longest account root, else leaves it to assign', () => {
    expect(assigned.map((a) => [a.code, a.tiers?.name ?? null, a.origin, a.source])).toEqual([
      ['706100', 'Atelier SAS', 'c1', 'tiers'],
      ['706100', 'OPCO Atlas', 'c2h', 'account'],
      ['706200', null, 'c2e', 'account'],
      ['706300', null, 'none', 'account'],
      ['740000', null, null, 'unassigned'],
    ])
  })

  it('rounds each line to the euro, totals a to h on line 2 and lines 1 to 11, leaves outside training out', () => {
    const c = frameC(assigned, 2_000_099)
    expect(c.lines.find((l) => l.code === 'c1')?.euros).toBe(10_001)
    expect(c.lines.find((l) => l.code === 'c2h')?.euros).toBe(5_000)
    expect(c.lines.find((l) => l.code === 'c2e')?.euros).toBe(3_000)
    expect(c.opcoTotalEuros).toBe(8_000)
    expect(c.totalEuros).toBe(18_001)
    expect(c.outsideEuros).toBe(2_000)
    expect(c.unassignedCents).toBe(99_999)
    // 18 000,99 € of 20 000,99 € of turnover (70 accounts): 90 %
    expect(c.sharePercent).toBe(90)
  })

  it('writes 1 % when the share is below 1 % with some activity, nothing without turnover', () => {
    const tiny = frameC([{ code: '706', label: '', tiers: null, cents: 100, origin: 'c9', source: 'account' }], 1_000_000)
    expect(tiny.sharePercent).toBe(1)
    expect(frameC([], 0).sharePercent).toBeNull()
    expect(toEuros(150)).toBe(2)
    expect(toEuros(149)).toBe(1)
    expect(toEuros(-150)).toBe(-2)
  })
})

describe('frame D', () => {
  it('reads the books unless the user entered a figure', () => {
    const d = frameD({ totalCents: 5_000_000, trainerSalariesCents: 2_000_049, trainingPurchasesCents: 300_000 }, { totalCents: 4_000_000, trainerSalariesCents: null, trainingPurchasesCents: null })
    expect(d).toEqual({
      total: { euros: 40_000, source: 'entered' },
      trainerSalaries: { euros: 20_000, source: 'books' },
      trainingPurchases: { euros: 3_000, source: 'books' },
    })
  })
})

describe('pedagogical frames and checks of the notice', () => {
  it('needs F-1, F-3 and F-4 totals to agree, levels within RNCP, F-2 within F-1', () => {
    const data = parseTrainingReportData({
      trainees: { employees: { count: 10, hours: 70 }, individuals: { count: 2, hours: 14 } },
      subcontracted: { count: 13, hours: 0 },
      objectives: { rncp: { count: 2, hours: 14 }, rncpLevel5: { count: 3, hours: 14 }, other: { count: 10, hours: 70 } },
      specialities: [{ code: '314', label: 'Comptabilité, gestion', count: 12, hours: 80 }],
    })
    expect(pedagogicalTotals(data)).toEqual({ trainees: { count: 12, hours: 84 }, objectives: { count: 12, hours: 84 }, specialities: { count: 12, hours: 80 } })
    const c = frameC([], 0)
    const checks = trainingReportChecks(data, c, 0)
    expect(checks).toHaveLength(3)
    expect(checks[0]).toMatch(/F-4/)
    expect(checks[1]).toMatch(/RNCP par niveau/)
    expect(checks[2]).toMatch(/F-2/)
  })

  it('asks for frame G when line 10 has products, and for origins left to assign', () => {
    const c = frameC([{ code: '706', label: '', tiers: null, cents: 10_000, origin: 'c10', source: 'account' }, { code: '707', label: '', tiers: { id: 't', name: 'X' }, cents: 5, origin: null, source: 'unassigned' }], 10_005)
    const checks = trainingReportChecks(EMPTY_TRAINING_REPORT, c, 1)
    expect(checks.some((m) => m.includes('cadre G'))).toBe(true)
    expect(checks.some((m) => m.startsWith('1 client(s)'))).toBe(true)
  })

  it('reads an unreadable stored value as empty frames', () => {
    expect(parseTrainingReportData({ trainees: 'x' })).toEqual(EMPTY_TRAINING_REPORT)
    expect(parseTrainingReportData(null)).toEqual(EMPTY_TRAINING_REPORT)
  })
})

describe('deadline (Code du travail R6352-23)', () => {
  it('is before 30 April of the year after the closing, with the extension announced for 2026', () => {
    expect(bpfDeadlineOf('2025-12-31')).toEqual({ date: '2026-04-29', extendedDate: '2026-05-31' })
    expect(bpfDeadlineOf('2026-06-30')).toEqual({ date: '2027-04-29', extendedDate: null })
  })
})
