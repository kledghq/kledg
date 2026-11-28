/**
 * Creates a bank integration from credentials typed by the user (Qonto API
 * key, Ponto client). Invariant: one integration per company and provider,
 * checked under an advisory lock so two submissions cannot both create one;
 * secrets are always stored encrypted with the instance key.
 */

import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError } from '@/lib/accounting/errors'
import { optionalText } from '@/lib/api/zod-fields'
import { requireEncryptionKey, sealCredentials, SECRET_FIELDS } from '@/lib/banking/credentials'
import { BANK_PROVIDER_LABELS } from '@/lib/banking/links'
import { IntegrationFeature } from '@/lib/integrations/types'
import { INTEGRATION_SELECT, type IntegrationView } from '@/lib/integrations/list-integrations.service'

/** Providers whose credentials are typed in Kledg (Revolut goes through OAuth). */
export const TypedCredentialsProvider = z.enum(['QONTO', 'PONTO', 'STRIPE'], {
  message: 'Fournisseur non pris en charge : choisissez Qonto, Ponto ou Stripe.',
})

/**
 * Settings of a Stripe connection, kept on Integration.config: the account
 * of the Stripe balance (517 "Autres organismes financiers" by default, or
 * 467 "Divers comptes débiteurs", lib/banking/stripe-setup.service.ts) and
 * the granularity of its lines (per payment by default, or per automatic
 * payout, lib/banking/providers/stripe/map.ts). Both are set once: changing
 * the granularity of a connection with lines would book them twice.
 */
export const StripeConnectionConfig = z.object({
  balanceAccount: z.enum(['517', '467'], { message: 'Choisissez le compte du solde Stripe : 517 ou 467.' }).default('517'),
  granularity: z
    .enum(['payment', 'payout'], { message: 'Choisissez le détail des opérations Stripe : par paiement ou par virement.' })
    .default('payment'),
})
export type StripeConnectionConfig = z.infer<typeof StripeConnectionConfig>

/** Credentials typed by the user (Qonto: login, secretKey; Ponto: clientId, clientSecret). */
export const TypedCredentials = z.record(z.string(), z.string().max(500, '500 caractères au maximum'), {
  message: 'Saisissez les identifiants de la connexion.',
})

export const IntegrationFeatures = z
  .array(z.enum(IntegrationFeature, { message: 'Fonctionnalité inconnue : choisissez BANKING_ACCOUNTS ou BANKING_TRANSACTIONS.' }))
  .max(10)

export const CreateIntegrationSchema = z.object({
  provider: TypedCredentialsProvider,
  type: z.literal('BANKING', { message: 'Seules les connexions bancaires (BANKING) sont prises en charge.' }),
  name: optionalText(100),
  credentials: TypedCredentials,
  features: IntegrationFeatures.optional(),
  /** Stripe only: settings of the connection. */
  config: StripeConnectionConfig.optional(),
})
export type CreateIntegrationInput = z.infer<typeof CreateIntegrationSchema>

export async function createIntegration(
  companyId: string,
  input: CreateIntegrationInput,
  encryptionKey: string = requireEncryptionKey(),
): Promise<IntegrationView> {
  const { provider } = input
  const storedCredentials = sealCredentials(provider, input.credentials, encryptionKey, companyId)
  const hasSecret = SECRET_FIELDS[provider].some((field) => typeof storedCredentials[field] === 'string')
  const features = [...new Set(input.features ?? [])]

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:integration:${companyId}:${provider}`}))`
    // One connection per provider and company: edit the existing one instead
    const existing = await tx.integration.count({ where: { companyId, provider, type: 'BANKING' } })
    if (existing > 0) {
      throw new ConflictError(
        `${BANK_PROVIDER_LABELS[provider] ?? provider} est déjà connecté pour cette société : modifiez la connexion existante.`,
      )
    }
    return tx.integration.create({
      data: {
        companyId,
        provider,
        type: 'BANKING',
        name: input.name ?? BANK_PROVIDER_LABELS[provider] ?? provider,
        credentials: storedCredentials as Prisma.InputJsonValue,
        credentialsEncrypted: hasSecret,
        status: 'active',
        ...(provider === 'STRIPE' ? { config: StripeConnectionConfig.parse(input.config ?? {}) } : {}),
        featureConfigs: { create: features.map((feature) => ({ feature, enabled: true })) },
      },
      select: INTEGRATION_SELECT,
    })
  })
}
