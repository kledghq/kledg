/**
 * Bank connections and bank accounts of a company, as the Banque pages list
 * them (GET /api/banking/connections, GET /api/banking/accounts).
 *
 * Invariant: these reads select their columns explicitly and never load the
 * connection credentials (login, secretKeyEncrypted, integration
 * credentials), so no secret can reach a response.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Every bank connection of the company (one per provider), with its state:
 * last synchronization, error, expiry of the bank consent, and its accounts.
 */
export async function listBankConnections(companyId: string) {
  return prisma.bankConnection.findMany({
    where: { companyId },
    select: {
      id: true,
      companyId: true,
      provider: true,
      selectedAccountId: true,
      lastSyncAt: true,
      lastSyncAttemptAt: true,
      lastSyncError: true,
      lastManualSyncAt: true,
      consentExpiresAt: true,
      status: true,
      providerData: true,
      createdAt: true,
      updatedAt: true,
      integration: { select: { id: true, provider: true, status: true, name: true } },
      bankAccounts: {
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          displayName: true,
          iban: true,
          balance: true,
          currency: true,
          shouldSync: true,
          ledgerAccountCode: true,
          consentExpiresAt: true,
          lastSyncedAt: true,
          lastSyncError: true,
          supersededById: true,
          providerData: true,
          externalAccountId: true,
        },
      },
      selectedAccount: { select: { id: true, iban: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

/** Bank name and logo stored by the Ponto sync; logos only from https URLs. */
function institutionOf(providerData: Prisma.JsonValue): { name: string | null; logoUrl: string | null } | null {
  const data = (providerData ?? {}) as Record<string, unknown>
  const name = typeof data.institutionName === 'string' ? data.institutionName : null
  const logo =
    typeof data.institutionLogoUrl === 'string' && data.institutionLogoUrl.startsWith('https://') ? data.institutionLogoUrl : null
  return name || logo ? { name, logoUrl: logo } : null
}

/**
 * Every bank account of the company, all connections together (Qonto,
 * Revolut, Ponto, manual accounts), flattened with its connection.
 */
export async function listBankAccounts(companyId: string) {
  const connections = await prisma.bankConnection.findMany({
    where: { companyId },
    select: {
      id: true,
      provider: true,
      status: true,
      bankAccounts: {
        select: {
          id: true,
          name: true,
          displayName: true,
          iban: true,
          balance: true,
          currency: true,
          shouldSync: true,
          ledgerAccountCode: true,
          consentExpiresAt: true,
          lastSyncedAt: true,
          lastSyncError: true,
          providerData: true,
          supersededBy: { select: { id: true, name: true, bankConnection: { select: { provider: true } } } },
          createdAt: true,
          updatedAt: true,
          integrationResource: {
            select: { id: true, integration: { select: { id: true, name: true, provider: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  return connections.flatMap((connection) =>
    connection.bankAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      displayName: account.displayName,
      iban: account.iban,
      balance: Number(account.balance),
      currency: account.currency,
      shouldSync: account.shouldSync,
      ledgerAccountCode: account.ledgerAccountCode,
      consentExpiresAt: account.consentExpiresAt?.toISOString() ?? null,
      lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
      lastSyncError: account.lastSyncError,
      supersededBy: account.supersededBy
        ? { id: account.supersededBy.id, name: account.supersededBy.name, provider: account.supersededBy.bankConnection.provider }
        : null,
      institution: institutionOf(account.providerData),
      bankConnection: { id: connection.id, provider: connection.provider, status: connection.status },
      integrationResource: account.integrationResource
        ? { id: account.integrationResource.id, integration: account.integrationResource.integration }
        : null,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    })),
  )
}
