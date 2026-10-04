import type { NextResponse } from 'next/server'

/**
 * Copies the cookies Better Auth set on an in-process call (a replaced or
 * cleared session cookie) onto the route's response.
 */
export function withAuthCookies<T extends NextResponse>(response: T, authHeaders: Headers): T {
  for (const cookie of authHeaders.getSetCookie()) response.headers.append('set-cookie', cookie)
  return response
}
