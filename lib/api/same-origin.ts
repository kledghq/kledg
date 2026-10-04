import type { NextRequest } from 'next/server'
import { ForbiddenError } from '@/lib/accounting/errors'
import { getTrustedOrigins } from '@/lib/config'

/**
 * CSRF guard for state-changing routes that act outside the instance (on
 * GitHub, for example). Session cookies are SameSite=Lax already; this also
 * refuses cross-site requests explicitly: browsers send Sec-Fetch-Site and
 * Origin on every POST, PUT, PATCH and DELETE. Requests without either
 * header do not come from a browser page, so they carry no CSRF risk.
 */
export function assertSameOrigin(request: NextRequest): void {
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') {
    throw new ForbiddenError('Requête refusée : elle ne vient pas de cette instance.')
  }
  const origin = request.headers.get('origin')
  if (origin) {
    const allowed = new Set([request.nextUrl.origin, ...getTrustedOrigins()])
    if (!allowed.has(origin)) {
      throw new ForbiddenError('Requête refusée : elle ne vient pas de cette instance.')
    }
  }
}
