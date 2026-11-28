/**
 * Stripe API client, read only, with a restricted API key (rk_live_ or
 * rk_test_) the user creates in the Stripe Dashboard.
 *
 * - Balance: GET /v1/balance (https://docs.stripe.com/api/balance/balance_object)
 * - Balance transactions: GET /v1/balance_transactions
 *   (https://docs.stripe.com/api/balance_transactions/list), most recent
 *   first, cursor pagination (limit up to 100, starting_after), filters
 *   created[gte], currency and payout. The payout filter works "for
 *   automatic Stripe payouts only": Stripe cannot tell which transactions
 *   an instant or manual payout took (https://docs.stripe.com/reports/payout-reconciliation).
 * - Restricted keys: https://docs.stripe.com/keys/restricted-api-keys
 *
 * Amounts are integers in the smallest unit of the currency (money.ts).
 * Errors: 401 is a key Stripe does not know, 403 a key that lacks a
 * permission (Stripe names it in its message, logged here).
 */

import { z } from 'zod'
import { ExternalServiceError } from '@/lib/accounting/errors'
import { BankAuthorizationError, providerError } from '@/lib/banking/errors'
import { bankFetch } from '@/lib/banking/http'
import { parseProviderResponse } from '@/lib/banking/provider-response'

const STRIPE_API_URL = 'https://api.stripe.com/v1'

/** Lines read per page (Stripe's maximum). */
const PAGE_SIZE = 100
/** Pages read per account and sync at most: 100 000 operations, a bound on a runaway loop. */
const MAX_PAGES = 1000

/** A restricted key that cannot read the balance: what to give it, in the Stripe Dashboard. */
export const STRIPE_KEY_PERMISSIONS_MESSAGE =
  "La clé Stripe n'a pas les droits nécessaires : dans le Dashboard Stripe (Développeurs, Clés API), donnez à la clé restreinte l'accès en lecture au solde (Balance), puis réessayez."

/** Shown when Stripe does not recognise the key (revoked, expired, mistyped). */
export const STRIPE_KEY_REFUSED_MESSAGE =
  'Stripe refuse cette clé : vérifiez la clé restreinte (rk_live_…) dans le Dashboard Stripe, ou créez-en une nouvelle, puis mettez-la à jour depuis la page Banque.'

/** Per-payout mode on a payout Stripe cannot break down (instant or manual). */
export const STRIPE_PAYOUT_NOT_AUTOMATIC_MESSAGE =
  "Stripe ne détaille pas les opérations d'un virement instantané ou manuel : le mode « par virement » ne fonctionne qu'avec les virements automatiques. Reconnectez Stripe en mode « par paiement », ou repassez aux virements automatiques dans le Dashboard Stripe."

const BalanceAmountSchema = z.looseObject({ amount: z.number().int(), currency: z.string() })

const BalanceSchema = z.looseObject({
  available: z.array(BalanceAmountSchema),
  pending: z.array(BalanceAmountSchema),
  livemode: z.boolean().optional(),
})

const BalanceTransactionSchema = z.looseObject({
  id: z.string(),
  amount: z.number().int(),
  fee: z.number().int(),
  net: z.number().int(),
  currency: z.string(),
  created: z.number().int(),
  available_on: z.number().int().nullish(),
  type: z.string(),
  reporting_category: z.string().nullish(),
  description: z.string().nullish(),
  source: z.union([z.string(), z.looseObject({ id: z.string() })]).nullish(),
  status: z.string().nullish(),
})

const BalanceTransactionPageSchema = z.looseObject({
  data: z.array(BalanceTransactionSchema),
  has_more: z.boolean(),
})

export type StripeBalance = z.infer<typeof BalanceSchema>
export type StripeBalanceTransaction = z.infer<typeof BalanceTransactionSchema>

export interface StripeClientOptions {
  secretKey: string
  fetch?: typeof fetch
  /** Tests point the client at a fake server. */
  apiUrl?: string
}

export class StripeClient {
  private readonly secretKey: string
  private readonly fetchImpl: typeof fetch
  private readonly apiUrl: string

  constructor(options: StripeClientOptions) {
    this.secretKey = options.secretKey
    this.fetchImpl = options.fetch ?? fetch
    this.apiUrl = (options.apiUrl ?? STRIPE_API_URL).replace(/\/$/, '')
  }

  private async get(path: string, params: URLSearchParams, operation: string, onBadRequest?: string): Promise<unknown> {
    const query = params.toString()
    const response = await bankFetch('Stripe', this.fetchImpl, `${this.apiUrl}${path}${query ? `?${query}` : ''}`, {
      headers: { Authorization: `Bearer ${this.secretKey}`, Accept: 'application/json' },
    })
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const error = (body as { error?: { code?: string; message?: string; type?: string } } | null)?.error
      // Logged with Stripe's detail (the permission it lacks), shown in French
      const failure = providerError({ provider: 'Stripe', status: response.status, code: error?.code, detail: error?.message, operation })
      if (response.status === 401) throw new BankAuthorizationError(STRIPE_KEY_REFUSED_MESSAGE)
      if (response.status === 403) throw new BankAuthorizationError(STRIPE_KEY_PERMISSIONS_MESSAGE)
      if (response.status === 400 && onBadRequest) throw new ExternalServiceError(onBadRequest)
      throw failure
    }
    return body
  }

  async getBalance(): Promise<StripeBalance> {
    const body = await this.get('/balance', new URLSearchParams(), 'balance')
    return parseProviderResponse<StripeBalance>('Stripe', 'balance', BalanceSchema, body)
  }

  /** Every balance transaction in `currency` created since `since` (all history when omitted), most recent first. */
  listBalanceTransactions(currency: string, since?: Date): Promise<StripeBalanceTransaction[]> {
    const params = new URLSearchParams({ currency: currency.toLowerCase() })
    if (since) params.set('created[gte]', String(Math.floor(since.getTime() / 1000)))
    return this.listPages(params)
  }

  /**
   * The balance transactions an automatic payout took, whenever they were
   * created. Stripe answers 400 for an instant or manual payout.
   */
  listPayoutTransactions(payoutId: string): Promise<StripeBalanceTransaction[]> {
    return this.listPages(new URLSearchParams({ payout: payoutId }), STRIPE_PAYOUT_NOT_AUTOMATIC_MESSAGE)
  }

  private async listPages(filters: URLSearchParams, onBadRequest?: string): Promise<StripeBalanceTransaction[]> {
    const all: StripeBalanceTransaction[] = []
    let startingAfter: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      for (const [key, value] of filters) params.set(key, value)
      if (startingAfter) params.set('starting_after', startingAfter)
      const body = await this.get('/balance_transactions', params, 'balance_transactions', onBadRequest)
      const { data, has_more } = parseProviderResponse<z.infer<typeof BalanceTransactionPageSchema>>(
        'Stripe',
        'balance_transactions',
        BalanceTransactionPageSchema,
        body,
      )
      all.push(...data)
      if (!has_more || data.length === 0) return all
      startingAfter = data[data.length - 1].id
    }
    throw new ExternalServiceError(
      "Stripe renvoie plus de 100 000 opérations pour ce compte : réduisez la période de synchronisation (SYNC_MAX_DAYS), puis réessayez.",
    )
  }
}
