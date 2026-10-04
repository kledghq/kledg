/**
 * Company resolvers of the transaction routes (lib/api/route.ts
 * CompanyResolver): the client sends only the transaction ids.
 */

import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { fromBody, type CompanyResolver } from './route'
import { companyOfTransaction } from './resources'

const TRANSACTION_NOT_FOUND = 'Transaction introuvable'

/**
 * `companyId` of the JSON body when the client sends it, else the company of
 * the first transaction (ids of other companies are then reported per item
 * as not found by the bulk services).
 */
export const fromTransactionIds: CompanyResolver = async (input) => {
  const body = (await input.json()) as { companyId?: unknown; transactionIds?: unknown } | null
  if (typeof body?.companyId === 'string' && body.companyId) return fromBody()(input)
  const ids = body?.transactionIds
  if (!Array.isArray(ids) || ids.length === 0) throw new ValidationError('Sélectionnez au moins une transaction.')
  const row = typeof ids[0] === 'string' ? await companyOfTransaction(ids[0]) : null
  if (!row?.companyId) throw new NotFoundError(TRANSACTION_NOT_FOUND)
  return row.companyId
}

async function companyOfTransactionRef(transactionId: unknown): Promise<string> {
  if (typeof transactionId !== 'string' || !transactionId) {
    throw new ValidationError('Précisez la transaction (transactionId).')
  }
  const row = await companyOfTransaction(transactionId)
  if (!row?.companyId) throw new NotFoundError(TRANSACTION_NOT_FOUND)
  return row.companyId
}

/** Company of the transaction named in the JSON body (`transactionId`). */
export const fromTransactionInBody: CompanyResolver = async ({ json }) =>
  companyOfTransactionRef(((await json()) as { transactionId?: unknown } | null)?.transactionId)

/** Company of the transaction named in the query string (`?transactionId=`). */
export const fromTransactionInQuery: CompanyResolver = async ({ request }) =>
  companyOfTransactionRef(request.nextUrl.searchParams.get('transactionId'))
