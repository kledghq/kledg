/**
 * Ponto adapter: the aggregator for banks without a direct connector.
 *
 * Ponto synchronizes every account with the bank four times a day; Kledg
 * reads that data (cron and "Synchroniser") and only asks for a fresh bank
 * synchronization when a user clicks "Actualiser" (requestRefresh), with
 * the user's IP, at most every 5 minutes per account (Ponto refuses more).
 * Only booked transactions are read: pending ones are "provided only for
 * information purposes" and "shall not be considered in your bookkeeping".
 * https://documentation.myponto.com/custom-integrations
 * https://documentation.myponto.com/api
 */

import { ValidationError } from '@/lib/accounting/errors'
import { errorReason } from '@/lib/banking/errors'
import { calendarDayOf, toUtcDateOnly } from '@/lib/utils/date'
import type {
  BankProvider,
  ConnectionHealth,
  ProviderAccount,
  ProviderBalance,
  ProviderInstitution,
  ProviderTransaction,
} from '../types'
import {
  fetchPontoInstitutions,
  PontoClient,
  type JsonApiResource,
  type PontoAccountAttributes,
  type PontoAccountMeta,
  type PontoClientOptions,
  type PontoInstitutionAttributes,
  type PontoTransactionAttributes,
} from './client'

const date = (value: string | null | undefined): Date | null => (value ? new Date(value) : null)

export function mapPontoAccount(resource: JsonApiResource<PontoAccountAttributes>): ProviderAccount {
  const a = resource.attributes
  const institutionId = resource.relationships?.financialInstitution?.data?.id ?? null
  return {
    externalId: resource.id,
    iban: a.referenceType === 'IBAN' ? a.reference.replace(/\s+/g, '') : null,
    name: a.description || a.product || a.reference,
    currency: a.currency,
    balance: a.currentBalance,
    availableBalance: a.availableBalance,
    consentExpiresAt: date(a.authorizationExpirationExpectedAt),
    institution: institutionId ? { id: institutionId, name: '' } : null,
    providerData: { ...a, meta: resource.meta ?? null, financialInstitutionId: institutionId },
  }
}

export function mapPontoTransaction(
  resource: JsonApiResource<PontoTransactionAttributes>,
  accountExternalId: string,
): ProviderTransaction {
  const t = resource.attributes
  const day = t.executionDate ?? t.valueDate
  return {
    externalId: resource.id,
    accountExternalId,
    amount: Math.abs(t.amount),
    side: t.amount < 0 ? 'debit' : 'credit',
    date: toUtcDateOnly(day ?? new Date()),
    valueDate: calendarDayOf(t.valueDate),
    state: 'booked',
    status: 'booked',
    label: t.remittanceInformation || t.description || t.counterpartName || undefined,
    reference: t.endToEndId || undefined,
    note: t.additionalInformation || undefined,
    counterpartyName: t.counterpartName || undefined,
    operationType: t.bankTransactionCode || undefined,
    providerData: { ...t, id: resource.id } as unknown as Record<string, unknown>,
  }
}

export function mapPontoInstitution(resource: JsonApiResource<PontoInstitutionAttributes>): ProviderInstitution {
  const a = resource.attributes
  return {
    id: resource.id,
    name: a.name,
    country: a.country,
    logoUrl: a.logoUrl,
    primaryColor: a.primaryColor,
    status: a.status,
    expectedAuthorizationLifetime: a.expectedAuthorizationLifetime ?? null,
  }
}

export class PontoProvider implements BankProvider {
  readonly id = 'PONTO' as const
  readonly kind = 'aggregator' as const
  readonly client: PontoClient

  constructor(options: PontoClientOptions) {
    if (!options.clientId || !options.clientSecret) {
      throw new ValidationError("Les identifiants Ponto sont incomplets : saisissez l'identifiant et le secret de l'intégration.")
    }
    this.client = new PontoClient(options)
  }

  /** Accounts with the name and logo of their bank (one lookup per bank, a failed one is skipped). */
  async listAccounts(): Promise<ProviderAccount[]> {
    const accounts = (await this.client.listAccounts()).filter((a) => !a.attributes.deprecated).map(mapPontoAccount)
    const institutionIds = [...new Set(accounts.map((a) => a.institution?.id).filter((id): id is string => Boolean(id)))]
    const institutions = new Map<string, { name: string; logoUrl: string | null }>()
    for (const id of institutionIds) {
      try {
        const institution = await this.client.getFinancialInstitution(id)
        institutions.set(id, { name: institution.attributes.name, logoUrl: institution.attributes.logoUrl })
      } catch {
        // The account stays usable without its bank's logo
      }
    }
    return accounts.map((account) => {
      const institution = account.institution ? institutions.get(account.institution.id) : undefined
      if (!institution || !account.institution) return account
      return {
        ...account,
        institution: { id: account.institution.id, name: institution.name },
        providerData: { ...account.providerData, institutionName: institution.name, institutionLogoUrl: institution.logoUrl },
      }
    })
  }

  async syncTransactions(accountExternalId: string, since?: Date): Promise<ProviderTransaction[]> {
    const transactions = await this.client.listTransactions(accountExternalId, since)
    return transactions
      .map((t) => mapPontoTransaction(t, accountExternalId))
      .filter((t) => !since || t.date >= toUtcDateOnly(since))
  }

  async getBalances(): Promise<ProviderBalance[]> {
    return (await this.listAccounts()).map((a) => ({
      accountExternalId: a.externalId,
      current: a.balance,
      available: a.availableBalance ?? null,
      currency: a.currency,
    }))
  }

  async getConnectionHealth(): Promise<ConnectionHealth> {
    try {
      const accounts = await this.client.listAccounts()
      let lastSyncAt: Date | null = null
      let consentExpiresAt: Date | null = null
      const errors: string[] = []
      for (const account of accounts) {
        const meta = (account.meta ?? {}) as PontoAccountMeta
        const synced = date(meta.synchronizedAt)
        if (synced && (!lastSyncAt || synced > lastSyncAt)) lastSyncAt = synced
        const expires = date(account.attributes.authorizationExpirationExpectedAt)
        if (expires && (!consentExpiresAt || expires < consentExpiresAt)) consentExpiresAt = expires
        for (const e of meta.latestSynchronization?.attributes.errors ?? []) errors.push(e.detail || e.code || '')
      }
      return { lastSyncAt, consentExpiresAt, error: errors.filter(Boolean).join(' · ') || null }
    } catch (error) {
      return { lastSyncAt: null, consentExpiresAt: null, error: errorReason(error) }
    }
  }

  async listInstitutions(country = 'FR'): Promise<ProviderInstitution[]> {
    return (await fetchPontoInstitutions(country)).filter((i) => !i.attributes.deprecated).map(mapPontoInstitution)
  }

  async requestRefresh(accountExternalId: string, customerIp: string): Promise<void> {
    await this.client.createSynchronization(accountExternalId, 'accountDetails', customerIp)
    await this.client.createSynchronization(accountExternalId, 'accountTransactions', customerIp)
  }
}
