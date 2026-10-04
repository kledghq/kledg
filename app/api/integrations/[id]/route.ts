import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfIntegration } from '@/lib/api/resources'
import { guardBankConnect } from '@/lib/banking/guard'
import { UpdateIntegrationSchema, updateIntegration } from '@/lib/integrations/update-integration.service'

/**
 * PUT /api/integrations/[id] - Met à jour les identifiants d'une connexion Qonto ou Ponto.
 * The new credentials are checked with the bank before being stored.
 * Credentials are write-only: the response never contains them.
 */
export const PUT = companyRoute(
  { company: fromResource(companyOfIntegration), permission: { banking: ['manage'] }, body: UpdateIntegrationSchema },
  async ({ request, params, companyId, user, body }) => {
    await guardBankConnect(request, companyId, user)
    return NextResponse.json({ integration: await updateIntegration(companyId, params.id as string, body) })
  },
)
