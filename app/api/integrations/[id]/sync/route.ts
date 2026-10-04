import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfIntegration } from '@/lib/api/resources'
import { limitBankCalls } from '@/lib/banking/guard'
import { SyncIntegrationSchema, syncCompanyIntegration } from '@/lib/integrations/sync-company-integrations.service'

/**
 * POST /api/integrations/[id]/sync - Synchronise une connexion bancaire.
 * Body (optional): { features?: IntegrationFeature[] }; unknown features are ignored.
 */
export const POST = companyRoute(
  { company: fromResource(companyOfIntegration), permission: { banking: ['reconcile'] }, body: SyncIntegrationSchema },
  async ({ params, companyId, body }) => {
    await limitBankCalls(companyId)
    return NextResponse.json(await syncCompanyIntegration(companyId, params.id as string, body))
  },
)
