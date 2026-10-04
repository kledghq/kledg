import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { limitBankCalls } from '@/lib/banking/guard'
import { testQontoConnection } from '@/lib/integrations/providers/qonto/manage-qonto-connection.service'

/**
 * Teste la connexion Qonto existante avec les identifiants enregistrés.
 * Answers `{ valid: true, organization }`, or 400 `{ valid: false, error }`
 * with a French reason, never Qonto's message.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['manage'] } },
  async ({ companyId }) => {
    await limitBankCalls(companyId)
    const check = await testQontoConnection(companyId)
    return NextResponse.json(check, { status: check.valid ? 200 : 400 })
  },
)
