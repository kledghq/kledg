import { describe, expect, it } from 'vitest'

import { BALANCE_SIDE_LABELS, balanceSide, runningBalances } from '../account-ledger'

describe('runningBalances', () => {
  it('adds debits and subtracts credits line after line, in cents', () => {
    const lines = [
      { debit: 0.1, credit: 0 },
      { debit: '0.20', credit: '0' },
      { debit: 0, credit: 1000 },
    ]
    expect(runningBalances(lines)).toEqual([0.1, 0.3, -999.7])
  })

  it('returns nothing for an empty ledger', () => {
    expect(runningBalances([])).toEqual([])
  })
})

describe('balanceSide', () => {
  // PCG: a balance is "débiteur" when debits exceed credits, "créditeur" otherwise.
  it('names the side of debit minus credit', () => {
    expect(BALANCE_SIDE_LABELS[balanceSide(250)]).toBe('Solde débiteur')
    expect(BALANCE_SIDE_LABELS[balanceSide(-250)]).toBe('Solde créditeur')
    expect(BALANCE_SIDE_LABELS[balanceSide(0.001)]).toBe('Solde nul')
  })
})
