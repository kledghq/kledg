/**
 * The entry an invoice posts (lib/invoices/posting-plan.ts), PCG art. 932-1:
 * purchases 401 credit TTC, class 6 debit HT per line, 44566 (44562 for
 * fixed assets) debit VAT per rate; sales 411 debit TTC, class 7 credit HT,
 * 44571 credit VAT per rate, or 44574 for services under VAT on receipts
 * (CGI art. 269, 2, c); credit notes on the opposite sides; VAT franchise
 * (CGI art. 293 B) without deductible VAT.
 */

import { describe, expect, it } from 'vitest'
import { computeInvoiceTotals } from '../amounts'
import { planInvoiceEntry, vatAccountsNeeded, type PlanInput, type PlanLine } from '../posting-plan'

const VAT = { deductible: 'acc-44566', deductibleFixedAssets: 'acc-44562', collected: 'acc-44571', collectedPending: 'acc-44574' }

function input(direction: 'SALE' | 'PURCHASE', lines: Array<Omit<PlanLine, 'totalExclTaxCents'> & { quantity: number; unitPriceCents: number }>, over: Partial<PlanInput> = {}): PlanInput {
  const totals = computeInvoiceTotals(lines.map((l) => ({ quantityThousandths: l.quantity * 1000, unitPriceCents: l.unitPriceCents, vatRateBp: l.vatRateBp })))
  return {
    direction,
    typeCode: '380',
    description: 'Facture F1 Martin',
    lines: lines.map((l, i) => ({ label: l.label, totalExclTaxCents: totals.lineTotalsCents[i], vatRateBp: l.vatRateBp, accountId: l.accountId, nature: l.nature, fixedAsset: l.fixedAsset })),
    breakdown: totals.breakdown,
    totalInclTaxCents: totals.totalInclTaxCents,
    tiers: { accountId: direction === 'SALE' ? 'acc-411' : 'acc-401', auxiliaryAccountNumber: 'C00001', name: 'Martin' },
    vatAccounts: VAT,
    servicesVatOnDebits: false,
    vatExempt: false,
    ...over,
  }
}

const sum = (lines: Array<{ debitCents: number; creditCents: number }>, side: 'debitCents' | 'creditCents') => lines.reduce((s, l) => s + l[side], 0)
const byAccount = (lines: Array<{ accountId: string; debitCents: number; creditCents: number }>) => {
  const map: Record<string, { debit: number; credit: number }> = {}
  for (const l of lines) {
    map[l.accountId] ??= { debit: 0, credit: 0 }
    map[l.accountId].debit += l.debitCents
    map[l.accountId].credit += l.creditCents
  }
  return map
}

describe('purchase invoice with several rates', () => {
  const plan = planInvoiceEntry(
    input('PURCHASE', [
      { label: 'Fournitures', quantity: 2, unitPriceCents: 4999, vatRateBp: 2000, accountId: 'acc-6064', nature: 'GOODS', fixedAsset: false },
      { label: 'Livres', quantity: 1, unitPriceCents: 1234, vatRateBp: 550, accountId: 'acc-6068', nature: 'GOODS', fixedAsset: false },
      { label: 'Transport', quantity: 1, unitPriceCents: 999, vatRateBp: 1000, accountId: 'acc-6241', nature: 'SERVICES', fixedAsset: false },
    ]),
  )

  it('credits 401 with the total including tax and the auxiliary account', () => {
    const tiers = plan.lines[0]
    expect(tiers).toMatchObject({ accountId: 'acc-401', debitCents: 0, creditCents: 9998 + 1234 + 999 + 2000 + 68 + 100, auxiliaryAccountNumber: 'C00001', auxiliaryAccountLabel: 'Martin' })
  })

  it('debits each expense line excluding tax and 44566 per rate', () => {
    const accounts = byAccount(plan.lines)
    expect(accounts['acc-6064']).toEqual({ debit: 9998, credit: 0 })
    expect(accounts['acc-6068']).toEqual({ debit: 1234, credit: 0 })
    expect(accounts['acc-6241']).toEqual({ debit: 999, credit: 0 })
    expect(plan.lines.filter((l) => l.vat === 'deductible').map((l) => l.debitCents)).toEqual([2000, 100, 68])
    expect(plan.lines.filter((l) => l.vat).every((l) => l.accountId === 'acc-44566')).toBe(true)
  })

  it('balances to the cent and leaves nothing pending', () => {
    expect(sum(plan.lines, 'debitCents')).toBe(sum(plan.lines, 'creditCents'))
    expect(plan.pendingVatCents).toBe(0)
  })
})

describe('fixed asset VAT (44562)', () => {
  it('splits one rate between 44562 and 44566 in proportion to the bases', () => {
    const plan = planInvoiceEntry(
      input('PURCHASE', [
        { label: 'Ordinateur', quantity: 1, unitPriceCents: 100000, vatRateBp: 2000, accountId: 'acc-2183', nature: 'GOODS', fixedAsset: true },
        { label: 'Câbles', quantity: 1, unitPriceCents: 3333, vatRateBp: 2000, accountId: 'acc-6063', nature: 'GOODS', fixedAsset: false },
      ]),
    )
    const accounts = byAccount(plan.lines)
    // VAT of the rate: 1 033,33 x 20 % = 206,666 -> 206,67 €, split 200,00 / 6,67 (remainder to the largest base)
    expect(accounts['acc-44562'].debit + accounts['acc-44566'].debit).toBe(20667)
    expect(accounts['acc-44562'].debit).toBe(20001)
    expect(accounts['acc-44566'].debit).toBe(666)
    expect(accounts['acc-2183'].debit).toBe(100000)
    expect(sum(plan.lines, 'debitCents')).toBe(sum(plan.lines, 'creditCents'))
  })

  it('asks only for the VAT accounts the invoice uses', () => {
    const data = input('PURCHASE', [{ label: 'Ordinateur', quantity: 1, unitPriceCents: 1000, vatRateBp: 2000, accountId: 'acc-2183', nature: 'GOODS', fixedAsset: true }])
    expect(vatAccountsNeeded(data)).toEqual(['deductibleFixedAssets'])
  })
})

describe('sales invoice', () => {
  const lines = [
    { label: 'Conseil', quantity: 3, unitPriceCents: 50000, vatRateBp: 2000, accountId: 'acc-706', nature: 'SERVICES' as const, fixedAsset: false },
    { label: 'Livre', quantity: 2, unitPriceCents: 2000, vatRateBp: 550, accountId: 'acc-707', nature: 'GOODS' as const, fixedAsset: false },
  ]

  it('debits 411, credits revenue and collected VAT per rate (option for debits)', () => {
    const plan = planInvoiceEntry(input('SALE', lines, { servicesVatOnDebits: true }))
    const accounts = byAccount(plan.lines)
    expect(accounts['acc-411']).toEqual({ debit: 150000 + 4000 + 30000 + 220, credit: 0 })
    expect(accounts['acc-706']).toEqual({ debit: 0, credit: 150000 })
    expect(accounts['acc-707']).toEqual({ debit: 0, credit: 4000 })
    expect(accounts['acc-44571']).toEqual({ debit: 0, credit: 30220 })
    expect(accounts['acc-44574']).toBeUndefined()
    expect(plan.pendingVatCents).toBe(0)
  })

  it('keeps the VAT of services in 44574 under VAT on receipts (CGI art. 269, 2, c), goods in 44571', () => {
    const plan = planInvoiceEntry(input('SALE', lines))
    const accounts = byAccount(plan.lines)
    expect(accounts['acc-44574']).toEqual({ debit: 0, credit: 30000 })
    expect(accounts['acc-44571']).toEqual({ debit: 0, credit: 220 })
    expect(plan.pendingVatCents).toBe(30000)
    expect(vatAccountsNeeded(input('SALE', lines))).toEqual(expect.arrayContaining(['collected', 'collectedPending']))
  })

  it('posts a credit note (381) on the opposite sides', () => {
    const plan = planInvoiceEntry(input('SALE', lines, { typeCode: '381', servicesVatOnDebits: true }))
    const accounts = byAccount(plan.lines)
    expect(accounts['acc-411']).toEqual({ debit: 0, credit: 184220 })
    expect(accounts['acc-706']).toEqual({ debit: 150000, credit: 0 })
    expect(accounts['acc-44571']).toEqual({ debit: 30220, credit: 0 })
  })

  it('posts a purchase credit note with 401 on the debit side', () => {
    const plan = planInvoiceEntry(
      input('PURCHASE', [{ label: 'Retour', quantity: 1, unitPriceCents: 1000, vatRateBp: 2000, accountId: 'acc-607', nature: 'GOODS', fixedAsset: false }], { typeCode: '381' }),
    )
    expect(byAccount(plan.lines)['acc-401']).toEqual({ debit: 1200, credit: 0 })
    expect(byAccount(plan.lines)['acc-44566']).toEqual({ debit: 0, credit: 200 })
  })
})

describe('VAT franchise (CGI art. 293 B)', () => {
  it('charges the VAT of a purchase to the expense lines, nothing to 44566', () => {
    const data = input(
      'PURCHASE',
      [
        { label: 'A', quantity: 1, unitPriceCents: 1000, vatRateBp: 2000, accountId: 'acc-6061', nature: 'GOODS', fixedAsset: false },
        { label: 'B', quantity: 1, unitPriceCents: 2000, vatRateBp: 2000, accountId: 'acc-6063', nature: 'GOODS', fixedAsset: false },
      ],
      { vatExempt: true },
    )
    expect(vatAccountsNeeded(data)).toEqual([])
    const plan = planInvoiceEntry({ ...data, vatAccounts: {} })
    const accounts = byAccount(plan.lines)
    expect(accounts['acc-6061'].debit).toBe(1200)
    expect(accounts['acc-6063'].debit).toBe(2400)
    expect(accounts['acc-401'].credit).toBe(3600)
    expect(plan.lines.some((l) => l.vat)).toBe(false)
  })
})

describe('refusals', () => {
  it('refuses an invoice whose lines do not match its VAT breakdown', () => {
    const data = input('PURCHASE', [{ label: 'A', quantity: 1, unitPriceCents: 1000, vatRateBp: 2000, accountId: 'acc-6061', nature: 'GOODS', fixedAsset: false }])
    expect(() => planInvoiceEntry({ ...data, breakdown: [{ vatRateBp: 2000, baseCents: 999, vatCents: 200 }] })).toThrow(/hors taxe des lignes/)
    expect(() => planInvoiceEntry({ ...data, totalInclTaxCents: 1201 })).toThrow(/Le total TTC/)
    expect(() => planInvoiceEntry({ ...data, breakdown: [{ vatRateBp: 1000, baseCents: 1000, vatCents: 100 }], totalInclTaxCents: 1100 })).toThrow(/Aucune ligne au taux/)
    expect(() => planInvoiceEntry({ ...data, lines: [] })).toThrow(/aucune ligne/)
  })

  it('refuses a VAT account that was not resolved', () => {
    const data = input('PURCHASE', [{ label: 'A', quantity: 1, unitPriceCents: 1000, vatRateBp: 2000, accountId: 'acc-6061', nature: 'GOODS', fixedAsset: false }])
    expect(() => planInvoiceEntry({ ...data, vatAccounts: {} })).toThrow(/Compte de TVA introuvable/)
  })

  it('posts a 0 % line without any VAT line', () => {
    const plan = planInvoiceEntry(input('SALE', [{ label: 'Formation', quantity: 1, unitPriceCents: 5000, vatRateBp: 0, accountId: 'acc-706', nature: 'SERVICES', fixedAsset: false }]))
    expect(plan.lines).toHaveLength(2)
    expect(plan.pendingVatCents).toBe(0)
  })
})

describe('partly exempt buyer (coefficient de déduction, CGI ann. II art. 205 and 206)', () => {
  const lines = [
    { label: 'Fournitures', quantity: 1, unitPriceCents: 30_000, vatRateBp: 2000, accountId: 'acc-6064', nature: 'GOODS' as const, fixedAsset: false },
    { label: 'Logiciel', quantity: 1, unitPriceCents: 10_000, vatRateBp: 2000, accountId: 'acc-6068', nature: 'SERVICES' as const, fixedAsset: false },
  ]

  it('deducts 60 % of the VAT and charges the rest to the lines in proportion to their bases', () => {
    // VAT 80,00: 48,00 deducted, 32,00 split 24,00 / 8,00 on bases of 300 and 100
    const plan = planInvoiceEntry(input('PURCHASE', lines, { deductionPercent: 60 }))
    expect(byAccount(plan.lines)).toEqual({
      'acc-401': { debit: 0, credit: 48_000 },
      'acc-6064': { debit: 32_400, credit: 0 },
      'acc-6068': { debit: 10_800, credit: 0 },
      'acc-44566': { debit: 4_800, credit: 0 },
    })
    expect(sum(plan.lines, 'debitCents')).toBe(sum(plan.lines, 'creditCents'))
  })

  it('needs no VAT account and deducts nothing at 0 %, all of it at 100 %', () => {
    expect(vatAccountsNeeded(input('PURCHASE', lines, { deductionPercent: 0 }))).toEqual([])
    expect(byAccount(planInvoiceEntry(input('PURCHASE', lines, { deductionPercent: 0 })).lines)['acc-44566']).toBeUndefined()
    expect(byAccount(planInvoiceEntry(input('PURCHASE', lines, { deductionPercent: 100 })).lines)['acc-44566']).toEqual({ debit: 8_000, credit: 0 })
  })

  it('rounds the deductible VAT half up: 33 % of 0,10 € is 0,03 €', () => {
    const plan = planInvoiceEntry(input('PURCHASE', [{ ...lines[0], unitPriceCents: 50 }], { deductionPercent: 33 }))
    expect(byAccount(plan.lines)['acc-44566']).toEqual({ debit: 3, credit: 0 })
    expect(byAccount(plan.lines)['acc-6064']).toEqual({ debit: 57, credit: 0 })
  })

  it('never applies the coefficient to a sale', () => {
    const plan = planInvoiceEntry(input('SALE', lines.map((l) => ({ ...l, accountId: 'acc-706' })), { deductionPercent: 0, servicesVatOnDebits: true }))
    expect(byAccount(plan.lines)['acc-44571']).toEqual({ debit: 0, credit: 8_000 })
  })
})
