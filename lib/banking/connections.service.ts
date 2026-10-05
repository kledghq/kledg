/**
 * Bank connections of a company: refresh, disconnect, credentials update,
 * manual accounts, the synchronization of each account and the mapping of
 * each bank account to its 512 ledger account.
 *
 * A company holds at most one connection per provider (QONTO, REVOLUT,
 * PONTO, MANUAL). MANUAL has no credentials and is never synced: its lines
 * come from statement files.
 */

import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, RateLimitError, ValidationError } from '@/lib/accounting/errors'
import type { Prisma } from '@prisma/client'
import { openCredentials, sealCredentials } from '@/lib/banking/credentials'
import { createBankProvider, isBankProvider } from '@/lib/banking/providers'
import { PONTO_REFRESH_INTERVAL_MS, refreshRetryAfter } from '@/lib/banking/sync-rules'
import { compactIban, isValidIban } from '@/lib/banking/iban'
import { MANUAL_ACCOUNT_ID_PREFIX } from '@/lib/banking/import/importer'
import { BankAuthorizationError, errorReason, QONTO_CREDENTIALS_REFUSED } from '@/lib/banking/errors'
import { syncIntegration } from '@/lib/integrations/sync'
import { IntegrationFeature, type SyncResult } from '@/lib/integrations/types'

/** Company of a bank connection (resolver of the by-id routes). */
export function companyOfBankConnection(id: string): Promise<{ companyId: string } | null> {
  return prisma.bankConnection.findUnique({ where: { id }, select: { companyId: true } })
}

/** A 512 ledger account code (Banques, PCG art. 512): 512, 5121, 512100... */
export const LEDGER_BANK_CODE = /^512\d{0,5}$/

async function assertLedgerAccount(companyId: string, code: string): Promise<void> {
  if (!LEDGER_BANK_CODE.test(code)) {
    throw new ValidationError('Choisissez un compte de banque de la classe 512 (ex. 512000, 512100).')
  }
  const exists = await prisma.account.count({ where: { companyId, code } })
  if (exists === 0) throw new ValidationError(`Le compte ${code} n'existe pas dans le plan comptable de la société.`)
}

export interface RefreshOutcome extends SyncResult {
  /** Ponto: a fresh bank synchronization was requested before reading. */
  bankRefreshRequested: boolean
}

/**
 * "Actualiser": syncs one connection now. For Ponto, first asks Ponto to
 * synchronize each account with the bank, which its terms allow only while
 * the user is present, with the user's IP, and at most every 5 minutes.
 * The throttle is claimed atomically so two clicks cannot both pass.
 *
 * `requestBankRefresh: false` only reads what the provider holds, like the
 * scheduled sync: an assistant acting through MCP is not the user present
 * on the page, so it never asks Ponto for a bank synchronization.
 */
export async function refreshConnection(input: {
  connectionId: string
  companyId: string
  customerIp: string
  encryptionKey: string
  now?: Date
  /** Ponto: ask the bank for fresh data first (user present only). Defaults to true. */
  requestBankRefresh?: boolean
}): Promise<RefreshOutcome> {
  const now = input.now ?? new Date()
  const connection = await prisma.bankConnection.findFirst({
    where: { id: input.connectionId, companyId: input.companyId },
    select: {
      id: true,
      provider: true,
      lastManualSyncAt: true,
      integration: { select: { id: true, provider: true, status: true, credentials: true, credentialsEncrypted: true } },
      bankAccounts: { where: { supersededById: { not: null } }, select: { externalAccountId: true } },
    },
  })
  if (!connection) throw new NotFoundError('Connexion bancaire introuvable')
  const integration = connection.integration
  if (!integration || connection.provider === 'MANUAL' || !isBankProvider(integration.provider)) {
    throw new ValidationError("Ce compte n'est relié à aucune banque : importez un relevé pour le mettre à jour.")
  }
  if (integration.status !== 'active') {
    throw new ValidationError("La connexion n'est pas active : terminez ou renouvelez l'autorisation.")
  }

  let bankRefreshRequested = false
  if (integration.provider === 'PONTO' && input.requestBankRefresh !== false) {
    const claimed = await prisma.bankConnection.updateMany({
      where: {
        id: connection.id,
        OR: [{ lastManualSyncAt: null }, { lastManualSyncAt: { lte: new Date(now.getTime() - PONTO_REFRESH_INTERVAL_MS) } }],
      },
      data: { lastManualSyncAt: now },
    })
    if (claimed.count === 0) {
      const wait = Math.max(1, Math.ceil(refreshRetryAfter(connection.lastManualSyncAt, now) / 60))
      throw new RateLimitError(
        `Ponto accepte une actualisation toutes les 5 minutes. Réessayez dans ${wait} minute${wait > 1 ? 's' : ''}.`,
      )
    }
    if (!input.customerIp || input.customerIp === 'unknown') {
      throw new ValidationError("Adresse IP de l'utilisateur introuvable : Ponto l'exige pour une actualisation.")
    }
    const provider = createBankProvider(
      'PONTO',
      openCredentials('PONTO', integration.credentials, integration.credentialsEncrypted, input.encryptionKey),
    )
    // Every Ponto account except those a direct connection already covers
    const superseded = new Set(connection.bankAccounts.map((a) => a.externalAccountId))
    const accounts = (await provider.listAccounts()).filter((a) => !superseded.has(a.externalId))
    for (const account of accounts) {
      try {
        await provider.requestRefresh?.(account.externalId, input.customerIp)
        bankRefreshRequested = true
      } catch (error) {
        // A bank that refuses (synchronized moments ago by Ponto itself) does not stop the read below
        await prisma.bankAccount.updateMany({
          where: { bankConnectionId: connection.id, externalAccountId: account.externalId },
          data: { lastSyncError: errorReason(error) },
        })
      }
    }
  }

  const result = await syncIntegration(
    integration.id,
    input.encryptionKey,
    [IntegrationFeature.BANKING_ACCOUNTS, IntegrationFeature.BANKING_TRANSACTIONS],
    { now },
  )
  return { ...result, bankRefreshRequested }
}

/**
 * Disconnects a provider: its credentials (integration) are deleted, the
 * accounts and their transactions stay, marked as no longer synced.
 */
export async function disconnectConnection(connectionId: string, companyId: string): Promise<void> {
  const connection = await prisma.bankConnection.findFirst({
    where: { id: connectionId, companyId },
    select: { id: true, provider: true, integrationId: true },
  })
  if (!connection) throw new NotFoundError('Connexion bancaire introuvable')
  if (connection.provider === 'MANUAL') throw new ValidationError('Les comptes manuels ne sont reliés à aucune banque.')
  await prisma.$transaction(async (tx) => {
    await tx.bankConnection.update({ where: { id: connection.id }, data: { status: 'inactive', integrationId: null } })
    await tx.bankAccount.updateMany({ where: { bankConnectionId: connection.id }, data: { shouldSync: false } })
    if (connection.integrationId) await tx.integration.deleteMany({ where: { id: connection.integrationId, companyId } })
  })
}

export interface ManualAccountInput {
  name: string
  iban?: string | null
  currency?: string
  ledgerAccountCode: string
}

/** Adds a bank account without API (fed by statement files). */
export async function createManualAccount(companyId: string, input: ManualAccountInput) {
  const iban = input.iban ? compactIban(input.iban) : null
  if (iban && !isValidIban(iban)) throw new ValidationError("L'IBAN saisi n'est pas valide : vérifiez-le sur votre relevé.")
  await assertLedgerAccount(companyId, input.ledgerAccountCode)
  if (iban) {
    const duplicate = await prisma.bankAccount.count({ where: { iban, bankConnection: { companyId } } })
    if (duplicate > 0) throw new ConflictError('Un compte bancaire avec cet IBAN existe déjà pour cette société.')
  }
  return prisma.$transaction(async (tx) => {
    const connection = await tx.bankConnection.upsert({
      where: { companyId_provider: { companyId, provider: 'MANUAL' } },
      update: { status: 'active' },
      create: { companyId, provider: 'MANUAL', status: 'active' },
      select: { id: true },
    })
    return tx.bankAccount.create({
      data: {
        bankConnectionId: connection.id,
        externalAccountId: `${MANUAL_ACCOUNT_ID_PREFIX}${randomUUID()}`,
        name: input.name,
        iban,
        currency: input.currency ?? 'EUR',
        ledgerAccountCode: input.ledgerAccountCode,
        shouldSync: false,
      },
      select: { id: true, name: true, iban: true, currency: true, ledgerAccountCode: true, bankConnectionId: true },
    })
  })
}

/** Display name and ledger account of a bank account (only the given fields change). */
export async function updateBankAccount(
  id: string,
  companyId: string,
  input: { displayName?: string | null; ledgerAccountCode?: string | null },
) {
  const account = await prisma.bankAccount.findFirst({ where: { id, bankConnection: { companyId } }, select: { id: true } })
  if (!account) throw new NotFoundError('Compte bancaire non trouvé')
  if (input.ledgerAccountCode) await assertLedgerAccount(companyId, input.ledgerAccountCode)
  return prisma.bankAccount.update({
    where: { id },
    data: {
      ...(input.displayName !== undefined ? { displayName: input.displayName || null } : {}),
      ...(input.ledgerAccountCode !== undefined ? { ledgerAccountCode: input.ledgerAccountCode || null } : {}),
    },
  })
}

const SYNC_TOGGLE_MESSAGES = {
  manual: "Ce compte est alimenté par des relevés importés : il n'a pas de synchronisation à activer.",
  superseded: 'Une connexion directe synchronise déjà ce compte (même IBAN) : il reste en lecture seule ici.',
  disconnected: 'La banque de ce compte est déconnectée : reconnectez-la pour reprendre la synchronisation.',
} as const

/**
 * Turns the synchronization of one bank account on or off. Both flags are
 * written: IntegrationResource.shouldSync (read by the sync) and
 * BankAccount.shouldSync (shown on the Banque page). A manual account has
 * nothing to sync; an account a direct connection supersedes, or whose bank
 * is disconnected, cannot be turned back on.
 */
export async function setBankAccountSync(companyId: string, bankAccountId: string, enabled: boolean) {
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, bankConnection: { companyId } },
    select: {
      id: true,
      supersededById: true,
      integrationResourceId: true,
      bankConnection: { select: { provider: true, status: true, integrationId: true } },
    },
  })
  if (!account) throw new NotFoundError('Compte bancaire non trouvé')
  if (account.bankConnection.provider === 'MANUAL') throw new ValidationError(SYNC_TOGGLE_MESSAGES.manual)
  if (enabled && account.supersededById) throw new ConflictError(SYNC_TOGGLE_MESSAGES.superseded)
  if (enabled && (account.bankConnection.status === 'inactive' || !account.bankConnection.integrationId || !account.integrationResourceId)) {
    throw new ConflictError(SYNC_TOGGLE_MESSAGES.disconnected)
  }
  return prisma.$transaction(async (tx) => {
    if (account.integrationResourceId) {
      await tx.integrationResource.update({ where: { id: account.integrationResourceId }, data: { shouldSync: enabled } })
    }
    return tx.bankAccount.update({ where: { id: account.id }, data: { shouldSync: enabled } })
  })
}

/**
 * Accounts of one connection to synchronize: the listed ones on, the others
 * off (former selection screen). Superseded accounts stay off.
 */
export async function setConnectionSyncedAccounts(companyId: string, bankConnectionId: string, accountIds: string[]) {
  const connection = await prisma.bankConnection.findFirst({
    where: { id: bankConnectionId, companyId },
    select: { id: true, bankAccounts: { select: { id: true, supersededById: true, integrationResourceId: true } } },
  })
  if (!connection) throw new NotFoundError('Connexion bancaire introuvable')
  const wanted = new Set(accountIds)
  await prisma.$transaction(async (tx) => {
    for (const account of connection.bankAccounts) {
      const enabled = wanted.has(account.id) && !account.supersededById
      await tx.bankAccount.update({ where: { id: account.id }, data: { shouldSync: enabled } })
      if (account.integrationResourceId) {
        await tx.integrationResource.update({ where: { id: account.integrationResourceId }, data: { shouldSync: enabled } })
      }
    }
  })
  return prisma.bankAccount.findMany({
    where: { bankConnectionId: connection.id },
    select: { id: true, name: true, displayName: true, iban: true, currency: true, shouldSync: true, supersededById: true },
    orderBy: { name: 'asc' },
  })
}

/** Providers whose credentials are typed by the user and checked before saving (Revolut goes through OAuth). */
const UPDATABLE_PROVIDERS: readonly string[] = ['QONTO', 'PONTO']

/**
 * Replaces the credentials of a Qonto or Ponto connection (new API key,
 * renewed secret). The new credentials are checked against the provider
 * first; a secret left empty keeps the stored one. Secrets are sealed with
 * the instance key and the legacy Qonto columns of the connection are
 * cleared, so every Qonto call uses the new key. The connection becomes
 * active again; the caller runs a sync.
 */
export async function updateIntegrationCredentials(input: {
  companyId: string
  integrationId: string
  credentials: Record<string, unknown>
  encryptionKey: string
  /** Injected in tests. */
  verify?: (provider: string, credentials: Record<string, unknown>) => Promise<unknown>
}): Promise<{ id: string; provider: string }> {
  const integration = await prisma.integration.findFirst({
    where: { id: input.integrationId, companyId: input.companyId },
    select: { id: true, provider: true, credentials: true, credentialsEncrypted: true },
  })
  if (!integration) throw new NotFoundError('Connexion bancaire introuvable')
  const provider = integration.provider
  if (!UPDATABLE_PROVIDERS.includes(provider)) {
    throw new ValidationError("Les identifiants de cette connexion se renouvellent par une nouvelle autorisation dans l'espace de la banque.")
  }

  // Empty secrets keep the stored ones: the form never shows them again
  const stored = openCredentials(provider, integration.credentials, integration.credentialsEncrypted, input.encryptionKey)
  const merged: Record<string, unknown> = { ...stored }
  for (const [key, value] of Object.entries(input.credentials)) {
    if (typeof value === 'string' && value.trim() === '') continue
    merged[key] = typeof value === 'string' ? value.trim() : value
  }

  const verify = input.verify ?? ((p: string, c: Record<string, unknown>) => createBankProvider(p, c).listAccounts())
  try {
    await verify(provider, merged)
  } catch (error) {
    if (error instanceof BankAuthorizationError) {
      throw new ValidationError(
        provider === 'QONTO' ? QONTO_CREDENTIALS_REFUSED : "Ponto refuse ces identifiants : vérifiez l'identifiant et le secret de l'intégration.",
      )
    }
    throw error
  }

  const sealed = sealCredentials(provider, merged, input.encryptionKey)
  await prisma.$transaction(async (tx) => {
    await tx.integration.update({
      where: { id: integration.id },
      data: { credentials: sealed as Prisma.InputJsonValue, credentialsEncrypted: true, status: 'active' },
    })
    await tx.bankConnection.updateMany({
      where: { integrationId: integration.id },
      data: {
        status: 'active',
        lastSyncError: null,
        ...(provider === 'QONTO' ? { secretKeyEncrypted: '', login: typeof merged.login === 'string' ? merged.login : '' } : {}),
      },
    })
  })
  return { id: integration.id, provider }
}
