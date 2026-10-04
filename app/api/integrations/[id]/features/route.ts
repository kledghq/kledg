import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfIntegration } from '@/lib/api/resources'
import { SetIntegrationFeaturesSchema, setIntegrationFeatures } from '@/lib/integrations/set-integration-features.service'

/**
 * POST /api/integrations/[id]/features - Active ou désactive des fonctionnalités d'une connexion.
 * Body: { features: [{ feature, enabled?, config? }] }.
 */
export const POST = companyRoute(
  { company: fromResource(companyOfIntegration), permission: { banking: ['manage'] }, body: SetIntegrationFeaturesSchema },
  async ({ params, companyId, body }) =>
    NextResponse.json({ features: await setIntegrationFeatures(companyId, params.id as string, body) }),
)
