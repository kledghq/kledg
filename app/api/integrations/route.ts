import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { listIntegrations } from '@/lib/integrations/list-integrations.service'
import { CreateIntegrationSchema, createIntegration } from '@/lib/integrations/create-integration.service'
import { guardBankConnect } from '@/lib/banking/guard'
import { setUpStripeBooks, stripeBalanceAccountOf } from '@/lib/banking/stripe-setup.service'

/**
 * GET /api/integrations?companyId= - Liste les intégrations d'une société.
 * The stored credentials are never returned.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] } },
  async ({ companyId }) => NextResponse.json({ integrations: await listIntegrations(companyId) }),
)

/**
 * POST /api/integrations - Crée une connexion Qonto, Ponto ou Stripe (avec ses règles et son compte, lib/banking/stripe-setup.service.ts).
 * Body: { companyId, provider, type: 'BANKING', name?, credentials, features? }.
 * The credentials are checked first by POST /api/integrations/verify.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['manage'] }, body: CreateIntegrationSchema },
  async ({ request, companyId, user, body }) => {
    // Instance policy, same origin, bank API rate limit (as every bank connection).
    await guardBankConnect(request, companyId, user)
    const integration = await createIntegration(companyId, body)
    if (body.provider !== 'STRIPE') return NextResponse.json({ integration })
    // Stripe: its ledger account and its rules, before the first sync maps the account
    const stripe = await setUpStripeBooks(companyId, stripeBalanceAccountOf(body.config))
    return NextResponse.json({ integration, stripe })
  },
)
