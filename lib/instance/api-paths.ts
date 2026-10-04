/**
 * API paths the instance policy declares self-authenticated, and pages it
 * declares public. Pure (no database, no Node APIs): the request proxy
 * imports it.
 */

import { PUBLIC_PAGES, SELF_AUTHENTICATED_API_ROUTES } from './policy'

/** Whether `pathname` is served by a route the policy declares self-authenticated. */
export function isSelfAuthenticatedApiPath(pathname: string): boolean {
  return Object.keys(SELF_AUTHENTICATED_API_ROUTES).some((prefix) => pathname.startsWith(prefix))
}

/** Whether `pathname` is a page the policy opens without a session (the page itself or a path under it). */
export function isInstancePublicPage(pathname: string, pages: readonly string[] = PUBLIC_PAGES): boolean {
  return pages.some((page) => pathname === page || pathname.startsWith(`${page}/`))
}
