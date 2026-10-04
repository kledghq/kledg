import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { qontoClientFor } from '@/lib/integrations/providers/qonto/get-credentials'
import { limitBankCalls } from '@/lib/banking/guard'

/**
 * Récupère les comptes bancaires depuis l'API Qonto
 * Documentation: https://docs.qonto.com/api-reference/business-api/accounts-organizations/organization
 *
 * Uses the stored (encrypted) credentials of the company only.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] } },
  async ({ companyId }) => {
    await limitBankCalls(companyId)
    const accounts = await (await qontoClientFor(companyId)).getAccounts()
    return NextResponse.json({ accounts })
  },
)
