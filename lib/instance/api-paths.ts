/**
 * API paths the instance policy declares self-authenticated, and pages it
 * declares public. Pure (no database, no Node APIs): the request proxy
 * imports it.
 */

import { PUBLIC_PAGES, SELF_AUTHENTICATED_API_ROUTES } from './policy'

/**
 * Whether `pathname` is served by a route the policy declares
 * self-authenticated: the declared path itself or a path under it, matched on
 * segment boundaries (`/api/demo` covers `/api/demo/reset`, never
 * `/api/demo-admin`). A trailing slash on either side is ignored.
 */
export function isSelfAuthenticatedApiPath(
  pathname: string,
  routes: Readonly<Record<string, string>> = SELF_AUTHENTICATED_API_ROUTES,
): boolean {
  const path = pathname.replace(/\/+$/, '')
  return Object.keys(routes).some((declared) => {
    const prefix = declared.replace(/\/+$/, '')
    return prefix !== '' && (path === prefix || path.startsWith(`${prefix}/`))
  })
}

/** Whether `pathname` is a page the policy opens without a session (the page itself or a path under it). */
export function isInstancePublicPage(pathname: string, pages: readonly string[] = PUBLIC_PAGES): boolean {
  return pages.some((page) => pathname === page || pathname.startsWith(`${page}/`))
}
