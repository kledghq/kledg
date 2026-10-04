/**
 * Bank accounts (integration resources) of a connection to synchronize: the
 * listed ones on, the others off. Only resources of this integration are
 * touched and unknown ids are ignored. Same rule as the Banque page
 * (setConnectionSyncedAccounts): both the resource and its bank account
 * change, superseded accounts stay off.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { findOwned } from '@/lib/api/resources'
import { setConnectionSyncedAccounts } from '@/lib/banking/connections.service'

export const SelectSyncedResourcesSchema = z.object({
  resourceIds: z
    .array(z.string().min(1), { message: 'Indiquez les comptes à synchroniser (resourceIds).' })
    .max(500, '500 comptes au maximum par envoi.'),
})
export type SelectSyncedResourcesInput = z.infer<typeof SelectSyncedResourcesSchema>

export async function selectSyncedResources(
  companyId: string,
  integrationId: string,
  input: SelectSyncedResourcesInput,
): Promise<{ success: true }> {
  const integration = await findOwned(
    prisma.integration.findFirst({
      where: { id: integrationId, companyId },
      select: { bankConnection: { select: { id: true } }, resources: { select: { id: true, bankAccount: { select: { id: true } } } } },
    }),
    'Connexion bancaire introuvable',
  )
  const wanted = new Set(input.resourceIds)
  const resources = integration.resources

  // Resources without a bank account yet (before the first account sync)
  const pending = resources.filter((r) => !r.bankAccount)
  await prisma.$transaction([
    prisma.integrationResource.updateMany({
      where: { id: { in: pending.filter((r) => !wanted.has(r.id)).map((r) => r.id) } },
      data: { shouldSync: false },
    }),
    prisma.integrationResource.updateMany({
      where: { id: { in: pending.filter((r) => wanted.has(r.id)).map((r) => r.id) } },
      data: { shouldSync: true },
    }),
  ])
  if (integration.bankConnection) {
    const accountIds = resources.flatMap((r) => (r.bankAccount && wanted.has(r.id) ? [r.bankAccount.id] : []))
    await setConnectionSyncedAccounts(companyId, integration.bankConnection.id, accountIds)
  }
  return { success: true }
}
