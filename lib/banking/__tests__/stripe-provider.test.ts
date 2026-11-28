/**
 * Stripe adapter (lib/banking/providers/stripe): balance transactions as
 * the lines of a Stripe account, one per currency, per payment (PCG art.
 * 1031-2): the gross amount and the fee as two lines, so the account moves
 * by the net like the Stripe balance; the API read with a restricted key,
 * page by page; refused keys explained in French.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { BankAuthorizationError } from '@/lib/banking/errors'
import { ValidationError } from '@/lib/accounting/errors'
import { StripeProvider } from '@/lib/banking/providers/stripe/provider'
import { mapStripeBalanceTransaction, stripeAmount } from '@/lib/banking/providers/stripe/map'
import type { StripeBalanceTransaction } from '@/lib/banking/providers/stripe/client'
import { createBankProvider } from '@/lib/banking/providers'

const KEY = 'rk_live_51AbCdEfGhIjKlMnOp'

/** 14 March 2026, 23:30 UTC: already the 15th in Paris. */
const LATE_EVENING = Date.UTC(2026, 2, 14, 23, 30) / 1000

function txn(overrides: Partial<StripeBalanceTransaction>): StripeBalanceTransaction {
  return {
    id: 'txn_1',
    amount: 10000,
    fee: 175,
    net: 9825,
    currency: 'eur',
    created: LATE_EVENING,
    available_on: LATE_EVENING + 2 * 86400,
    type: 'charge',
    reporting_category: 'charge',
    description: 'Abonnement Pro',
    source: 'ch_3Q',
    status: 'pending',
    ...overrides,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('stripe balance transactions as account lines', () => {
  it('splits a payment into its gross amount and its fee, on the Paris day', () => {
    const lines = mapStripeBalanceTransaction(txn({}), 'EUR')
    expect(lines.map((l) => [l.externalId, l.side, l.amount, l.operationType])).toEqual([
      ['txn_1', 'credit', 100, 'stripe.charge'],
      ['txn_1:fee', 'debit', 1.75, 'stripe.fee'],
    ])
    // Net movement of the account: the Stripe balance's 98,25 €
    expect(lines.reduce((sum, l) => sum + (l.side === 'credit' ? l.amount : -l.amount), 0)).toBeCloseTo(98.25, 10)
    expect(lines[0]).toMatchObject({
      date: new Date('2026-03-15T00:00:00Z'),
      valueDate: '2026-03-17',
      state: 'booked',
      // Booked even while the funds are pending at Stripe: never stored as 'pending' (not postable)
      status: null,
      label: 'Paiement : Abonnement Pro',
      reference: 'ch_3Q',
      counterpartyName: 'Stripe',
    })
    expect(lines[1].label).toBe('Frais Stripe : paiement ch_3Q')
  })

  it('maps refunds, disputes, payouts and Stripe fees to their operation types', () => {
    const one = (overrides: Partial<StripeBalanceTransaction>) => mapStripeBalanceTransaction(txn({ fee: 0, ...overrides }), 'EUR')
    expect(one({ type: 'refund', amount: -5000, reporting_category: 'refund' })[0]).toMatchObject({
      side: 'debit',
      amount: 50,
      operationType: 'stripe.refund',
    })
    expect(one({ type: 'payout', amount: -98250, description: 'STRIPE PAYOUT', reporting_category: 'payout' })[0]).toMatchObject({
      side: 'debit',
      amount: 982.5,
      operationType: 'stripe.payout',
      label: 'Virement vers votre banque : STRIPE PAYOUT',
    })
    expect(one({ type: 'adjustment', amount: -2000, reporting_category: 'dispute', description: null })[0]).toMatchObject({
      operationType: 'stripe.adjustment',
      label: 'Litige',
    })
    // Billing, Radar, Stripe Tax: software fees (VAT self-assessed); conversion: a payment service fee
    expect(one({ type: 'stripe_fee', amount: -1200, description: 'Billing' })[0].operationType).toBe('stripe.service_fee')
    expect(one({ type: 'tax_fee', amount: -50 })[0].operationType).toBe('stripe.service_fee')
    expect(one({ type: 'stripe_fx_fee', amount: -30 })[0].operationType).toBe('stripe.fee')
  })

  it('credits a fee Stripe gives back, and gives a fee-only transaction its fee line alone', () => {
    expect(mapStripeBalanceTransaction(txn({ type: 'refund', amount: -10000, fee: -175 }), 'EUR').map((l) => [l.side, l.amount])).toEqual([
      ['debit', 100],
      ['credit', 1.75],
    ])
    expect(mapStripeBalanceTransaction(txn({ amount: 0, fee: 30 }), 'EUR').map((l) => l.externalId)).toEqual(['txn_1:fee'])
    expect(mapStripeBalanceTransaction(txn({ amount: 0, fee: 0 }), 'EUR')).toEqual([])
  })

  it('reads amounts in the smallest unit of each currency', () => {
    expect(stripeAmount(1050, 'eur')).toBe(10.5)
    expect(stripeAmount(500, 'jpy')).toBe(500)
    expect(stripeAmount(1234, 'kwd')).toBe(1.234)
  })
})

describe('stripe provider', () => {
  it('refuses the secret key of the account: only a restricted key, read only', () => {
    expect(() => new StripeProvider({ secretKey: 'sk_live_51AbCdEfGhIjKlMnOp' })).toThrow(ValidationError)
    expect(() => createBankProvider('STRIPE', { secretKey: 'pk_live_51AbCdEfGhIjKlMnOp' })).toThrow(/clé restreinte/)
    expect(() => new StripeProvider({ secretKey: KEY })).not.toThrow()
  })

  it('gives one account per currency of the balance, available and pending funds together', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, {
        object: 'balance',
        livemode: true,
        available: [{ amount: 120000, currency: 'eur' }, { amount: 5000, currency: 'usd' }],
        pending: [{ amount: 30050, currency: 'eur' }],
      }),
    )
    const provider = new StripeProvider({ secretKey: KEY }, { fetch: fetch as unknown as typeof globalThis.fetch })
    expect(await provider.listAccounts()).toEqual([
      expect.objectContaining({ externalId: 'EUR', iban: null, name: 'Stripe EUR', currency: 'EUR', balance: 1500.5, availableBalance: 1200 }),
      expect.objectContaining({ externalId: 'USD', name: 'Stripe USD', currency: 'USD', balance: 50 }),
    ])
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.stripe.com/v1/balance')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
  })

  it('reads every page of the balance history of a currency since a date', async () => {
    const pages = [
      { data: [txn({ id: 'txn_3' }), txn({ id: 'txn_2', fee: 0 })], has_more: true },
      { data: [txn({ id: 'txn_1', fee: 0 })], has_more: false },
    ]
    const fetch = vi.fn(async () => jsonResponse(200, pages.shift()))
    const provider = new StripeProvider({ secretKey: KEY }, { fetch: fetch as unknown as typeof globalThis.fetch })
    const lines = await provider.syncTransactions('EUR', new Date('2026-03-01T00:00:00Z'))
    expect(lines.map((l) => l.externalId)).toEqual(['txn_3', 'txn_3:fee', 'txn_2', 'txn_1'])
    const urls = fetch.mock.calls.map((call) => new URL((call as unknown as [string])[0]))
    expect(urls[0].pathname).toBe('/v1/balance_transactions')
    expect(Object.fromEntries(urls[0].searchParams)).toEqual({ limit: '100', currency: 'eur', 'created[gte]': '1772323200' })
    expect(urls[1].searchParams.get('starting_after')).toBe('txn_2')
  })

  it('explains in French a key Stripe does not know and a key without the balance permission', async () => {
    const answer = (status: number, message: string) =>
      new StripeProvider(
        { secretKey: KEY },
        { fetch: (async () => jsonResponse(status, { error: { type: 'invalid_request_error', message } })) as unknown as typeof globalThis.fetch },
      )
    await expect(answer(401, 'Invalid API Key provided').listAccounts()).rejects.toThrow(BankAuthorizationError)
    await expect(answer(401, 'Invalid API Key provided').listAccounts()).rejects.toThrow(/Stripe refuse cette clé/)
    await expect(answer(403, "The provided key does not have the required permissions ('rak_balance_read')").listAccounts()).rejects.toThrow(
      /accès en lecture au solde \(Balance\)/,
    )
    // Stripe's own English message never reaches the user
    await expect(answer(403, 'rak_balance_read').listAccounts()).rejects.not.toThrow(/rak_balance_read/)
  })

  it('stops on a response it does not understand', async () => {
    const provider = new StripeProvider({ secretKey: KEY }, { fetch: (async () => jsonResponse(200, { data: 'nope' })) as unknown as typeof globalThis.fetch })
    await expect(provider.syncTransactions('EUR')).rejects.toThrow(/Réponse inattendue de Stripe/)
  })
})
