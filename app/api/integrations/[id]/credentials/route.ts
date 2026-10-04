import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfIntegration } from '@/lib/api/resources'
import { readMaskedCredentials } from '@/lib/integrations/read-masked-credentials.service'

/**
 * GET /api/integrations/[id]/credentials
 * Masked credentials of an integration, for the edit form: the login and a
 * masked hint of the secret, never the secret itself.
 */
export const GET = companyRoute(
  { company: fromResource(companyOfIntegration), permission: { banking: ['manage'] } },
  async ({ params, companyId }) => NextResponse.json(await readMaskedCredentials(companyId, params.id as string)),
)
