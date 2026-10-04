import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { guardBankConnect } from '@/lib/banking/guard'
import { VerifyBankCredentialsSchema, verifyBankCredentials } from '@/lib/integrations/verify-bank-credentials.service'

/**
 * POST /api/integrations/verify - Vérifie les identifiants d'un fournisseur sans les enregistrer.
 * Body: { companyId, provider, credentials }. Credentials come from the JSON
 * body only (never the query string). Refused credentials answer 400 with
 * `{ valid: false, error }`, a French reason.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['manage'] }, body: VerifyBankCredentialsSchema },
  async ({ request, body, companyId, user }) => {
    await guardBankConnect(request, companyId, user)
    const result = await verifyBankCredentials(body)
    return NextResponse.json(result, { status: result.valid ? 200 : 400 })
  },
)
