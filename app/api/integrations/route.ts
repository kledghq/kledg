import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { listIntegrations } from '@/lib/integrations/list-integrations.service'
import { CreateIntegrationSchema, createIntegration } from '@/lib/integrations/create-integration.service'
import { guardBankConnect } from '@/lib/banking/guard'

/**
 * GET /api/integrations?companyId= - Liste les intégrations d'une société.
 * The stored credentials are never returned.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] } },
  async ({ companyId }) => NextResponse.json({ integrations: await listIntegrations(companyId) }),
)

/**
 * POST /api/integrations - Crée une connexion Qonto ou Ponto.
 * Body: { companyId, provider, type: 'BANKING', name?, credentials, features? }.
 * The credentials are checked first by POST /api/integrations/verify.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['manage'] }, body: CreateIntegrationSchema },
  async ({ request, companyId, user, body }) => {
    // Instance policy, same origin, bank API rate limit (as every bank connection).
    await guardBankConnect(request, companyId, user)
    return NextResponse.json({ integration: await createIntegration(companyId, body) })
  },
)
