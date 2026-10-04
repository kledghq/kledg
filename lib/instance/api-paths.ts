/**
 * API paths the instance policy declares self-authenticated. Pure (no
 * database, no Node APIs): the request proxy imports it.
 */

import { SELF_AUTHENTICATED_API_ROUTES } from './policy'

/** Whether `pathname` is served by a route the policy declares self-authenticated. */
export function isSelfAuthenticatedApiPath(pathname: string): boolean {
  return Object.keys(SELF_AUTHENTICATED_API_ROUTES).some((prefix) => pathname.startsWith(prefix))
}
