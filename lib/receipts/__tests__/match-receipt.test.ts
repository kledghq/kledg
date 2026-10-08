import { describe, expect, it } from 'vitest'
import {
  candidateWindow,
  dateScore,
  matchReceipt,
  merchantSimilarity,
  originalAmountOf,
  scoreCandidate,
  type ReceiptFields,
  type TransactionCandidate,
} from '../match-receipt'

const receipt = (over: Partial<ReceiptFields> = {}): ReceiptFields => ({ amountCents: 4_350, currency: 'EUR', date: '2026-10-03', merchant: 'Boulangerie du Marché', paymentHint: null, ...over })

const tx = (id: string, over: Partial<TransactionCandidate> = {}): TransactionCandidate => ({
  id,
  date: '2026-10-04',
  amountCents: 4_350,
  side: 'debit',
  label: 'CB BOULANGERIE DU MARCHE 03/10',
  counterpartyName: null,
  original: null,
  hasReceipt: false,
  supplierNames: [],
  ...over,
})

describe('receipt matching (pure scoring)', () => {
  it('matches one transaction with the amount, the date and the merchant', () => {
    const result = matchReceipt(receipt(), [tx('t1'), tx('t2', { amountCents: 1_200, label: 'PRLV EDF' })])
    expect(result.outcome).toBe('matched')
    if (result.outcome !== 'matched') return
    expect(result.match.transactionId).toBe('t1')
    expect(result.match.amountMatch).toBe(true)
    expect(result.match.dayOffset).toBe(1)
    expect(result.match.reasons).toEqual(['Montant identique', 'Débitée 1 jour après', 'Même commerçant'])
    expect(result.match.score).toBe(1)
  })

  it('tolerates one cent on the amount, not two', () => {
    expect(scoreCandidate(receipt(), tx('t', { amountCents: 4_351 }))?.amountMatch).toBe(true)
    expect(scoreCandidate(receipt(), tx('t', { amountCents: 4_352 }))?.amountMatch).toBe(false)
  })

  it('keeps the date window from 3 days before to 10 days after', () => {
    expect(scoreCandidate(receipt(), tx('t', { date: '2026-09-30' }))).not.toBeNull()
    expect(scoreCandidate(receipt(), tx('t', { date: '2026-09-29' }))).toBeNull()
    expect(scoreCandidate(receipt(), tx('t', { date: '2026-10-13' }))).not.toBeNull()
    expect(scoreCandidate(receipt(), tx('t', { date: '2026-10-14' }))).toBeNull()
    expect(candidateWindow('2026-10-03')).toEqual({ from: '2026-09-30', to: '2026-10-13' })
    expect([dateScore(0), dateScore(2), dateScore(-1), dateScore(10), dateScore(11)]).toEqual([1, 1, 0.85, 0.3, 0])
  })

  it('never proposes a credit nor a transaction that already has its receipt', () => {
    expect(matchReceipt(receipt(), [tx('credit', { side: 'credit' }), tx('done', { hasReceipt: true })])).toEqual({ outcome: 'none', candidates: [], reason: 'no_candidate' })
  })

  it('proposes candidates when two transactions are as likely (no margin)', () => {
    const result = matchReceipt(receipt({ merchant: null }), [tx('a', { date: '2026-10-03' }), tx('b', { date: '2026-10-04' })])
    expect(result.outcome).toBe('candidates')
    expect(result.candidates.map((c) => c.transactionId)).toEqual(['a', 'b'])
  })

  it('proposes, never matches, a transaction with the merchant but another amount', () => {
    const result = matchReceipt(receipt({ amountCents: 4_000 }), [tx('t1')])
    expect(result.outcome).toBe('candidates')
    expect(result.candidates[0].reasons).toContain('Montant différent')
    // Neither the amount nor the merchant: nothing
    expect(matchReceipt(receipt({ amountCents: 4_000 }), [tx('t2', { label: 'PRLV EDF' })]).outcome).toBe('none')
  })

  it('needs the margin: an exact amount far in the window with an unknown merchant is only a candidate', () => {
    const result = matchReceipt(receipt({ merchant: 'Inconnu' }), [tx('t', { date: '2026-10-12', label: 'CB XYZ' })])
    expect(result.outcome).toBe('candidates')
  })

  it("compares a foreign currency receipt with the transaction's original amount", () => {
    const usd = receipt({ currency: 'usd', amountCents: 2_000, merchant: 'OpenAI' })
    const withOriginal = tx('t1', { amountCents: 1_853, label: 'CB OPENAI *CHATGPT', original: { amountCents: 2_000, currency: 'USD' } })
    const result = matchReceipt(usd, [withOriginal])
    expect(result.outcome).toBe('matched')
    if (result.outcome === 'matched') expect(result.match.reasons[0]).toBe('Montant d’origine identique (USD)')
    // Without the original amount, only the merchant can make it a candidate
    const without = scoreCandidate(usd, { ...withOriginal, original: null })
    expect(without?.amountMatch).toBe(false)
    expect(without?.reasons).toContain('Montant en USD non comparable')
  })

  it('never matches a receipt paid personally: it is an expense report', () => {
    expect(matchReceipt(receipt({ paymentHint: 'personal_card' }), [tx('t1')])).toEqual({ outcome: 'none', candidates: [], reason: 'personal_payment' })
    expect(matchReceipt(receipt({ paymentHint: 'cash' }), [tx('t1')]).outcome).toBe('none')
    expect(matchReceipt(receipt({ paymentHint: 'company_card' }), [tx('t1')]).outcome).toBe('matched')
  })

  it('keeps 5 candidates at most, best first', () => {
    const many = Array.from({ length: 8 }, (_, i) => tx(`t${i}`, { date: `2026-10-0${3 + (i % 5)}`, label: 'CB AUTRE' }))
    const result = matchReceipt(receipt({ merchant: null }), many)
    expect(result.candidates).toHaveLength(5)
    expect(result.candidates[0].score).toBeGreaterThanOrEqual(result.candidates[4].score)
  })
})

describe('merchant similarity', () => {
  it('reads the same known vendor on both sides', () => {
    expect(merchantSimilarity('OVHcloud', ['PRLV SEPA OVH SAS'])).toBe(1)
  })

  it('counts the words of the merchant found in the label, without accents nor generic words', () => {
    expect(merchantSimilarity('Boulangerie du Marché', ['CB BOULANGERIE DU MARCHE'])).toBe(1)
    expect(merchantSimilarity('Café de Flore', ['CB CAFE LE PROCOPE'])).toBe(0.5)
    expect(merchantSimilarity('SAS', ['CB SAS'])).toBe(0)
    expect(merchantSimilarity(null, ['CB X'])).toBe(0)
  })

  it('uses the supplier recognised in the label', () => {
    expect(merchantSimilarity('Imprimerie Martin', ['VIR SEPA 2026-114', null, 'Imprimerie Martin'])).toBe(1)
  })
})

describe('original amount of a synced transaction', () => {
  it('reads Qonto local_amount and local_currency, ignores euros', () => {
    expect(originalAmountOf({ local_amount: -20, local_currency: 'USD' })).toEqual({ amountCents: 2_000, currency: 'USD' })
    expect(originalAmountOf({ local_amount_cents: 1999, local_currency: 'gbp' })).toEqual({ amountCents: 1_999, currency: 'GBP' })
    expect(originalAmountOf({ local_amount: 20, local_currency: 'EUR' })).toBeNull()
    expect(originalAmountOf(null)).toBeNull()
    expect(originalAmountOf({ local_currency: 'USD' })).toBeNull()
  })
})
