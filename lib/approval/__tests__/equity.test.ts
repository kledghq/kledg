/**
 * Equity below half the share capital (lib/approval/equity.ts): C. com.
 * art. L223-42 (SARL, EURL) and L225-248 (SA, and SAS or SASU through
 * L227-1). Decision on an early dissolution within four months of the
 * approval; equity restored by the close of the second exercice after the
 * one in which the losses are noted. A société civile is not concerned.
 */

import { describe, expect, it } from 'vitest'
import { buildApprovalPack } from '../pack'
import { equityBelowHalfCapital, type EquityInput } from '../equity'
import { complete, contextFor } from './fixtures'

const input = (over: Partial<EquityInput> = {}): EquityInput => ({
  form: 'SAS',
  capitalCents: 1_000_000,
  equityCents: 400_000,
  fiscalYear: { startDate: '2025-01-01', endDate: '2025-12-31' },
  approvedOn: null,
  ...over,
})

describe('equityBelowHalfCapital', () => {
  it('alerts when the equity is below half the capital, not at half exactly', () => {
    const alert = equityBelowHalfCapital(input())
    expect(alert).toMatchObject({ equityCents: 400_000, halfCapitalCents: 500_000, decisionDeadline: null, restoreBy: '2028-12-31' })
    expect(alert?.message).toMatch(/dans les quatre mois qui suivent l'approbation/)
    expect(alert?.sources.map((s) => s.label)).toEqual(['C. com., art. L225-248', 'C. com., art. L227-1'])
    expect(equityBelowHalfCapital(input({ equityCents: 500_000 }))).toBeNull()
    // Odd capital: half of 1 000,01 € is 500,005 €, 500,00 € is below it
    expect(equityBelowHalfCapital(input({ capitalCents: 100_001, equityCents: 50_000 }))).not.toBeNull()
    expect(equityBelowHalfCapital(input({ capitalCents: 100_001, equityCents: 50_001 }))).toBeNull()
  })

  it('alerts for negative equity too', () => {
    expect(equityBelowHalfCapital(input({ equityCents: -250_000 }))?.message).toMatch(/-2\s?500,00/)
  })

  it('gives the decision deadline four months after the approval, end of month kept', () => {
    expect(equityBelowHalfCapital(input({ approvedOn: '2026-06-30' }))?.decisionDeadline).toBe('2026-10-31')
    expect(equityBelowHalfCapital(input({ approvedOn: '2026-05-15' }))?.decisionDeadline).toBe('2026-09-15')
  })

  it('cites L223-42 for a SARL or an EURL, nothing for a SCI, an unknown form or capital', () => {
    expect(equityBelowHalfCapital(input({ form: 'SARL' }))?.sources.map((s) => s.label)).toEqual(['C. com., art. L223-42'])
    expect(equityBelowHalfCapital(input({ form: 'EURL' }))).not.toBeNull()
    expect(equityBelowHalfCapital(input({ form: 'SCI' }))).toBeNull()
    expect(equityBelowHalfCapital(input({ form: null }))).toBeNull()
    expect(equityBelowHalfCapital(input({ capitalCents: null }))).toBeNull()
    expect(equityBelowHalfCapital(input({ capitalCents: 0 }))).toBeNull()
  })
})

describe('approval pack', () => {
  it('shows the alert and its warning when the books show equity below half the capital', () => {
    const pack = buildApprovalPack(contextFor('SAS', { equityCents: 300_000 }), complete())
    expect(pack.equityAlert).not.toBeNull()
    expect(pack.warnings.some((w) => w.includes('inférieurs à la moitié du capital social'))).toBe(true)
  })

  it('stays silent when the equity covers half the capital', () => {
    const pack = buildApprovalPack(contextFor('SAS'), complete())
    expect(pack.equityAlert).toBeNull()
  })
})
