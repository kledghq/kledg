/**
 * Company resolvers of the receipt routes whose company is not in the
 * request as such (lib/api/route.ts CompanyResolver): the OAuth callback of
 * a receipt mailbox, which only carries the signed state.
 */

import { NotFoundError } from '@/lib/accounting/errors'
import { MAILBOX_OAUTH_COOKIE } from '@/lib/receipts/mailbox/oauth'
import { companyOfMailboxOAuthState } from '@/lib/receipts/mailbox/mailbox.service'
import type { CompanyResolver } from './route'

/** The company of the signed state (cookie first, else the query); its access is then checked as for any route. */
export const fromMailboxOAuthState: CompanyResolver = async ({ request }) => {
  const companyId = companyOfMailboxOAuthState(request.cookies.get(MAILBOX_OAUTH_COOKIE)?.value ?? request.nextUrl.searchParams.get('state'))
  if (!companyId) throw new NotFoundError('Connexion de la boîte introuvable ou expirée. Recommencez depuis Kledg.')
  return companyId
}
