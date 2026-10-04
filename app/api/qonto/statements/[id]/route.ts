import { NextResponse } from 'next/server'
import { ValidationError } from '@/lib/accounting/errors'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { qontoClientFor } from '@/lib/integrations/providers/qonto/get-credentials'

/** Qonto ids are UUIDs: never let a path segment reach the Qonto API path. */
const QONTO_ID = /^[A-Za-z0-9-]{1,100}$/

/**
 * Récupère un relevé bancaire spécifique depuis l'API Qonto par son ID
 * Documentation: https://docs.qonto.com/api-reference/business-api/transactions-statements/statements/retrieve-a-statement
 *
 * Uses the stored (encrypted) credentials of the company only, so only
 * statements of the company's own Qonto organization can be read.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] } },
  async ({ params, companyId }) => {
    const statementId = params.id as string
    if (!statementId || !QONTO_ID.test(statementId)) {
      throw new ValidationError('Identifiant de relevé invalide.')
    }
    const statement = await (await qontoClientFor(companyId)).getStatement(statementId)
    return NextResponse.json(statement)
  },
)
