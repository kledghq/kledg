/**
 * Updates a Qonto or Ponto integration: new credentials (checked with the
 * bank first, lib/banking/connections.service.ts updateIntegrationCredentials)
 * and optionally the features it syncs. Credentials are write-only: the
 * result never contains them.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/audit'
import { requireEncryptionKey } from '@/lib/banking/credentials'
import { updateIntegrationCredentials } from '@/lib/banking/connections.service'
import { IntegrationFeatures, TypedCredentials } from '@/lib/integrations/create-integration.service'
import { INTEGRATION_SELECT, type IntegrationView } from '@/lib/integrations/list-integrations.service'

export const UpdateIntegrationSchema = z.object({
  /** An empty secret keeps the stored one. */
  credentials: TypedCredentials,
  features: IntegrationFeatures.optional(),
})
export type UpdateIntegrationInput = z.infer<typeof UpdateIntegrationSchema>

export async function updateIntegration(
  companyId: string,
  integrationId: string,
  input: UpdateIntegrationInput,
  options: { encryptionKey?: string; verify?: (provider: string, credentials: Record<string, unknown>) => Promise<unknown> } = {},
): Promise<IntegrationView> {
  // Scoped by company inside: a 404 for an integration of another company
  const updated = await updateIntegrationCredentials({
    companyId,
    integrationId,
    credentials: input.credentials,
    encryptionKey: options.encryptionKey ?? requireEncryptionKey(),
    verify: options.verify,
  })

  const features = input.features ? [...new Set(input.features)] : undefined
  const integration = await prisma.$transaction(async (tx) => {
    if (features) {
      await tx.integrationFeatureConfig.deleteMany({ where: { integrationId: updated.id } })
      await tx.integrationFeatureConfig.createMany({
        data: features.map((feature) => ({ integrationId: updated.id, feature, enabled: true })),
      })
    }
    return tx.integration.findUniqueOrThrow({ where: { id: updated.id }, select: INTEGRATION_SELECT })
  })

  await writeAuditLog('info', 'Bank credentials updated', {
    action: 'BANK_CREDENTIALS_UPDATE',
    companyId,
    metadata: { integrationId: updated.id, provider: updated.provider },
  })
  return integration
}
