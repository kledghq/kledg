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
import { mapStripeBalanceTransaction, mapStripePayout, stripeAmount } from '@/lib/banking/providers/stripe/map'
import { STRIPE_PAYOUT_NOT_AUTOMATIC_MESSAGE } from '@/lib/banking/providers/stripe/client'
import { StripeConnectionConfig } from '@/lib/integrations/create-integration.service'
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

/** 2 February 2026, 09:00 UTC: an automatic payout. */
const PAYOUT_DAY = Date.UTC(2026, 1, 2, 9) / 1000

describe('stripe per payout (PCG art. 1031-2, monthly recap at most)', () => {
  const payout = txn({ id: 'txn_po', type: 'payout', amount: -29410, fee: 0, net: -29410, reporting_category: 'payout', description: 'STRIPE PAYOUT', source: 'po_1', created: PAYOUT_DAY, available_on: PAYOUT_DAY })
  const taken = [
    payout,
    // Two payments of January, one of February, a refund of February
    txn({ id: 'txn_a', amount: 10000, fee: 175, created: Date.UTC(2026, 0, 30, 10) / 1000 }),
    txn({ id: 'txn_b', amount: 5000, fee: 100, created: Date.UTC(2026, 0, 31, 23, 30) / 1000 }),
    txn({ id: 'txn_c', amount: 20000, fee: 315, created: Date.UTC(2026, 1, 1, 12) / 1000 }),
    txn({ id: 'txn_d', type: 'refund', amount: -5000, fee: 0, reporting_category: 'refund', created: Date.UTC(2026, 1, 1, 15) / 1000 }),
  ]

  it('sums the transactions of a payout by kind and month, and keeps the payout line', () => {
    const lines = mapStripePayout(payout, taken, 'EUR')
    expect(lines.map((l) => [l.operationType, l.side, l.amount, l.date.toISOString().slice(0, 10)])).toEqual([
      // 31 January 23:30 in Paris is 1 February: txn_b is a February sale
      ['stripe.charge', 'credit', 100, '2026-01-31'],
      ['stripe.fee', 'debit', 1.75, '2026-01-31'],
      ['stripe.charge', 'credit', 250, '2026-02-02'],
      ['stripe.fee', 'debit', 4.15, '2026-02-02'],
      ['stripe.refund', 'debit', 50, '2026-02-02'],
      ['stripe.payout', 'debit', 294.1, '2026-02-02'],
    ])
    // The account moves by zero: everything the payout took leaves with it
    expect(lines.reduce((sum, l) => sum + (l.side === 'credit' ? l.amount : -l.amount), 0)).toBeCloseTo(0, 10)
    expect(lines[2]).toMatchObject({
      externalId: 'txn_po:2026-02:stripe.charge:credit:charge',
      label: 'Paiement : virement po_1, 2 opérations',
      reference: 'po_1',
      status: null,
      providerData: { payout: 'po_1', month: '2026-02', transactions: [expect.objectContaining({ id: 'txn_b', amount: 5000 }), expect.objectContaining({ id: 'txn_c' })] },
    })
    expect(lines[0].label).toBe('Paiement : virement po_1 (01/2026), 1 opération')
    expect(lines[1].category).toBe('fee')
  })

  it('reads the payouts since the last sync and the transactions each one took', async () => {
    const fetch = vi.fn(async (url: string) => {
      const params = new URL(url).searchParams
      if (params.get('payout') === 'po_1') return jsonResponse(200, { data: taken, has_more: false })
      return jsonResponse(200, { data: [payout, taken[3], taken[2]], has_more: false })
    })
    const provider = new StripeProvider({ secretKey: KEY }, { fetch: fetch as unknown as typeof globalThis.fetch, granularity: 'payout' })
    const lines = await provider.syncTransactions('EUR', new Date('2026-02-01T00:00:00Z'))
    // Not yet paid-out transactions have no line; the payout brings its January sales
    expect(lines).toHaveLength(6)
    expect(new Set(lines.map((l) => l.externalId)).size).toBe(6)
    expect(Object.fromEntries(new URL((fetch.mock.calls[1] as unknown as [string])[0]).searchParams)).toEqual({ limit: '100', payout: 'po_1' })
  })

  it('stops on an instant or manual payout, which Stripe cannot break down', async () => {
    const fetch = vi.fn(async (url: string) =>
      new URL(url).searchParams.has('payout')
        ? jsonResponse(400, { error: { type: 'invalid_request_error', message: 'Balance transaction history can only be filtered on automatic transfers' } })
        : jsonResponse(200, { data: [payout], has_more: false }),
    )
    const provider = new StripeProvider({ secretKey: KEY }, { fetch: fetch as unknown as typeof globalThis.fetch, granularity: 'payout' })
    await expect(provider.syncTransactions('EUR')).rejects.toThrow(STRIPE_PAYOUT_NOT_AUTOMATIC_MESSAGE)
  })

  it('takes the granularity from the connection settings', async () => {
    const fetch = vi.fn(async (url: string) =>
      jsonResponse(200, { data: new URL(url).searchParams.has('payout') ? taken : [payout], has_more: false }),
    )
    const of = (config: unknown) => createBankProvider('STRIPE', { secretKey: KEY }, { fetch: fetch as unknown as typeof globalThis.fetch, config })
    expect((await of({ granularity: 'payout' }).syncTransactions('EUR')).map((l) => l.externalId).at(-1)).toBe('txn_po')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect((await of(null).syncTransactions('EUR')).map((l) => l.externalId)).toEqual(['txn_po'])
  })

  it('is per payment unless the connection says per payout', () => {
    expect(StripeConnectionConfig.parse({})).toEqual({ balanceAccount: '517', granularity: 'payment' })
    expect(StripeConnectionConfig.parse({ granularity: 'payout' }).granularity).toBe('payout')
    expect(StripeConnectionConfig.safeParse({ granularity: 'monthly' }).success).toBe(false)
  })
})
