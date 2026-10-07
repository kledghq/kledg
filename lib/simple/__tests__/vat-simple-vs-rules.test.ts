/**
 * Simple mode books the VAT of a bank payment as the rules library template
 * of the same supplier does (R3 QUAL-03 and QUAL-13).
 *
 * - Services of a supplier established outside France (Notion, GitHub,
 *   Google Ads, Meta...): taxed in France and due by the customer (CGI art.
 *   259, 1° and 283, 2; BOI-TVA-DECLA-10-10-20): the price paid holds no
 *   French VAT; 20 % is self-assessed on 4452 and deducted on 44566. Simple
 *   mode used to carve 1/6 of the price out as deductible VAT.
 * - Bank fees (Qonto): exempt unless the bank opted (CGI art. 261 C, 1° and
 *   260 B): the VAT the bank read is deducted. Simple mode used to book the
 *   whole amount on 627.
 */

import { describe, expect, it } from 'vitest'
import { bankText, matchDictionary, PAYEES } from '../payees'
import { findCategory, SUPPLIER_VAT } from '../categories'
import { foreignSupplierOf, supplierVatAnswerOf } from '../foreign-suppliers'
import { buildPostingLines, resolvePosting } from '../posting'
import { ruleTemplateById } from '@/lib/rules-library/catalog'
import { calculateAmountsWithVAT } from '@/lib/transactions/entry-line-calculator'

/** What simple mode books for a bank label, the supplier question answered as the server answers it. */
function simplePlan(label: string, amountCents: number, options: { bankVatCents?: number | null; recoveryRatio?: number | null } = {}) {
  const match = matchDictionary(PAYEES, bankText(null, label), 'debit')
  const category = findCategory(match?.categoryId)!
  const answers = category.question?.id === SUPPLIER_VAT.id ? { [SUPPLIER_VAT.id]: supplierVatAnswerOf({ label }) } : {}
  const resolution = resolvePosting(category, answers, amountCents, options.bankVatCents)
  if (resolution.status !== 'ready') throw new Error(resolution.status)
  const plan = buildPostingLines({ category, posting: resolution.posting, side: 'debit', amountCents, bankVatCents: options.bankVatCents, recoveryRatio: options.recoveryRatio ?? null })
  return { categoryId: category.id, plan, lines: plan.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents]) }
}

describe('foreign SaaS and ads: self-assessed, as the rules library books them (QUAL-03)', () => {
  it('a 10,00 € Notion payment: 6511 10,00, 44566 2,00 deducted and 4452 2,00 due', () => {
    const { categoryId, plan, lines } = simplePlan('CB NOTION LABS INC', 1000)
    expect(categoryId).toBe('logiciels')
    expect(lines).toEqual([
      ['6511', 1000, 0],
      ['44566', 200, 0],
      ['4452', 0, 200],
    ])
    expect(plan.vatNote).toMatch(/autoliquidée/)
    // The template of the rules library: the whole 10,00 on 6511, 20 % self-assessed
    const line = ruleTemplateById('notion')!.lines[0]
    expect(line.vatType).toBe('import')
    expect(line.vatAccountCode).toBe('44566')
    expect(line.vatAccount2Code).toBe('4452')
    const amounts = calculateAmountsWithVAT({ ...line, vatRate: line.vatRate ?? null }, 10, null)
    expect(amounts.amountHT).toBe(10)
    expect(amounts.vatAmount).toBeCloseTo(2, 10)
  })

  it('every supplier the library self-assesses is recognised; French suppliers keep French VAT', () => {
    for (const label of ['MICROSOFT*365 BUSINESS', 'ADOBE *CREATIVE CLOUD', 'GITHUB, INC.', 'OPENAI *CHATGPT SUBSCR', 'ANTHROPIC', 'CANVA* 04012345', 'GOOGLE*ADS5612345', 'FACEBK *ABCDEF', 'LINKEDIN *ADS']) {
      expect(foreignSupplierOf({ label, counterpartyName: null }), label).not.toBeNull()
    }
    for (const label of ['PRLV SEPA OVH', 'SCALEWAY', 'GANDI SAS', 'CB NOTIONS DE COUTURE']) {
      expect(supplierVatAnswerOf({ label }), label).toBe('french')
    }
    const { lines } = simplePlan('PRLV SEPA OVHCLOUD', 1200)
    expect(lines).toEqual([
      ['6511', 1000, 0],
      ['44566', 200, 0],
    ])
  })

  it('a partly exempt company deducts its coefficient of the self-assessed VAT, the rest stays in the charge', () => {
    // Coefficient 60 %: 2,00 € due, 1,20 € deducted, 0,80 € in the charge (CGI ann. II art. 205)
    expect(simplePlan('GITHUB, INC.', 1000, { recoveryRatio: 0.6 }).lines).toEqual([
      ['6511', 1080, 0],
      ['44566', 120, 0],
      ['4452', 0, 200],
    ])
    // A franchise owes the self-assessed VAT and deducts none (CGI art. 293 B and 283, 2)
    expect(simplePlan('GITHUB, INC.', 1000, { recoveryRatio: 0 }).lines).toEqual([
      ['6511', 1200, 0],
      ['4452', 0, 200],
    ])
  })
})

describe('bank fees: the VAT the bank read is deducted, as the template qonto-frais books it (QUAL-13)', () => {
  it('Qonto plan 12,00 € with 2,00 € of VAT read: 627 10,00 and 44566 2,00', () => {
    const { categoryId, lines } = simplePlan('QONTO ABONNEMENT ESSENTIAL', 1200, { bankVatCents: 200 })
    expect(categoryId).toBe('frais-bancaires')
    expect(lines).toEqual([
      ['627', 1000, 0],
      ['44566', 200, 0],
    ])
    const line = ruleTemplateById('qonto-frais')!.lines[0]
    expect(calculateAmountsWithVAT({ ...line, vatRate: line.vatRate ?? null }, 12, { vatRate: 20, vatAmount: 2 })).toEqual({ amountHT: 10, amountTTC: 12, vatAmount: 2 })
  })

  it('no VAT read: the whole amount on 627 (exempt banking service, CGI art. 261 C, 1°)', () => {
    const { plan, lines } = simplePlan('QONTO ABONNEMENT ESSENTIAL', 1200)
    expect(lines).toEqual([['627', 1200, 0]])
    expect(plan.vatNote).toMatch(/261 C/)
  })
})
