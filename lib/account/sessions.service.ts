/**
 * Active sessions of the signed-in user. Sessions are read and revoked by
 * id, scoped to the user: session tokens (bearer secrets) never leave the
 * server, unlike Better Auth's listSessions which returns them to the
 * browser. Kledg keeps sessions in the database only (no cookie cache, no
 * secondary storage), so deleting the row signs the device out.
 */

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { NotFoundError, UnauthorizedError, ValidationError } from '@/lib/accounting/errors'
import { describeUserAgent } from './user-agent'

export interface AccountSession {
  id: string
  device: string
  ipAddress: string | null
  createdAt: string
  lastActiveAt: string
  current: boolean
}

const MAX_SESSIONS = 100

/** The stored IP, unless it is an unspecified address (no proxy header in front of the server). */
function meaningfulIp(ip: string | null): string | null {
  if (!ip) return null
  return /^[0:.]+$/.test(ip) ? null : ip
}

/** Id of the session making the request. */
export async function currentSessionId(headers: Headers): Promise<string> {
  const session = await auth.api.getSession({ headers })
  if (!session?.session) throw new UnauthorizedError('Non authentifié')
  return session.session.id
}

export async function listSessions(userId: string, currentId: string, now = new Date()): Promise<AccountSession[]> {
  const rows = await prisma.session.findMany({
    where: { userId, expiresAt: { gt: now } },
    select: { id: true, userAgent: true, ipAddress: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: MAX_SESSIONS,
  })
  return rows
    .map((row) => ({
      id: row.id,
      device: describeUserAgent(row.userAgent),
      ipAddress: meaningfulIp(row.ipAddress),
      createdAt: row.createdAt.toISOString(),
      lastActiveAt: row.updatedAt.toISOString(),
      current: row.id === currentId,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current))
}

/** Signs one other device out. The current session ends with "Se déconnecter". */
export async function revokeSession(userId: string, currentId: string, sessionId: string): Promise<void> {
  if (sessionId === currentId) {
    throw new ValidationError('Cette session est celle que vous utilisez : utilisez « Se déconnecter ».')
  }
  const { count } = await prisma.session.deleteMany({ where: { id: sessionId, userId } })
  if (count === 0) throw new NotFoundError('Session introuvable')
}

/** Signs every other device out; returns how many sessions ended. */
export async function revokeOtherSessions(userId: string, currentId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId, id: { not: currentId } } })
  return count
}
