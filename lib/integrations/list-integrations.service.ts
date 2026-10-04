/**
 * Integrations of a company as the API returns them. The stored credentials
 * and the provider metadata (pending OAuth state) never leave the server:
 * every read of an integration goes through INTEGRATION_SELECT.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** Columns of an integration safe to return (no credentials, no metadata, no config). */
export const INTEGRATION_SELECT = {
  id: true,
  companyId: true,
  provider: true,
  type: true,
  name: true,
  status: true,
  lastSyncAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.IntegrationSelect

export type IntegrationView = Prisma.IntegrationGetPayload<{ select: typeof INTEGRATION_SELECT }>

/** Integrations of the company, newest first, with their enabled features and all their resources. */
export async function listIntegrations(companyId: string) {
  return prisma.integration.findMany({
    where: { companyId },
    select: {
      ...INTEGRATION_SELECT,
      featureConfigs: {
        where: { enabled: true },
        select: { id: true, integrationId: true, feature: true, enabled: true, config: true, lastSyncAt: true, createdAt: true, updatedAt: true },
      },
      // Every resource, not only the synced ones: the user picks which to sync
      resources: {
        select: {
          id: true,
          integrationId: true,
          resourceType: true,
          externalId: true,
          name: true,
          data: true,
          shouldSync: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
}
