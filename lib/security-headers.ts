/**
 * HTTP security headers. No imports: next.config.ts and proxy.ts both use
 * this module.
 *
 * - Every response (next.config.ts): no framing (X-Frame-Options DENY, and
 *   frame-ancestors in the CSP), nosniff, a strict referrer policy, HSTS
 *   (browsers ignore it on plain HTTP, so local development is unaffected),
 *   a cross-origin opener policy and a permissions policy that turns off
 *   the device features Kledg never uses.
 * - API responses: a CSP that allows nothing (JSON is never rendered),
 *   except the file proxies (statements, receipts), which the app shows in
 *   an iframe of its own pages: framing by this origin only.
 * - Pages (proxy.ts): a CSP with a fresh nonce per request. Next.js reads
 *   the nonce from the CSP request header and puts it on its own scripts;
 *   'strict-dynamic' lets them load their chunks. No inline script runs
 *   without the nonce. Styles allow inline (Radix and sonner position
 *   elements with style attributes); images allow data: (company logos are
 *   stored as data URLs) and https: (logos of verified OAuth clients on the
 *   consent page).
 * - Files of the installable app (lib/pwa/paths.ts), served without the
 *   page CSP: the service worker runs under a policy of its own (same
 *   origin only; 'strict-dynamic' would refuse its scripts) and is
 *   revalidated on every load so a fix reaches browsers at once; the
 *   offline page is static HTML with no script at all.
 */

export const NONCE_HEADER = 'x-nonce'

/** The CSP of a page rendered with `nonce`. Development adds what React refresh needs. */
export function buildContentSecurityPolicy(nonce: string, options: { development: boolean }): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${options.development ? ' ws: wss:' : ''}`,
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ]
  return directives.join('; ')
}

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> }

/** Headers of next.config.ts. A later rule overrides the same header of an earlier one. */
/** Policy of the static files the proxy skips: images and styles from the app, no script, no framing. */
export const STATIC_FILE_CSP = "default-src 'none'; img-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

export const STATIC_SECURITY_HEADERS: HeaderRule[] = [
  {
    source: '/:path*',
    headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()',
      },
    ],
  },
  {
    source: '/api/:path*',
    headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" }],
  },
  // Files the proxy skips (config.matcher of proxy.ts): no page nonce there, so a strict policy of
  // their own, in case one is opened directly or answers with an HTML 404 (KLEDG-R3-INPUT-04).
  ...['/_next/static/:path*', '/_next/image', '/favicon.ico', '/icon.svg', '/apple-icon.png', '/logo.svg', '/icons/:path*'].map((source) => ({
    source,
    headers: [{ key: 'Content-Security-Policy', value: STATIC_FILE_CSP }],
  })),
  {
    source: '/sw.js',
    headers: [
      { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
      { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'" },
    ],
  },
  {
    source: '/offline.html',
    headers: [
      {
        key: 'Content-Security-Policy',
        value: "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    ],
  },
  {
    // Statements and receipts shown in an iframe of the app's own pages.
    source: '/api/:path*/proxy',
    headers: [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
    ],
  },
]
