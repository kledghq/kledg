import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfIntegration } from '@/lib/api/resources'
import { SelectSyncedResourcesSchema, selectSyncedResources } from '@/lib/integrations/select-synced-resources.service'

/**
 * POST /api/integrations/[id]/resources - Comptes à synchroniser d'une connexion.
 * Body: { resourceIds }; the other accounts of the connection stop syncing.
 */
export const POST = companyRoute(
  { company: fromResource(companyOfIntegration), permission: { banking: ['manage'] }, body: SelectSyncedResourcesSchema },
  async ({ params, companyId, body }) => NextResponse.json(await selectSyncedResources(companyId, params.id as string, body)),
)
