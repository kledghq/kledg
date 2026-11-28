/**
 * Stripe adapter (direct connection, restricted API key, read only).
 *
 * The Stripe balance is a cash account of the company held with a
 * financial institution (PCG 517 "Autres organismes financiers" by default,
 * lib/banking/stripe-ledger.ts): one Kledg account per currency of the
 * balance, keyed by the currency code ("EUR"), with no IBAN. Its lines are
 * the balance transactions (map.ts); its balance is what Stripe holds,
 * available and pending funds together, since the lines include both.
 *
 * Granularity (Integration.config.granularity, chosen at connection):
 * - "payment" (default): every balance transaction, gross and fee (map.ts);
 * - "payout": the automatic payouts made since the last sync, each summed by
 *   kind and month (mapStripePayout). A transaction not yet paid out has no
 *   line until its payout.
 */

import { ValidationError } from '@/lib/accounting/errors'
import { errorReason } from '@/lib/banking/errors'
import type { BankProvider, ConnectionHealth, ProviderAccount, ProviderBalance, ProviderTransaction } from '../types'
import { StripeClient, type StripeBalance } from './client'
import { mapStripeBalanceTransaction, mapStripePayout, stripeAmount } from './map'

export interface StripeCredentials {
  secretKey: string
}

export type StripeGranularity = 'payment' | 'payout'

/** A restricted key (rk_live_ or rk_test_): never the account's secret key, which can move money. */
const RESTRICTED_KEY = /^rk_(live|test)_[A-Za-z0-9]{10,}$/

export const STRIPE_RESTRICTED_KEY_REQUIRED =
  "Collez une clé restreinte Stripe (elle commence par rk_live_), pas la clé secrète du compte (sk_live_) : Kledg n'a besoin que de lire le solde, une clé restreinte en lecture seule ne permet ni paiement ni virement."

export function assertRestrictedStripeKey(secretKey: string): void {
  if (!RESTRICTED_KEY.test(secretKey.trim())) throw new ValidationError(STRIPE_RESTRICTED_KEY_REQUIRED)
}

/** Balance per currency (upper case): available and pending funds, in units of the currency. */
function balancesByCurrency(balance: StripeBalance): Map<string, { current: number; available: number }> {
  const out = new Map<string, { current: number; available: number }>()
  const add = (currency: string, minor: number, available: boolean) => {
    const code = currency.toUpperCase()
    const entry = out.get(code) ?? { current: 0, available: 0 }
    const amount = stripeAmount(minor, currency)
    entry.current += amount
    if (available) entry.available += amount
    out.set(code, entry)
  }
  for (const a of balance.available) add(a.currency, a.amount, true)
  for (const p of balance.pending) add(p.currency, p.amount, false)
  return out
}

export class StripeProvider implements BankProvider {
  readonly id = 'STRIPE' as const
  readonly kind = 'direct' as const
  private client: StripeClient
  private granularity: StripeGranularity

  constructor(credentials: StripeCredentials, options: { fetch?: typeof fetch; apiUrl?: string; granularity?: StripeGranularity } = {}) {
    if (!credentials.secretKey) throw new ValidationError('Collez la clé restreinte Stripe.')
    assertRestrictedStripeKey(credentials.secretKey)
    this.client = new StripeClient({ secretKey: credentials.secretKey.trim(), fetch: options.fetch, apiUrl: options.apiUrl })
    this.granularity = options.granularity ?? 'payment'
  }

  async listAccounts(): Promise<ProviderAccount[]> {
    const balance = await this.client.getBalance()
    const test = balance.livemode === false
    return [...balancesByCurrency(balance)].map(([currency, amounts]) => ({
      externalId: currency,
      iban: null,
      name: test ? `Stripe ${currency} (test)` : `Stripe ${currency}`,
      currency,
      balance: amounts.current,
      availableBalance: amounts.available,
      providerData: { livemode: balance.livemode ?? null },
    }))
  }

  async syncTransactions(accountExternalId: string, since?: Date): Promise<ProviderTransaction[]> {
    const transactions = await this.client.listBalanceTransactions(accountExternalId, since)
    if (this.granularity === 'payment') return transactions.flatMap((txn) => mapStripeBalanceTransaction(txn, accountExternalId))
    const lines: ProviderTransaction[] = []
    // One payout at a time: a few payouts per sync, each read page by page
    for (const payout of transactions.filter((txn) => txn.type === 'payout')) {
      const source = typeof payout.source === 'string' ? payout.source : payout.source?.id
      const taken = source ? await this.client.listPayoutTransactions(source) : []
      lines.push(...mapStripePayout(payout, taken, accountExternalId))
    }
    return lines
  }

  async getBalances(): Promise<ProviderBalance[]> {
    const balance = await this.client.getBalance()
    return [...balancesByCurrency(balance)].map(([currency, amounts]) => ({
      accountExternalId: currency,
      current: amounts.current,
      available: amounts.available,
      currency,
    }))
  }

  async getConnectionHealth(): Promise<ConnectionHealth> {
    try {
      await this.client.getBalance()
      return { lastSyncAt: null, consentExpiresAt: null, error: null }
    } catch (error) {
      return { lastSyncAt: null, consentExpiresAt: null, error: errorReason(error) }
    }
  }
}
