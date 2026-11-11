import { NextResponse } from 'next/server'
import { ValidationError } from '@/lib/accounting/errors'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { getCompanyQontoStatement } from '@/lib/integrations/providers/qonto/list-qonto-statements.service'
import { limitBankCalls } from '@/lib/banking/guard'

/** Qonto ids are UUIDs: never let a path segment reach the Qonto API path. */
const QONTO_ID = /^[A-Za-z0-9-]{1,100}$/

/**
 * Récupère un relevé bancaire spécifique depuis l'API Qonto par son ID
 * Documentation: https://docs.qonto.com/api-reference/business-api/transactions-statements/statements/retrieve-a-statement
 *
 * Uses the stored (encrypted) credentials of the company only, so only
 * statements of the company's own Qonto organization can be read, and of
 * the accounts it syncs only (404 otherwise).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] } },
  async ({ params, companyId }) => {
    const statementId = params.id as string
    if (!statementId || !QONTO_ID.test(statementId)) {
      throw new ValidationError('Identifiant de relevé invalide.')
    }
    // Every bank API call counts in the company's limit: a loop here would use up its Qonto quota
    await limitBankCalls(companyId)
    const statement = await getCompanyQontoStatement(companyId, statementId)
    return NextResponse.json(statement)
  },
)
