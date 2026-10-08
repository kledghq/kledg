/**
 * Qonto adapter (direct connection, API key).
 * Business API: https://docs.qonto.com/get-started/business-api/overview
 *
 * Same mapping as the former QontoAdapter: accounts are keyed by IBAN and
 * every transaction is stored with its Qonto status (completed, pending,
 * declined), pending lines are displayed but never posted.
 */

import { isMaskedIban } from '@/lib/integrations/providers/qonto/account-id'
import { ValidationError } from '@/lib/accounting/errors'
import { errorReason } from '@/lib/banking/errors'
import { toIsoDateUtc, toUtcDateOnly } from '@/lib/utils/date'
import { QontoClient } from '@/lib/integrations/providers/qonto/client'
import type { QontoTransaction } from '@/lib/integrations/providers/qonto/types'
import type {
  BankProvider,
  ConnectionHealth,
  ProviderAccount,
  ProviderBalance,
  ProviderTransaction,
  ProviderTransactionState,
} from './types'

export interface QontoCredentials {
  login: string
  secretKey: string
}

function stateOf(status: string | undefined): ProviderTransactionState {
  if (status === 'pending') return 'pending'
  if (status === 'declined' || status === 'reversed') return 'rejected'
  return 'booked'
}

export function mapQontoTransaction(transaction: QontoTransaction, accountExternalId: string): ProviderTransaction {
  const vatAmount =
    transaction.vat_amount ?? (transaction.vat_amount_cents != null ? transaction.vat_amount_cents / 100 : undefined)
  const transactionDate = transaction.created_at ?? transaction.settled_at
  const status = transaction.status
  return {
    externalId: transaction.transaction_id,
    accountExternalId,
    amount: transaction.amount,
    side: transaction.side,
    date: toUtcDateOnly(transactionDate),
    // Settlement day: what a bank statement or an aggregator usually books
    valueDate: transaction.settled_at ? toIsoDateUtc(transaction.settled_at) : null,
    state: stateOf(status),
    status: status ?? null,
    label: transaction.label,
    reference: transaction.reference,
    note: transaction.note || undefined,
    logoUrl: transaction.logo?.small || transaction.logo?.medium || undefined,
    counterpartyName: transaction.clean_counterparty_name || undefined,
    category: transaction.category || undefined,
    cashflowCategory: transaction.cashflow_category?.name || undefined,
    cashflowSubcategory: transaction.cashflow_subcategory?.name || undefined,
    operationType: transaction.operation_type || undefined,
    // Qonto sets vat_rate to -1 when the rate is not a standard one
    vatRate: transaction.vat_rate != null && Number(transaction.vat_rate) >= 0 ? transaction.vat_rate : undefined,
    vatAmount: vatAmount ?? undefined,
    providerData: transaction as unknown as Record<string, unknown>,
  }
}

export class QontoProvider implements BankProvider {
  readonly id = 'QONTO' as const
  readonly kind = 'direct' as const
  private client: QontoClient

  constructor(credentials: QontoCredentials) {
    if (!credentials.login || !credentials.secretKey) {
      throw new ValidationError("Les identifiants Qonto sont incomplets : saisissez l'identifiant et la clé secrète.")
    }
    this.client = new QontoClient(credentials.login, credentials.secretKey)
  }

  async listAccounts(): Promise<ProviderAccount[]> {
    const organization = await this.client.getOrganization()
    return organization.organization.bank_accounts.map((account) => ({
      // The IBAN stays the identifier of existing connections; a masked one
      // (sandbox) is not unique, so the account id is used instead.
      externalId: isMaskedIban(account.iban) ? account.id : account.iban,
      iban: account.iban,
      name: account.slug || account.iban,
      balance: account.balance,
      currency: account.currency,
      providerData: account as unknown as Record<string, unknown>,
    }))
  }

  async syncTransactions(accountExternalId: string, since?: Date): Promise<ProviderTransaction[]> {
    // Query by Qonto's account id, resolved from the stored identifier (IBAN or id).
    const organization = await this.client.getOrganization()
    const account = organization.organization.bank_accounts.find(
      (a) => a.id === accountExternalId || a.iban === accountExternalId,
    )
    const transactions = await this.client.getAllTransactions(
      account?.id ?? accountExternalId,
      since ? since.toISOString().split('T')[0] : undefined,
    )
    return transactions.map((t) => mapQontoTransaction(t, accountExternalId))
  }

  async getBalances(): Promise<ProviderBalance[]> {
    const accounts = await this.client.getAccounts()
    return accounts.map((a) => ({
      accountExternalId: a.iban,
      current: a.balance,
      available: a.authorized_balance ?? null,
      currency: a.currency,
    }))
  }

  async getConnectionHealth(): Promise<ConnectionHealth> {
    try {
      await this.client.getOrganization()
      return { lastSyncAt: null, consentExpiresAt: null, error: null }
    } catch (error) {
      return { lastSyncAt: null, consentExpiresAt: null, error: errorReason(error) }
    }
  }
}
