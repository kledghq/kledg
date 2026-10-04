/**
 * Revolut Business adapter (direct connection).
 *
 * - Accounts: GET /accounts, active EUR accounts only, IBAN from
 *   GET /accounts/{id}/bank-details.
 * - Transactions: GET /transactions per account. A transaction has one leg
 *   per Revolut account it touches (two for a transfer between your own
 *   accounts): each leg of this account becomes one bank line, keyed
 *   `<transaction id>:<leg id>`. Only state "completed" is stored.
 *
 * https://developer.revolut.com/docs/business/business-api
 * https://developer.revolut.com/docs/guides/manage-accounts/accounts-and-transactions/retrieve-transactions
 */

import { errorReason } from '@/lib/banking/errors'
import { toUtcDateOnly } from '@/lib/utils/date'
import type {
  BankProvider,
  ConnectionHealth,
  ProviderAccount,
  ProviderBalance,
  ProviderTransaction,
  ProviderTransactionState,
} from '../types'
import { RevolutClient, type RevolutClientOptions, type RevolutTransaction } from './client'
import { REVOLUT_CONSENT_DAYS } from './config'

function stateOf(state: RevolutTransaction['state']): ProviderTransactionState {
  if (state === 'completed') return 'booked'
  if (state === 'created' || state === 'pending') return 'pending'
  return 'rejected'
}

/** Bank lines of `accountId` in a Revolut transaction (one per leg on that account). */
export function mapRevolutTransaction(tx: RevolutTransaction, accountId: string): ProviderTransaction[] {
  return tx.legs
    .filter((leg) => leg.account_id === accountId)
    .map((leg) => ({
      externalId: `${tx.id}:${leg.leg_id}`,
      accountExternalId: accountId,
      amount: Math.abs(leg.amount),
      side: leg.amount < 0 ? ('debit' as const) : ('credit' as const),
      date: toUtcDateOnly(tx.completed_at ?? tx.created_at),
      state: stateOf(tx.state),
      status: tx.state,
      label: leg.description || tx.merchant?.name || tx.reference || tx.type,
      reference: tx.reference || undefined,
      counterpartyName: tx.merchant?.name || leg.counterparty?.name || undefined,
      operationType: tx.type,
      providerData: { ...tx, legs: [leg] } as unknown as Record<string, unknown>,
    }))
}

export interface RevolutProviderOptions extends RevolutClientOptions {
  /** When the current refresh token was granted (consent start). */
  authorizedAt?: Date | null
}

export class RevolutProvider implements BankProvider {
  readonly id = 'REVOLUT' as const
  readonly kind = 'direct' as const
  readonly client: RevolutClient
  private readonly authorizedAt: Date | null

  constructor(options: RevolutProviderOptions) {
    this.client = new RevolutClient(options)
    this.authorizedAt = options.authorizedAt ?? null
  }

  /** Refresh tokens expire 90 days after the user's consent (PSD2 SCA). */
  consentExpiresAt(): Date | null {
    return this.authorizedAt ? new Date(this.authorizedAt.getTime() + REVOLUT_CONSENT_DAYS * 86_400_000) : null
  }

  async listAccounts(): Promise<ProviderAccount[]> {
    const accounts = (await this.client.getAccounts()).filter((a) => a.state === 'active' && a.currency === 'EUR')
    const consentExpiresAt = this.consentExpiresAt()
    return Promise.all(
      accounts.map(async (account) => {
        const details = await this.client.getBankDetails(account.id)
        const withIban = details.find((d) => d.iban)
        return {
          externalId: account.id,
          iban: withIban?.iban?.replace(/\s+/g, '') ?? null,
          name: account.name || 'Revolut Business',
          currency: account.currency,
          balance: account.balance,
          consentExpiresAt,
          providerData: { ...account, bic: withIban?.bic ?? null },
        }
      }),
    )
  }

  async syncTransactions(accountExternalId: string, since?: Date): Promise<ProviderTransaction[]> {
    const transactions = await this.client.getAllTransactions(accountExternalId, since)
    return transactions.flatMap((tx) => mapRevolutTransaction(tx, accountExternalId))
  }

  async getBalances(): Promise<ProviderBalance[]> {
    const accounts = await this.client.getAccounts()
    return accounts
      .filter((a) => a.state === 'active' && a.currency === 'EUR')
      .map((a) => ({ accountExternalId: a.id, current: a.balance, available: null, currency: a.currency }))
  }

  async getConnectionHealth(): Promise<ConnectionHealth> {
    const consentExpiresAt = this.consentExpiresAt()
    try {
      await this.client.getAccounts()
      return { lastSyncAt: null, consentExpiresAt, error: null }
    } catch (error) {
      return { lastSyncAt: null, consentExpiresAt, error: errorReason(error) }
    }
  }
}
