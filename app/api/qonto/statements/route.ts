import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { limitBankCalls } from '@/lib/banking/guard'
import {
  listQontoStatements,
  StatementsBodySchema,
  StatementsQuerySchema,
} from '@/lib/integrations/providers/qonto/list-qonto-statements.service'

/**
 * Récupère les relevés bancaires depuis l'API Qonto, avec les identifiants
 * enregistrés de la société (lib/integrations/providers/qonto/list-qonto-statements.service.ts).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] }, query: StatementsQuerySchema },
  async ({ companyId, query }) => {
    await limitBankCalls(companyId)
    return NextResponse.json(await listQontoStatements(companyId, query))
  },
)

/** Same as GET, with the filters in the JSON body. */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['read'] }, body: StatementsBodySchema },
  async ({ companyId, body }) => {
    await limitBankCalls(companyId)
    return NextResponse.json(await listQontoStatements(companyId, body))
  },
)
