/**
 * Ponto connection ("Autre banque"): the company holds its own Ponto
 * account, links its banks there and creates a custom integration whose
 * client id and secret it pastes in Kledg.
 * https://documentation.myponto.com/custom-integrations
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sealCredentials } from '@/lib/banking/credentials'
import { fetchPontoInstitutions } from '@/lib/banking/providers/ponto/client'
import { mapPontoInstitution, PontoProvider } from '@/lib/banking/providers/ponto/provider'
import type { ProviderInstitution } from '@/lib/banking/providers/types'
import { IntegrationFeature } from '@/lib/integrations/types'
import { syncIntegration } from '@/lib/integrations/sync'

/**
 * Validates the credentials (listing the accounts), stores them encrypted
 * and runs the first sync. One Ponto integration per company: connecting
 * again replaces its credentials.
 */
export async function connectPonto(
  companyId: string,
  credentials: { clientId: string; clientSecret: string },
  encryptionKey: string,
  options: { fetch?: typeof fetch } = {},
): Promise<{ integrationId: string; accountsCount: number; syncErrors: string[] }> {
  const provider = new PontoProvider({ ...credentials, fetch: options.fetch })
  const accounts = await provider.listAccounts()

  const stored = sealCredentials('PONTO', credentials, encryptionKey, companyId) as Prisma.InputJsonValue
  const existing = await prisma.integration.findFirst({
    where: { companyId, provider: 'PONTO', type: 'BANKING' },
    select: { id: true },
  })
  const integration = existing
    ? await prisma.integration.update({
        where: { id: existing.id },
        data: { credentials: stored, credentialsEncrypted: true, status: 'active' },
        select: { id: true },
      })
    : await prisma.integration.create({
        data: {
          companyId,
          provider: 'PONTO',
          type: 'BANKING',
          name: 'Ponto',
          status: 'active',
          credentials: stored,
          credentialsEncrypted: true,
          featureConfigs: {
            create: [
              { feature: IntegrationFeature.BANKING_ACCOUNTS, enabled: true },
              { feature: IntegrationFeature.BANKING_TRANSACTIONS, enabled: true },
            ],
          },
        },
        select: { id: true },
      })

  const sync = await syncIntegration(
    integration.id,
    encryptionKey,
    [IntegrationFeature.BANKING_ACCOUNTS, IntegrationFeature.BANKING_TRANSACTIONS],
    { provider },
  )
  return { integrationId: integration.id, accountsCount: accounts.length, syncErrors: sync.errors }
}

/** Banks with a direct connector in Kledg: shown first, not in the Ponto grid. */
const DIRECT_BANKS = /\b(qonto|revolut)\b/i

const INSTITUTIONS_TTL_MS = 24 * 60 * 60 * 1000
let institutionsCache: { country: string; at: number; list: ProviderInstitution[] } | null = null

/**
 * Banks reachable through Ponto in a country, for the bank picker. The
 * public list changes rarely: kept 24 hours in memory per server instance.
 */
export async function listPontoInstitutions(
  country = 'FR',
  options: { fetch?: typeof fetch; now?: number } = {},
): Promise<ProviderInstitution[]> {
  const now = options.now ?? Date.now()
  if (institutionsCache && institutionsCache.country === country && now - institutionsCache.at < INSTITUTIONS_TTL_MS) {
    return institutionsCache.list
  }
  const list = (await fetchPontoInstitutions(country, { fetch: options.fetch }))
    .filter((i) => !i.attributes.deprecated && !DIRECT_BANKS.test(i.attributes.name))
    .map(mapPontoInstitution)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  institutionsCache = { country, at: now, list }
  return list
}

/** Test helper: forget the cached institutions. */
export function clearInstitutionsCache(): void {
  institutionsCache = null
}
