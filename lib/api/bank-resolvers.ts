/**
 * Company resolvers of the bank routes whose company is not in the request
 * as such (lib/api/route.ts CompanyResolver): the Revolut OAuth callback and
 * the Qonto receipts.
 */

import { NotFoundError } from '@/lib/accounting/errors'
import { companyOfRevolutState, REVOLUT_STATE_COOKIE } from '@/lib/banking/revolut-connection.service'
import { companyOfQontoAttachment } from '@/lib/integrations/providers/qonto/read-qonto-attachments.service'
import { fromQuery, type CompanyResolver } from './route'

/** Company of the Revolut consent being completed: from the state cookie (or the echoed state). */
export const fromRevolutState: CompanyResolver = async ({ request }) => {
  const state = request.cookies.get(REVOLUT_STATE_COOKIE)?.value ?? request.nextUrl.searchParams.get('state')
  const row = await companyOfRevolutState(state)
  if (!row) throw new NotFoundError('Autorisation Revolut introuvable ou expirée. Recommencez depuis Kledg.')
  return row.companyId
}

/**
 * Company of the stored attachment named by the `attachmentId` segment; for
 * a receipt not synchronized yet, the company in the query string (its own
 * Qonto credentials and one of its own transactions are then required by
 * readQontoReceipt).
 */
export const fromQontoAttachment: CompanyResolver = async (input) => {
  const ref = input.params.attachmentId
  const row = typeof ref === 'string' && ref ? await companyOfQontoAttachment(ref) : null
  return row?.companyId ?? fromQuery()(input)
}
