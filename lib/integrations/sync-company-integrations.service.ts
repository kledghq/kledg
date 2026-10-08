/**
 * User triggered bank syncs of a company: one integration, or every active
 * bank integration. Failures come back as French reasons
 * (lib/banking/errors.ts), never as a provider's message; a failing bank
 * does not stop the others.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { findOwned } from '@/lib/api/resources'
import { requireEncryptionKey } from '@/lib/banking/credentials'
import { errorReason } from '@/lib/banking/errors'
import { BANK_PROVIDER_LABELS } from '@/lib/banking/links'
import { syncIntegration, type SyncOptions } from '@/lib/integrations/sync'
import { IntegrationFeature, type SyncResult } from '@/lib/integrations/types'

const FEATURES = Object.values(IntegrationFeature) as string[]

/** Body of a one integration sync, optional: `{ features? }`, unknown features are ignored. */
export const SyncIntegrationSchema = z
  .object({
    features: z
      .array(z.unknown())
      .max(10)
      .transform((values) => values.filter((f): f is IntegrationFeature => typeof f === 'string' && FEATURES.includes(f)))
      .optional(),
  })
  .optional()
export type SyncIntegrationInput = z.infer<typeof SyncIntegrationSchema>

/** Syncs one integration of the company (its enabled features, or the requested ones). */
export async function syncCompanyIntegration(
  companyId: string,
  integrationId: string,
  input: SyncIntegrationInput,
  options: SyncOptions & { encryptionKey?: string } = {},
): Promise<SyncResult> {
  await findOwned(
    prisma.integration.findFirst({ where: { id: integrationId, companyId }, select: { id: true } }),
    'Connexion bancaire introuvable',
  )
  const { encryptionKey, ...syncOptions } = options
  return syncIntegration(integrationId, encryptionKey ?? requireEncryptionKey(), input?.features, syncOptions)
}

export const SyncCompanyIntegrationsSchema = z.object({
  /** Days of history to read (1 to 365); the sync's default otherwise. */
  maxDays: z.coerce
    .number({ message: "Indiquez un nombre de jours d'historique." })
    .int()
    .min(1, "1 jour d'historique au minimum.")
    .max(365, "365 jours d'historique au maximum.")
    .nullish(),
})
export type SyncCompanyIntegrationsInput = z.infer<typeof SyncCompanyIntegrationsSchema>

export interface CompanySyncOutcome {
  success: boolean
  integrationsSynced: number
  totalItemsSynced: number
  /** One French reason per failing bank, prefixed with its name. */
  errors: string[]
  /** Set when the company has no active bank integration. */
  message?: string
}

/** Syncs the accounts and transactions of every active bank integration, oldest first. */
export async function syncCompanyIntegrations(
  companyId: string,
  input: SyncCompanyIntegrationsInput,
  options: SyncOptions & { encryptionKey?: string } = {},
): Promise<CompanySyncOutcome> {
  const { encryptionKey = requireEncryptionKey(), ...syncOptions } = options
  const integrations = await prisma.integration.findMany({
    where: { companyId, status: 'active', type: 'BANKING' },
    select: { id: true, provider: true },
    orderBy: { createdAt: 'asc' },
  })

  const outcome: CompanySyncOutcome = { success: true, integrationsSynced: 0, totalItemsSynced: 0, errors: [] }
  for (const integration of integrations) {
    const label = BANK_PROVIDER_LABELS[integration.provider] ?? integration.provider
    try {
      // One bank at a time: providers rate limit per client
      const result = await syncIntegration(
        integration.id,
        encryptionKey,
        [IntegrationFeature.BANKING_ACCOUNTS, IntegrationFeature.BANKING_TRANSACTIONS],
        input.maxDays ? { ...syncOptions, maxDays: input.maxDays } : syncOptions,
      )
      if (result.success) {
        outcome.integrationsSynced++
        outcome.totalItemsSynced += result.itemsSynced
      } else {
        outcome.errors.push(`${label} : ${result.errors.join(', ')}`)
      }
    } catch (error) {
      // Keep going: the other banks still sync; the reason is French, the detail is logged
      outcome.errors.push(`${label} : ${errorReason(error)}`)
    }
  }
  outcome.success = outcome.errors.length === 0
  return integrations.length === 0 ? { ...outcome, message: 'Aucune connexion bancaire active.' } : outcome
}
