/**
 * Dashboard indicators from account totals (lib/dashboard/ledger-summary.ts).
 * Sources: PCG art. 821-1 (produits class 7, charges class 6), art. 932-1
 * (account numbering), art. 944-44 (comptes 445), cerfa 2052 lines FC, FS
 * and FT (marge commerciale).
 */

import { describe, expect, it } from 'vitest'

import { summarizeLedger } from '../ledger-summary'

const account = (code: string, debitCents: number, creditCents: number) => ({ code, debitCents, creditCents })

describe('summarizeLedger', () => {
  it("separates the chiffre d'affaires (comptes 70) from all produits (class 7)", () => {
    const summary = summarizeLedger([
      account('706000', 0, 1_000_000),
      account('709000', 5_000, 0), // rebates granted reduce the chiffre d'affaires
      account('740000', 0, 200_000), // subvention: a produit, not chiffre d'affaires
      account('768000', 0, 1_234),
      account('411000', 1_196_234, 0),
    ])
    expect(summary.chiffreAffairesCents).toBe(995_000)
    expect(summary.produitsCents).toBe(1_196_234)
  })

  it('computes the result as produits minus charges, in cents', () => {
    const summary = summarizeLedger([
      account('706000', 0, 1_000_001),
      account('606100', 333_334, 0),
      account('641000', 500_000, 0),
      account('609000', 0, 1_000), // rebates obtained reduce charges
    ])
    expect(summary.chargesCents).toBe(832_334)
    expect(summary.resultatCents).toBe(167_667)
  })

  it('estimates VAT from comptes 445: positive to pay, negative a credit, null without VAT', () => {
    expect(summarizeLedger([account('445710', 0, 20_000), account('445660', 4_500, 0)]).tvaCents).toBe(15_500)
    expect(summarizeLedger([account('445710', 0, 2_000), account('445660', 9_000, 0), account('445670', 1_000, 0)]).tvaCents).toBe(-8_000)
    expect(summarizeLedger([account('706000', 0, 1_000)]).tvaCents).toBeNull()
    // Accounts without movement do not count as VAT activity.
    expect(summarizeLedger([account('445710', 0, 0)]).tvaCents).toBeNull()
  })

  it('reads créances clients (411) and dettes fournisseurs (401) on their natural side', () => {
    const summary = summarizeLedger([
      account('411000', 120_000, 20_000),
      account('411CLIENTA', 5_000, 0),
      account('401000', 3_000, 50_000),
      account('404000', 0, 99_999), // fournisseurs d'immobilisations: not 401
    ])
    expect(summary.creancesClientsCents).toBe(105_000)
    expect(summary.dettesFournisseursCents).toBe(47_000)
  })

  it('reads the bank ledger balance (512)', () => {
    expect(summarizeLedger([account('512000', 150_000, 40_000), account('512100', 0, 10_000), account('530000', 9_999, 0)]).banqueCents).toBe(
      100_000,
    )
  })

  it('computes the marge commerciale only for companies that sell merchandise (2052: FC minus FS and FT)', () => {
    expect(summarizeLedger([account('706000', 0, 100_000), account('604000', 30_000, 0)]).marge).toBeNull()
    expect(
      summarizeLedger([
        account('707000', 0, 500_000),
        account('709700', 10_000, 0),
        account('607000', 200_000, 0),
        account('609700', 0, 5_000),
        account('603700', 15_000, 0),
      ]).marge,
    ).toEqual({ ventesCents: 490_000, coutCents: 210_000, margeCents: 280_000 })
  })

  it('splits charges by post 60 to 65, largest first, and keeps the rest so the parts sum to the total', () => {
    const summary = summarizeLedger([
      account('606000', 10_000, 0),
      account('613200', 50_000, 0),
      account('626000', 5_000, 0),
      account('641000', 80_000, 0),
      account('661100', 1_234, 0),
      account('681100', 20_000, 0),
    ])
    expect(summary.chargesParPoste.map((p) => [p.code, p.cents])).toEqual([
      ['64', 80_000],
      ['61', 50_000],
      ['60', 10_000],
      ['62', 5_000],
      ['63', 0],
      ['65', 0],
    ])
    expect(summary.autresChargesCents).toBe(21_234)
    expect(summary.chargesParPoste.reduce((s, p) => s + p.cents, 0) + summary.autresChargesCents).toBe(summary.chargesCents)
  })
})
