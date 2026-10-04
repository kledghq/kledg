/**
 * Bank sync of one integration, whatever its provider (Qonto, Revolut
 * Business, Ponto): accounts first, then the transactions of each account.
 *
 * Invariants:
 * - one BankConnection per company and provider, linked to the integration
 *   holding the credentials;
 * - a provider transaction is stored once per account (dedupe on its id,
 *   unique bankAccountId + externalTransactionId), so re-running is safe;
 * - a provider transaction that duplicates an operation the account holds
 *   from another source (a statement file, the Ponto account replaced by a
 *   direct connection for the same IBAN) is recorded as a match, not
 *   inserted (lib/banking/store-synced-transactions.service.ts);
 * - Revolut and Ponto lines are stored only once booked; Qonto lines keep
 *   their status (pending ones are shown, never posted);
 * - an aggregator (Ponto) account whose IBAN is also reached by a direct
 *   connection stops syncing (lib/banking/sync-rules.ts);
 * - the outcome (last sync, error, consent expiry) is recorded on the
 *   connection and its accounts for the health banners;
 * - an account created by the sync is mapped to the company's 512 account
 *   when there is no choice to make (lib/banking/ledger-account.ts); an
 *   existing mapping is never changed.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { IntegrationFeature, type SyncResult } from '@/lib/integrations/types'
import { logger } from '@/lib/logger'
import { updateEntryDatesFromReconciledTransactions } from '@/lib/services/banking/update-entry-dates-from-transactions.service'
import { openCredentials } from '@/lib/banking/credentials'
import { createBankProvider, isBankProvider, providerKind } from '@/lib/banking/providers'
import { shouldStoreTransaction, type BankProvider } from '@/lib/banking/providers/types'
import { supersededAccounts } from '@/lib/banking/sync-rules'
import { ledgerCodePickerForNewBankAccounts } from '@/lib/banking/ledger-account'
import { storeSyncedTransactions } from '@/lib/banking/store-synced-transactions.service'
import { earliestExpiry } from '@/lib/banking/consent'
import { errorReason } from '@/lib/banking/errors'
import { AccountingError } from '@/lib/accounting/errors'
import { centsToDecimal, toCents } from '@/lib/utils/money'
import { addUtcDays, todayUtc } from '@/lib/utils/date'

const UNREADABLE_CREDENTIALS_MESSAGE =
  'Les identifiants enregistrés de cette banque ne peuvent plus être lus : reconnectez-la depuis la page Banque.'

type IntegrationWithFeatures = Prisma.IntegrationGetPayload<{ include: { featureConfigs: true } }>

export interface SyncOptions {
  /** Days of history to read (default SYNC_MAX_DAYS, else 90). */
  maxDays?: number
  /** Injected in tests. */
  provider?: BankProvider
  now?: Date
}

/** Decimal string for Prisma from a provider amount (rounded to the cent). */
function decimal(value: number): string {
  return centsToDecimal(toCents(value) ?? 0)
}

/**
 * First day to read: the last `maxDays` days while syncs are regular (last
 * one under a week ago or never), else from the last sync day.
 */
export function syncSince(lastSyncAt: Date | null, maxDays: number, now: Date = new Date()): Date {
  const window = addUtcDays(todayUtc(now), -maxDays)
  if (!lastSyncAt) return window
  const daysSinceLastSync = Math.floor((now.getTime() - lastSyncAt.getTime()) / 86_400_000)
  return daysSinceLastSync < 7 ? window : todayUtc(lastSyncAt)
}

export async function syncIntegration(
  integrationId: string,
  encryptionKey: string,
  features?: IntegrationFeature[],
  options: SyncOptions = {},
): Promise<SyncResult> {
  const result: SyncResult = { success: true, itemsSynced: 0, matched: 0, errors: [] }
  const now = options.now ?? new Date()

  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    include: { featureConfigs: { where: { enabled: true } } },
  })
  if (!integration) {
    return { success: false, itemsSynced: 0, errors: ['Connexion bancaire introuvable'] }
  }
  if (integration.status !== 'active') {
    return { success: false, itemsSynced: 0, errors: ["La connexion n'est pas active : terminez ou renouvelez l'autorisation depuis la page Banque."] }
  }
  if (!isBankProvider(integration.provider)) {
    return { success: false, itemsSynced: 0, errors: [`Fournisseur non pris en charge : ${integration.provider}`] }
  }

  let provider: BankProvider
  try {
    provider =
      options.provider ??
      createBankProvider(
        integration.provider,
        openCredentials(integration.provider, integration.credentials, integration.credentialsEncrypted, encryptionKey),
      )
  } catch (error) {
    // Credentials sealed with another instance key, or incomplete: the user reconnects
    if (error instanceof AccountingError) return { success: false, itemsSynced: 0, errors: [errorReason(error)] }
    logger.error('[Sync] Stored credentials unreadable', { integrationId, error })
    return { success: false, itemsSynced: 0, errors: [UNREADABLE_CREDENTIALS_MESSAGE] }
  }

  const connection = await ensureConnection(integration)

  // Accounts first, so transactions can be attached to them
  const enabled = new Set(integration.featureConfigs.map((f) => f.feature as string))
  const requested = (features ?? [...enabled]) as string[]
  const ordered = [IntegrationFeature.BANKING_ACCOUNTS, IntegrationFeature.BANKING_TRANSACTIONS].filter(
    (f) => requested.includes(f) && enabled.has(f),
  )

  for (const feature of ordered) {
    try {
      const partial =
        feature === IntegrationFeature.BANKING_ACCOUNTS
          ? await syncAccounts(integration, connection.id, provider)
          : await syncTransactions(integration, provider, options.maxDays, now)
      result.itemsSynced += partial.itemsSynced
      result.matched = (result.matched ?? 0) + (partial.matched ?? 0)
      result.errors.push(...partial.errors)
    } catch (error) {
      const step = feature === IntegrationFeature.BANKING_ACCOUNTS ? 'Lecture des comptes' : 'Lecture des opérations'
      result.errors.push(`${step} : ${errorReason(error)}`)
    }
  }

  result.success = result.errors.length === 0
  await recordOutcome(integration.id, connection.id, result, now)
  return result
}

/** The company's connection for this provider, linked to the integration. */
async function ensureConnection(integration: IntegrationWithFeatures) {
  const provider = integration.provider as 'QONTO' | 'REVOLUT' | 'PONTO'
  const login = (integration.credentials as Record<string, unknown> | null)?.login
  return prisma.bankConnection.upsert({
    where: { companyId_provider: { companyId: integration.companyId, provider } },
    update: { integrationId: integration.id },
    create: {
      companyId: integration.companyId,
      provider,
      integrationId: integration.id,
      login: typeof login === 'string' ? login : '',
    },
    select: { id: true },
  })
}

async function syncAccounts(
  integration: IntegrationWithFeatures,
  bankConnectionId: string,
  provider: BankProvider,
): Promise<SyncResult> {
  const result: SyncResult = { success: true, itemsSynced: 0, errors: [] }
  const accounts = await provider.listAccounts()
  const known = new Set(
    (
      await prisma.bankAccount.findMany({ where: { bankConnectionId }, select: { externalAccountId: true } })
    ).map((a) => a.externalAccountId),
  )
  // Read once, only when this sync creates an account
  const ledgerCodeFor = accounts.some((a) => !known.has(a.externalId))
    ? await ledgerCodePickerForNewBankAccounts(integration.companyId)
    : () => null

  for (const account of accounts) {
    try {
      const data = {
        iban: account.iban,
        balance: account.balance,
        currency: account.currency,
        ...account.providerData,
      } as Prisma.InputJsonValue
      const resource = await prisma.integrationResource.upsert({
        where: {
          integrationId_resourceType_externalId: {
            integrationId: integration.id,
            resourceType: 'bank_account',
            externalId: account.externalId,
          },
        },
        update: { name: account.name, data },
        create: {
          integrationId: integration.id,
          resourceType: 'bank_account',
          externalId: account.externalId,
          name: account.name,
          data,
          shouldSync: true,
        },
      })

      const fields = {
        iban: account.iban || null,
        name: account.name,
        balance: decimal(account.balance),
        currency: account.currency,
        consentExpiresAt: account.consentExpiresAt ?? null,
        providerData: (account.providerData || undefined) as Prisma.InputJsonValue | undefined,
        integrationResourceId: resource.id,
      }
      const stored = await prisma.bankAccount.upsert({
        where: { bankConnectionId_externalAccountId: { bankConnectionId, externalAccountId: account.externalId } },
        update: fields,
        create: {
          ...fields,
          bankConnectionId,
          externalAccountId: account.externalId,
          shouldSync: resource.shouldSync,
          ledgerAccountCode: ledgerCodeFor(account.currency),
        },
        select: { id: true, shouldSync: true, supersededById: true },
      })
      // The resource's flag drives the sync; the account shows it (a
      // reconnection creates a fresh resource). Superseded accounts are
      // handled by applyDirectPreference below.
      if (!stored.supersededById && stored.shouldSync !== resource.shouldSync) {
        await prisma.bankAccount.update({ where: { id: stored.id }, data: { shouldSync: resource.shouldSync } })
      }
      result.itemsSynced++
    } catch (error) {
      result.errors.push(`Compte ${account.name} : ${errorReason(error)}`)
    }
  }

  await applyDirectPreference(integration.companyId)
  return result
}

/**
 * Marks aggregator accounts covered by a direct connection (same IBAN) as
 * superseded, and releases those no longer covered.
 */
export async function applyDirectPreference(companyId: string): Promise<void> {
  const accounts = await prisma.bankAccount.findMany({
    where: { bankConnection: { companyId } },
    select: { id: true, iban: true, supersededById: true, bankConnection: { select: { provider: true } } },
  })
  const superseded = supersededAccounts(
    accounts.map((a) => ({ id: a.id, iban: a.iban, kind: providerKind(a.bankConnection.provider) })),
  )
  const updates: Prisma.PrismaPromise<unknown>[] = []
  for (const account of accounts) {
    const by = superseded.get(account.id) ?? null
    if (by === account.supersededById) continue
    updates.push(
      prisma.bankAccount.update({
        where: { id: account.id },
        data: by ? { supersededById: by, shouldSync: false } : { supersededById: null, shouldSync: true },
      }),
    )
  }
  if (updates.length > 0) await prisma.$transaction(updates)
}

async function syncTransactions(
  integration: IntegrationWithFeatures,
  provider: BankProvider,
  maxDaysOption: number | undefined,
  now: Date,
): Promise<SyncResult> {
  const result: SyncResult = { success: true, itemsSynced: 0, matched: 0, errors: [] }
  const resources = await prisma.integrationResource.findMany({
    where: { integrationId: integration.id, resourceType: 'bank_account', shouldSync: true },
    include: { bankAccount: { select: { id: true, iban: true, bankConnectionId: true, supersededById: true } } },
  })

  const maxDays = maxDaysOption || syncMaxDays()
  const since = syncSince(integration.lastSyncAt, maxDays, now)

  for (const resource of resources) {
    const bankAccount = resource.bankAccount
    if (!bankAccount || bankAccount.supersededById) continue
    try {
      const incoming = (await provider.syncTransactions(resource.externalId, since)).filter((tx) =>
        shouldStoreTransaction(provider.id, tx),
      )
      const stored = await storeSyncedTransactions({ ...bankAccount, companyId: integration.companyId }, incoming)
      result.itemsSynced += stored.created
      result.matched = (result.matched ?? 0) + stored.matched

      // Align the dates of reconciled draft entries on their transactions
      await updateEntryDatesFromReconciledTransactions({ companyId: integration.companyId, bankAccountId: bankAccount.id })
      await prisma.bankAccount.update({ where: { id: bankAccount.id }, data: { lastSyncedAt: now, lastSyncError: null } })
    } catch (error) {
      const reason = errorReason(error)
      logger.error('[Sync] Bank account sync failed', { resourceId: resource.id, reason })
      result.errors.push(`Compte ${resource.name} : ${reason}`)
      await prisma.bankAccount.update({ where: { id: bankAccount.id }, data: { lastSyncError: reason } })
    }
  }
  return result
}

/** SYNC_MAX_DAYS (1 to 3650), else 90. */
function syncMaxDays(): number {
  const value = Number.parseInt(process.env.SYNC_MAX_DAYS ?? '', 10)
  return Number.isInteger(value) && value >= 1 && value <= 3650 ? value : 90
}

async function recordOutcome(integrationId: string, bankConnectionId: string, result: SyncResult, now: Date) {
  const accounts = await prisma.bankAccount.findMany({
    where: { bankConnectionId, supersededById: null },
    select: { consentExpiresAt: true },
  })
  const error = result.errors.length > 0 ? result.errors.join(' | ').slice(0, 1000) : null
  await prisma.$transaction([
    prisma.integration.update({ where: { id: integrationId }, data: { lastSyncAt: now } }),
    prisma.bankConnection.update({
      where: { id: bankConnectionId },
      data: {
        lastSyncAttemptAt: now,
        lastSyncError: error,
        consentExpiresAt: earliestExpiry(accounts.map((a) => a.consentExpiresAt)),
        ...(result.success ? { lastSyncAt: now } : {}),
      },
    }),
  ])
}
