import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { guardBankConnect } from '@/lib/banking/guard'
import { connectQonto, ConnectQontoSchema } from '@/lib/integrations/providers/qonto/manage-qonto-connection.service'

/**
 * POST /api/qonto/connect
 * Body: { companyId, login, secretKey, selectedAccountId? }. The credentials
 * are tested, then stored encrypted; they are never returned.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['manage'] }, body: ConnectQontoSchema },
  async ({ request, companyId, user, body }) => {
    // Instance policy, same origin, bank API rate limit (as every bank connection).
    await guardBankConnect(request, companyId, user)
    return NextResponse.json(await connectQonto(companyId, body))
  },
)
