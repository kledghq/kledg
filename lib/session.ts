import { cache } from 'react'
import { headers } from 'next/headers'
import { auth } from './auth'
import { prisma } from './prisma'
import { isTransientConnectError } from './transient-db-error'

export type CurrentUser = {
  id: string
  email: string
  name: string | null
  role: string | null
}

/**
 * The signed-in user of the request.
 *
 * The session comes from Better Auth's cookie cache (lib/auth.ts,
 * SESSION_COOKIE_CACHE_SECONDS), which may be up to a minute old. One
 * indexed read confirms it against the database on every request: the
 * session row must still exist and be unexpired (a sign out on another
 * device, a password reset or change, an administrator revoking sessions
 * apply at once), the user must not be banned, and the instance
 * administrator role is the one stored now (a demotion applies at once).
 * Company access never comes from the session (memberships are read per
 * request, lib/rbac/authorize.ts).
 *
 * Wrapped in React `cache`: the layouts and the page of one server render
 * share a single lookup.
 *
 * The first request of a cold server can meet the database waking up: a
 * connection that never reached it is retried once (the Better Auth instance
 * whose initialization failed is made again, lib/resilient-singleton.ts),
 * instead of rendering "Erreur inattendue" (seen on /companies right after
 * signing in).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const requestHeaders = await headers()
  let session: Awaited<ReturnType<typeof auth.api.getSession>>
  try {
    session = await auth.api.getSession({ headers: requestHeaders })
  } catch (error) {
    if (!isTransientConnectError(error)) throw error
    session = await auth.api.getSession({ headers: requestHeaders })
  }
  if (!session?.user) return null
  const u = session.user as { id: string; email: string; name?: string | null; role?: string | null }
  const token = (session.session as { token?: string } | undefined)?.token
  if (!token) return null
  const current = await prisma.session.findUnique({
    where: { token },
    select: { userId: true, expiresAt: true, user: { select: { role: true, banned: true, banExpires: true } } },
  })
  const now = new Date()
  const banned = Boolean(current?.user.banned) && (!current?.user.banExpires || current.user.banExpires > now)
  if (!current || current.userId !== u.id || current.expiresAt <= now || banned) return null
  return { id: u.id, email: u.email, name: u.name ?? null, role: current.user.role ?? null }
})

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) {
    throw new UnauthorizedError()
  }
  return user
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}
