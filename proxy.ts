import { NextResponse, type NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import { PATH_HEADER } from '@/lib/request-path'
import { isInstancePublicPage, isSelfAuthenticatedApiPath } from '@/lib/instance/api-paths'
import { withResolvedClientIp } from '@/lib/client-ip'
import { buildContentSecurityPolicy, NONCE_HEADER } from '@/lib/security-headers'
import { isPwaPublicPath } from '@/lib/pwa/paths'

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  // The client IP header read by Better Auth is always the resolved one
  // (lib/client-ip.ts), never a value sent by the client, for in-process
  // Better Auth calls of server components and actions too.
  const requestHeaders = withResolvedClientIp(request.headers)
  // Pages get a CSP with a fresh nonce: Next.js reads it from the request
  // header and puts it on its scripts (lib/security-headers.ts). The files
  // of the installable app have their own static policy there.
  const csp = pathname.startsWith('/api/') || isPwaPublicPath(pathname)
    ? null
    : buildContentSecurityPolicy(btoa(crypto.randomUUID()), { development: process.env.NODE_ENV === 'development' })
  if (csp) {
    requestHeaders.set('content-security-policy', csp)
    requestHeaders.set(NONCE_HEADER, /'nonce-([^']+)'/.exec(csp)?.[1] ?? '')
  }
  const next = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders } })
    if (csp) response.headers.set('Content-Security-Policy', csp)
    return response
  }

  const sessionCookie = getSessionCookie(request)
  const isAuthenticated = Boolean(sessionCookie)

  const publicRoutes = ['/login', '/setup', '/forgot-password', '/reset-password']
  // Plus the pages the instance policy opens (lib/instance/policy.ts, PUBLIC_PAGES).
  const isPublicRoute =
    publicRoutes.some(route => pathname === route || pathname.startsWith(route + '/')) ||
    isInstancePublicPage(pathname)

  // Auth endpoints, OAuth discovery, the MCP endpoint (bearer tokens), cron
  // jobs (CRON_SECRET) and the routes the instance policy declares
  // (lib/instance/policy.ts) authenticate requests themselves.
  // The example statement files are static, fictitious and linked from the docs.
  // The manifest, service worker and offline page hold no data and are
  // fetched without a session (lib/pwa/paths.ts).
  if (
    pathname.startsWith('/examples/') ||
    isPwaPublicPath(pathname) ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/.well-known/') ||
    pathname === '/api/mcp' ||
    pathname.startsWith('/api/cron/') ||
    pathname === '/api/health' ||
    isSelfAuthenticatedApiPath(pathname)
  ) {
    return next()
  }

  if (pathname.startsWith('/api/')) {
    if (!isAuthenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return next()
  }

  if (isPublicRoute) {
    // Always let public routes render. The /login page handles redirecting
    // authenticated users client-side (avoids server-side redirect loops
    // when the cookie/session state is inconsistent between edge middleware
    // reads on different paths).
    return next()
  }

  // The root page decides between /setup, /login and the dashboard.
  if (pathname === '/') {
    return next()
  }

  if (!isAuthenticated) {
    const redirectUrl = new URL('/login', request.url)
    redirectUrl.searchParams.set('redirect', pathname + request.nextUrl.search)
    return NextResponse.redirect(redirectUrl)
  }

  // Layouts don't receive the URL: the company layout reads it from this
  // header to redirect /<company id>/... to /<company slug>/...
  requestHeaders.set(PATH_HEADER, pathname + request.nextUrl.search)
  return next()
}

/**
 * Every path goes through the proxy (sign-in redirect, page CSP, path
 * header) except the static files that exist: Next.js build assets and image
 * optimizer, the app icons (app/favicon.ico, app/icon.svg,
 * app/apple-icon.png) and the images of public/. Never a rule on the
 * extension alone: a page such as /<company>/invoices/x.png would be
 * rendered without its CSP (KLEDG-R3-INPUT-04).
 */
export const config = {
  matcher: [
    '/((?!_next/static/|_next/image$|favicon\\.ico$|icon\\.svg$|apple-icon\\.png$|logo\\.svg$|icons/[\\w-]+\\.png$).*)',
  ],
}
