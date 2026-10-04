import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { withAuthCookies } from '@/lib/api/auth-cookies'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { logger } from '@/lib/logger'

/** Page that asks to confirm, for a direct visit or a request from another site. */
const SIGN_OUT_CONFIRM_PATH = '/auth/signout/confirm'

const redirectTo = (request: NextRequest, path: string) =>
  // 303: the browser follows with a GET, whatever the method of the request.
  NextResponse.redirect(new URL(path, request.nextUrl.origin), 303)

/**
 * Sign out: POST only, from a page of this instance. A GET that signs out
 * lets any other site log the user out (an image or a link pointing here is
 * enough), so a GET only shows the confirmation page, and a POST that does
 * not come from this instance (assertSameOrigin) is sent there too instead
 * of signing out.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request)
  } catch {
    return redirectTo(request, SIGN_OUT_CONFIRM_PATH)
  }
  const response = redirectTo(request, '/login')
  // Drops what the browser kept of the signed-in pages (HTTP cache). Not
  // "storage": that would unregister the service worker and wipe the theme
  // choice; the worker's caches hold no data and the user menu clears them
  // before posting here (components/pwa/install.ts).
  response.headers.set('Clear-Site-Data', '"cache"')
  try {
    const result = await auth.api.signOut({ headers: request.headers, returnHeaders: true })
    // Clear the session cookies in the browser, the session cache cookie
    // included (lib/auth.ts, session.cookieCache): deleting the session row
    // alone would leave the cache usable until it expires.
    return withAuthCookies(response, result.headers)
  } catch (error) {
    // No session (already signed out, expired): nothing to revoke.
    logger.debug('Sign out without a session', error)
    return response
  }
}

/** A link or a bookmark: ask before signing out. */
export async function GET(request: NextRequest) {
  return redirectTo(request, SIGN_OUT_CONFIRM_PATH)
}
