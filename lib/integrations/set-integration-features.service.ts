/**
 * Turns the features of an integration (accounts, transactions) on or off.
 * Features not listed keep their state.
 */

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { findOwned } from '@/lib/api/resources'
import { IntegrationFeature } from '@/lib/integrations/types'

const UNKNOWN_FEATURE = 'Fonctionnalité inconnue : choisissez BANKING_ACCOUNTS ou BANKING_TRANSACTIONS.'

const INVALID_CONFIG = 'Configuration invalide : un objet plat de 20 clés au plus, aux valeurs simples (texte de 500 caractères au plus, nombre, booléen).'

/**
 * Options of a feature, stored as JSON: a flat object of at most 20 short
 * keys with primitive values. Bounded so that no caller can store arbitrary
 * documents in the database (Kledg reads none of these options today).
 */
const FeatureConfig = z
  .record(
    z.string().max(64, INVALID_CONFIG),
    z.union([z.string().max(500, INVALID_CONFIG), z.number(), z.boolean(), z.null()], { error: INVALID_CONFIG }),
    { error: INVALID_CONFIG },
  )
  .refine((config) => Object.keys(config).length <= 20, INVALID_CONFIG)

export const SetIntegrationFeaturesSchema = z.object({
  features: z
    .array(
      z.object({
        feature: z.enum(IntegrationFeature, { message: UNKNOWN_FEATURE }),
        /** On unless said otherwise. */
        enabled: z.boolean().optional().default(true),
        config: FeatureConfig.nullish(),
      }),
      { message: 'Indiquez les fonctionnalités à activer ou désactiver (features).' },
    )
    .max(10, '10 fonctionnalités au maximum par envoi.'),
})
export type SetIntegrationFeaturesInput = z.infer<typeof SetIntegrationFeaturesSchema>

const FEATURE_SELECT = {
  id: true,
  integrationId: true,
  feature: true,
  enabled: true,
  config: true,
  lastSyncAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.IntegrationFeatureConfigSelect

/** Applies the listed features and returns every feature of the integration. */
export async function setIntegrationFeatures(companyId: string, integrationId: string, input: SetIntegrationFeaturesInput) {
  await findOwned(
    prisma.integration.findFirst({ where: { id: integrationId, companyId }, select: { id: true } }),
    'Connexion bancaire introuvable',
  )
  // The last occurrence of a feature wins
  const byFeature = new Map(input.features.map((f) => [f.feature, f]))
  await prisma.$transaction(
    [...byFeature.values()].map(({ feature, enabled, config }) => {
      const values = { enabled, config: config ? (config as Prisma.InputJsonValue) : Prisma.DbNull }
      return prisma.integrationFeatureConfig.upsert({
        where: { integrationId_feature: { integrationId, feature } },
        update: values,
        create: { integrationId, feature, ...values },
      })
    }),
  )
  return prisma.integrationFeatureConfig.findMany({ where: { integrationId }, select: FEATURE_SELECT, orderBy: { createdAt: 'asc' } })
}
