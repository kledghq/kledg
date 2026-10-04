/**
 * Bank providers: one interface, one adapter per way of reaching a bank.
 *
 * - QONTO: Qonto Business API, API key (direct).
 * - REVOLUT: Revolut Business API, OAuth with a client certificate (direct).
 * - PONTO: Ponto (Isabel Group) custom integration, client credentials
 *   (aggregator for the other banks).
 *
 * Direct connectors are preferred over the aggregator when both reach the
 * same IBAN (see lib/banking/dedupe.ts). MANUAL accounts have no provider:
 * their lines come from statement files.
 */

export type BankProviderId = 'QONTO' | 'REVOLUT' | 'PONTO'

/** Direct connections talk to the bank itself; aggregators reach many banks. */
export type BankProviderKind = 'direct' | 'aggregator'

export interface ProviderInstitution {
  id: string
  name: string
  country: string
  logoUrl: string | null
  primaryColor: string | null
  /** Ponto maturity of the connector: stable, beta or experimental. */
  status: 'stable' | 'beta' | 'experimental' | string
  /** Days a PSD2 consent lasts before the user must renew it at the bank. */
  expectedAuthorizationLifetime: number | null
}

export interface ProviderAccount {
  /** Id used to fetch the account's transactions (IBAN for Qonto, uuid elsewhere). */
  externalId: string
  iban: string | null
  name: string
  currency: string
  balance: number
  availableBalance?: number | null
  /** When the bank access (PSD2 consent) of this account must be renewed. */
  consentExpiresAt?: Date | null
  institution?: { id: string; name: string } | null
  providerData?: Record<string, unknown>
}

/**
 * - booked: final, may be posted to the books.
 * - pending: not final (Qonto shows them with their status; never posted).
 * - rejected: declined, failed or reverted.
 */
export type ProviderTransactionState = 'booked' | 'pending' | 'rejected'

export interface ProviderTransaction {
  /** Unique per account at the provider: the dedupe key. */
  externalId: string
  accountExternalId: string
  /** Absolute amount, direction in `side`. */
  amount: number
  side: 'debit' | 'credit'
  date: Date
  /**
   * Value or settlement day (yyyy-mm-dd) when the provider gives one: a
   * second date to recognise the same operation from another source
   * (lib/banking/probable-duplicates.ts).
   */
  valueDate?: string | null
  state: ProviderTransactionState
  /** Provider status as received (e.g. Qonto completed / pending / declined). */
  status?: string | null
  label?: string
  reference?: string
  note?: string
  counterpartyName?: string
  logoUrl?: string
  category?: string
  cashflowCategory?: string
  cashflowSubcategory?: string
  operationType?: string
  vatRate?: number
  vatAmount?: number
  providerData?: Record<string, unknown>
}

export interface ProviderBalance {
  accountExternalId: string
  current: number
  available: number | null
  currency: string
}

export interface ConnectionHealth {
  /** Last time the provider itself refreshed data from the bank, when known. */
  lastSyncAt: Date | null
  /** Earliest consent expiry over the connection's accounts. */
  consentExpiresAt: Date | null
  error: string | null
}

export interface BankProvider {
  readonly id: BankProviderId
  readonly kind: BankProviderKind
  listAccounts(): Promise<ProviderAccount[]>
  /** Transactions of one account since a date (all available history when omitted). */
  syncTransactions(accountExternalId: string, since?: Date): Promise<ProviderTransaction[]>
  getBalances(): Promise<ProviderBalance[]>
  getConnectionHealth(): Promise<ConnectionHealth>
  /** Banks reachable through this provider (aggregators only). */
  listInstitutions?(country?: string): Promise<ProviderInstitution[]>
  /**
   * Asks the provider to refresh its data from the bank now. Only while the
   * user is present (Ponto terms): `customerIp` is the user's real IP.
   */
  requestRefresh?(accountExternalId: string, customerIp: string): Promise<void>
}

/** Whether a synced transaction is stored. Qonto keeps its pending lines (shown with their status, never posted). */
export function shouldStoreTransaction(provider: BankProviderId, tx: ProviderTransaction): boolean {
  if (provider === 'QONTO') return true
  return tx.state === 'booked'
}
