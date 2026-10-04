import { describe, expect, it } from 'vitest'

import { TRIAL_BALANCE_PAIRS, pairAmounts, pairHeadings, pairTotals } from '../trial-balance-columns'

const row = {
  openingDebit: 1,
  openingCredit: 2,
  movementDebit: 3,
  movementCredit: 4,
  closingDebit: 5,
  closingCredit: 6,
}

const totals = {
  opening: { debit: 10, credit: 20 },
  movements: { debit: 30, credit: 40 },
  closing: { debit: 50, credit: 60 },
}

describe('trial balance columns on narrow screens', () => {
  it('offers the balances first, then the movements and the opening balances', () => {
    expect(TRIAL_BALANCE_PAIRS.map((p) => p.value)).toEqual(['closing', 'movement', 'opening'])
    expect(TRIAL_BALANCE_PAIRS.map((p) => p.label)).toEqual(['Soldes', 'Mouvements', 'À-nouveaux'])
  })

  it('reads the debit and credit of the pair shown', () => {
    expect(pairAmounts(row, 'opening')).toEqual({ debit: 1, credit: 2 })
    expect(pairAmounts(row, 'movement')).toEqual({ debit: 3, credit: 4 })
    expect(pairAmounts(row, 'closing')).toEqual({ debit: 5, credit: 6 })
  })

  it('reads the totals of the pair shown', () => {
    expect(pairTotals(totals, 'opening')).toEqual({ debit: 10, credit: 20 })
    expect(pairTotals(totals, 'movement')).toEqual({ debit: 30, credit: 40 })
    expect(pairTotals(totals, 'closing')).toEqual({ debit: 50, credit: 60 })
  })

  it('names each pair with the headings of the full table', () => {
    expect(pairHeadings('closing')).toEqual({ debit: 'Solde débiteur', credit: 'Solde créditeur' })
    expect(pairHeadings('movement')).toEqual({ debit: 'Mouvements débit', credit: 'Mouvements crédit' })
    expect(pairHeadings('opening')).toEqual({ debit: 'À-nouveaux débit', credit: 'À-nouveaux crédit' })
  })
})
