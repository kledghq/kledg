/**
 * Amounts of the lines a transaction rule generates
 * (lib/transactions/entry-line-calculator.ts) and their conversion to whole
 * cents (toCentLines in rule-executor.ts): full, percentage, fixed and
 * remaining amounts, VAT extracted from a TTC amount or added to an HT one
 * (taux normal 20 %, CGI art. 278; 5,5 %, CGI art. 278-0 bis), self-assessed
 * VAT on intra-EU acquisitions (CGI art. 256 bis, deductible under art. 271),
 * the recovery ratio of partly exempt companies (coefficient de déduction,
 * CGI ann. II art. 206) and the balancing bank line, so every entry balances
 * to the cent.
 *
 * The calculator works in euros as floats; amounts are compared after
 * rounding to the cent, as toCentLines does before anything is written.
 */

import { describe, expect, it, vi } from 'vitest'

// toCentLines is pure; its module also holds the database part of the rules engine
vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

import {
  balanceEntryLines,
  calculateAmountsWithVAT,
  calculateLineAmount,
  calculateVATLineAmounts,
  determineLineType,
  validateEntryBalance,
} from '../entry-line-calculator'
import { toCentLines } from '../rule-executor'
import type { EntryLine } from '../types'
import { toCents } from '@/lib/utils/money'

const cents = (euros: number) => toCents(euros)

/** HT, VAT and TTC of a calculation, in cents. */
function inCents(amounts: { amountHT: number; amountTTC: number; vatAmount: number }) {
  return { ht: cents(amounts.amountHT), vat: cents(amounts.vatAmount), ttc: cents(amounts.amountTTC) }
}

describe('calculateLineAmount', () => {
  it.each([
    ['full', null, 250, 250],
    ['percentage', 25, 250, 62.5],
    ['percentage', null, 250, 0],
    ['fixed', 12.5, 250, 12.5],
    ['fixed', null, 250, 0],
    ['remaining', null, 250, 40],
    ['ht', 10, 250, 0],
    ['ttc', 10, 250, 0],
    ['vat', 10, 250, 0],
    ['unknown', 10, 250, 0],
  ] as const)('%s (value %s) of %s -> %s', (amountType, amountValue, transactionAmount, expected) => {
    expect(calculateLineAmount({ amountType, amountValue, lineType: 'debit' }, transactionAmount, 40)).toBe(expected)
  })
})

describe('calculateAmountsWithVAT', () => {
  const line = (amountType: string, vatType: string | null, vatRate: number | null, extra: Record<string, unknown> = {}) => ({
    amountType,
    lineType: 'debit',
    vatType,
    vatRate,
    ...extra,
  })

  it('extracts 20 % VAT from a TTC amount: 100,00 TTC = 83,33 HT + 16,67 TVA (CGI art. 278)', () => {
    expect(inCents(calculateAmountsWithVAT(line('full', 'deductible', 20), 100))).toEqual({ ht: 8333, vat: 1667, ttc: 10000 })
    expect(inCents(calculateAmountsWithVAT(line('ttc', 'deductible', 20), 120))).toEqual({ ht: 10000, vat: 2000, ttc: 12000 })
  })

  it('extracts 5,5 % VAT: 105,50 TTC = 100,00 HT + 5,50 TVA (CGI art. 278-0 bis)', () => {
    expect(inCents(calculateAmountsWithVAT(line('fixed', 'collectible', 5.5), 105.5))).toEqual({ ht: 10000, vat: 550, ttc: 10550 })
  })

  it('adds VAT to an HT amount and rebuilds HT from a VAT amount', () => {
    expect(inCents(calculateAmountsWithVAT(line('ht', 'deductible', 20), 100))).toEqual({ ht: 10000, vat: 2000, ttc: 12000 })
    expect(inCents(calculateAmountsWithVAT(line('vat', 'deductible', 20), 20))).toEqual({ ht: 10000, vat: 2000, ttc: 12000 })
  })

  it('keeps the whole amount as HT for intra-EU acquisitions and computes the self-assessed VAT on top (CGI art. 256 bis)', () => {
    expect(inCents(calculateAmountsWithVAT(line('full', 'intracom', 20), 100))).toEqual({ ht: 10000, vat: 2000, ttc: 12000 })
    expect(inCents(calculateAmountsWithVAT(line('remaining', 'import', 20), 50))).toEqual({ ht: 5000, vat: 1000, ttc: 6000 })
  })

  it('leaves the amount untouched without VAT type, with type "none" or without rate', () => {
    expect(inCents(calculateAmountsWithVAT(line('full', null, 20), 100))).toEqual({ ht: 10000, vat: 0, ttc: 10000 })
    expect(inCents(calculateAmountsWithVAT(line('full', 'none', 20), 100))).toEqual({ ht: 10000, vat: 0, ttc: 10000 })
    expect(inCents(calculateAmountsWithVAT(line('full', 'deductible', null), 100))).toEqual({ ht: 10000, vat: 0, ttc: 10000 })
  })

  it('uses the VAT amount the bank detected when the line takes VAT from the transaction', () => {
    const fromTransaction = line('full', 'deductible', 20, { vatRateSource: 'transaction' })
    // 21,00 TTC with 3,50 detected VAT: HT = TTC - TVA, the line rate is not used
    expect(inCents(calculateAmountsWithVAT(fromTransaction, 21, { vatAmount: 3.5, vatRate: 10 }))).toEqual({ ht: 1750, vat: 350, ttc: 2100 })
    // Only a detected rate: 10 % of 110,00 TTC
    expect(inCents(calculateAmountsWithVAT(fromTransaction, 110, { vatRate: 10 }))).toEqual({ ht: 10000, vat: 1000, ttc: 11000 })
  })

  it('ignores a negative detected rate (Qonto -1, non standard rate) and falls back to the line rate', () => {
    const fromTransaction = line('full', 'deductible', 20, { vatRateSource: 'transaction' })
    expect(inCents(calculateAmountsWithVAT(fromTransaction, 120, { vatRate: -1, vatAmount: null }))).toEqual({ ht: 10000, vat: 2000, ttc: 12000 })
  })

  it('ignores the transaction VAT when the line uses its own fixed rate', () => {
    expect(inCents(calculateAmountsWithVAT(line('full', 'deductible', 20), 120, { vatAmount: 5, vatRate: 5.5 }))).toEqual({ ht: 10000, vat: 2000, ttc: 12000 })
  })
})

describe('determineLineType', () => {
  it.each([
    ['debit', 'credit', { isDebit: true, isCredit: false }],
    ['credit', 'debit', { isDebit: false, isCredit: true }],
    ['auto', 'debit', { isDebit: true, isCredit: false }],
    ['auto', 'credit', { isDebit: false, isCredit: true }],
    ['other', 'debit', { isDebit: false, isCredit: false }],
  ] as const)('%s on a %s transaction', (lineType, side, expected) => {
    expect(determineLineType({ lineType }, side)).toEqual(expected)
  })
})

describe('calculateVATLineAmounts', () => {
  it('credits collected VAT on a sale and debits it on a credit note (vatOnDebit)', () => {
    expect(calculateVATLineAmounts('collectible', 20, false)).toEqual({ vatDebit: 0, vatCredit: 20 })
    expect(calculateVATLineAmounts('collectible', 20, true)).toEqual({ vatDebit: 20, vatCredit: 0 })
  })

  it('debits deductible, intra-EU and import VAT', () => {
    expect(calculateVATLineAmounts('deductible', 20)).toEqual({ vatDebit: 20, vatCredit: 0 })
    expect(calculateVATLineAmounts('intracom', 20)).toEqual({ vatDebit: 20, vatCredit: 0 })
    expect(calculateVATLineAmounts('import', 20)).toEqual({ vatDebit: 20, vatCredit: 0 })
  })

  it('writes no VAT line for exempt or reverse charge operations', () => {
    expect(calculateVATLineAmounts('exempt', 20)).toEqual({ vatDebit: 0, vatCredit: 0 })
    expect(calculateVATLineAmounts('reverse_charge', 20)).toEqual({ vatDebit: 0, vatCredit: 0 })
  })

  it('recovers only the ratio of deductible VAT of a partly exempt company (CGI ann. II art. 206)', () => {
    expect(cents(calculateVATLineAmounts('deductible', 20, null, 0.6).vatDebit)).toBe(1200)
    expect(calculateVATLineAmounts('deductible', 20, null, 0)).toEqual({ vatDebit: 0, vatCredit: 0 })
    // The ratio concerns deductible VAT only
    expect(calculateVATLineAmounts('collectible', 20, false, 0.6)).toEqual({ vatDebit: 0, vatCredit: 20 })
  })
})

describe('balanceEntryLines and validateEntryBalance', () => {
  const line = (accountId: string, debit: number, credit: number): EntryLine => ({ accountId, debit, credit, description: accountId })

  it('credits the bank for the debit surplus of a purchase', () => {
    const lines = balanceEntryLines([line('606', 83.33, 0), line('44566', 16.67, 0)], 'bank', 'CB PAPETERIE')
    expect(lines.at(-1)).toEqual({ accountId: 'bank', debit: 0, credit: 100, description: 'CB PAPETERIE' })
    expect(validateEntryBalance(lines)).toBe(true)
  })

  it('debits the bank for the credit surplus of a sale', () => {
    const lines = balanceEntryLines([line('706', 0, 100), line('44571', 0, 20)], 'bank', 'VIR CLIENT')
    expect(lines.at(-1)).toEqual({ accountId: 'bank', debit: 120, credit: 0, description: 'VIR CLIENT' })
  })

  it('balances an imbalance of exactly one cent with the bank', () => {
    // Regression: the threshold was "more than 0,01", so a 0,01 transaction got no bank line
    const lines = balanceEntryLines([line('627', 0.01, 0)], 'bank', 'FRAIS')
    expect(lines.at(-1)).toEqual({ accountId: 'bank', debit: 0, credit: 0.01, description: 'FRAIS' })
    expect(balanceEntryLines([line('706', 0, 0.01)], 'bank', 'x').at(-1)).toMatchObject({ debit: 0.01, credit: 0 })
  })

  it('adds nothing to balanced lines', () => {
    const lines = [line('606', 50, 0), line('bank', 0, 50)]
    expect(balanceEntryLines(lines, 'bank', 'x')).toHaveLength(2)
    expect(validateEntryBalance([line('606', 50, 0), line('bank', 0, 49.98)])).toBe(false)
  })
})

describe('toCentLines', () => {
  const line = (accountId: string, debit: number, credit: number): EntryLine => ({ accountId, debit, credit, description: accountId })

  it('rounds 100,00 TTC at 20 % to 83,33 + 16,67 = 100,00', () => {
    const ttc = 100
    const ht = ttc / 1.2
    const lines = toCentLines([line('606', ht, 0), line('44566', ttc - ht, 0), line('bank', 0, ttc)], 'bank')
    expect(lines?.map((l) => [l.accountId, l.debitCents, l.creditCents])).toEqual([
      ['606', 8333, 0],
      ['44566', 1667, 0],
      ['bank', 0, 10000],
    ])
  })

  it('gives the rounding residue to the largest counterpart line, never to the bank', () => {
    // Three thirds of 100,00: 33,33 x 3 = 99,99, the missing cent goes to a 33,33 line of the counterpart
    const third = 100 / 3
    const lines = toCentLines([line('6061', third, 0), line('6063', third, 0), line('6064', third, 0), line('bank', 0, 100)], 'bank')
    expect(lines?.map((l) => [l.accountId, l.debitCents, l.creditCents])).toEqual([
      ['6061', 3334, 0],
      ['6063', 3333, 0],
      ['6064', 3333, 0],
      ['bank', 0, 10000],
    ])
    const debit = lines!.reduce((s, l) => s + l.debitCents, 0)
    const credit = lines!.reduce((s, l) => s + l.creditCents, 0)
    expect(debit).toBe(credit)
  })

  it('moves a negative amount to the other side, nets a two sided line and drops empty lines', () => {
    const lines = toCentLines([line('606', -10, 0), line('bank', 30, 20), line('empty', 0, 0)], 'bank')
    expect(lines?.map((l) => [l.accountId, l.debitCents, l.creditCents])).toEqual([
      ['606', 0, 1000],
      ['bank', 1000, 0],
    ])
  })

  it('refuses an entry whose imbalance is more than one cent per line', () => {
    expect(toCentLines([line('606', 100, 0), line('bank', 0, 99.9)], 'bank')).toBeNull()
  })

  it('refuses a residue when only the bank line could absorb it', () => {
    expect(toCentLines([line('bank', 0.01, 0)], 'bank')).toBeNull()
  })
})
