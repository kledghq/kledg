import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { guardBankConnect } from '@/lib/banking/guard'
import { verifyQontoCredentials, VerifyQontoSchema } from '@/lib/integrations/providers/qonto/manage-qonto-connection.service'

/**
 * Vérifie des identifiants Qonto sans les enregistrer (GET /v2/organization).
 * Body: { companyId, login, secretKey }. Answers `{ valid: true, organization }`,
 * or 400 `{ valid: false, error }` with a French reason, never Qonto's message.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['manage'] }, body: VerifyQontoSchema },
  async ({ request, body, companyId, user }) => {
    await guardBankConnect(request, companyId, user)
    const check = await verifyQontoCredentials(body)
    return NextResponse.json(check, { status: check.valid ? 200 : 400 })
  },
)
