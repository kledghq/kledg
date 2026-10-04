import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { limitBankCalls } from '@/lib/banking/guard'
import { SyncCompanyIntegrationsSchema, syncCompanyIntegrations } from '@/lib/integrations/sync-company-integrations.service'

/**
 * POST /api/integrations/sync - Synchronise toutes les connexions bancaires actives d'une société.
 * Body: { companyId, maxDays? }. Errors are French reasons, never a provider's message.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['reconcile'] }, body: SyncCompanyIntegrationsSchema },
  async ({ body, companyId }) => {
    await limitBankCalls(companyId)
    return NextResponse.json(await syncCompanyIntegrations(companyId, body))
  },
)
