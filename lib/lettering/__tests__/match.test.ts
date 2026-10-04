/**
 * Automatic lettering proposals (lib/lettering/match.ts): every proposal
 * balances, same tiers pairs first, unambiguous same-amount pairs for
 * payments without auxiliary account, settled tiers, bank-reconciled
 * payments first.
 */

import { describe, expect, it } from 'vitest'
import { suggestLettering, type MatchableLine } from '../match'
import { checkSelection } from '../rules'

const line = (id: string, date: string, net: number, aux: string | null = null, reconciled = false): MatchableLine => ({
  id,
  date,
  debitCents: net > 0 ? net : 0,
  creditCents: net < 0 ? -net : 0,
  auxiliaryAccountNumber: aux,
  reconciled,
})

describe('suggestLettering', () => {
  it('pairs an invoice and its payment on the same tiers', () => {
    const result = suggestLettering([line('f1', '2026-01-10', 120_000, 'C001'), line('p1', '2026-02-05', -120_000, 'C001')])
    expect(result).toEqual([{ lineIds: ['f1', 'p1'], amountCents: 120_000, auxiliaryAccountNumber: 'C001', reason: 'same-third-party', fromReconciliation: false }])
  })

  it('never pairs two tiers, and pairs the closest dates when one tiers has the amount twice', () => {
    const result = suggestLettering([
      line('f1', '2026-01-10', 50_000, 'C001'),
      line('f2', '2026-03-10', 50_000, 'C001'),
      line('p2', '2026-03-20', -50_000, 'C001'),
      line('px', '2026-03-21', -50_000, 'C002'),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].lineIds).toEqual(['f2', 'p2'])
  })

  it('pairs a payment without auxiliary account only when the amount is unambiguous', () => {
    const unique = suggestLettering([line('f1', '2026-01-10', 30_000, 'C001'), line('bq', '2026-01-31', -30_000, null, true)])
    expect(unique).toEqual([{ lineIds: ['f1', 'bq'], amountCents: 30_000, auxiliaryAccountNumber: 'C001', reason: 'same-amount', fromReconciliation: true }])

    const ambiguous = suggestLettering([
      line('f1', '2026-01-10', 30_000, 'C001'),
      line('f2', '2026-01-12', 30_000, 'C002'),
      line('bq', '2026-01-31', -30_000, null),
    ])
    expect(ambiguous).toEqual([])
  })

  it('letters what is left of a tiers when it sums to zero (instalments)', () => {
    const result = suggestLettering([
      line('f1', '2026-01-10', 90_000, 'F007'),
      line('p1', '2026-02-10', -30_000, 'F007'),
      line('p2', '2026-03-10', -30_000, 'F007'),
      line('p3', '2026-04-10', -30_000, 'F007'),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ reason: 'third-party-settled', lineIds: ['f1', 'p1', 'p2', 'p3'], amountCents: 90_000 })
  })

  it('puts the payments confirmed by the bank first, and every proposal balances', () => {
    const lines = [
      line('a1', '2026-01-02', 10_000, 'C001'),
      line('a2', '2026-01-03', -10_000, 'C001'),
      line('b1', '2026-02-01', 20_000, 'C002'),
      line('b2', '2026-02-02', -20_000, 'C002', true),
      line('z', '2026-02-03', 0, 'C003'),
      line('open', '2026-02-04', 99, 'C004'),
    ]
    const result = suggestLettering(lines)
    expect(result.map((s) => s.lineIds[0])).toEqual(['b1', 'a1'])
    const byId = new Map(lines.map((l) => [l.id, l]))
    for (const suggestion of result) {
      expect(checkSelection(suggestion.lineIds.map((id) => byId.get(id)!)).errors).toEqual([])
    }
  })

  it('uses each line once', () => {
    const result = suggestLettering([
      line('f1', '2026-01-10', 100, 'C1'),
      line('p1', '2026-01-11', -100, 'C1'),
      line('p2', '2026-01-12', -100, null),
    ])
    const ids = result.flatMap((s) => s.lineIds)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['f1', 'p1'])
  })
})
