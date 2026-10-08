/**
 * Everything that acts for a user without being one of their browser
 * sessions: API keys, OAuth assistants (consents, access and refresh
 * tokens), the company grants of both, pending assistant actions and
 * confirmations.
 *
 * One list for every eviction path, so they cannot drift:
 * - a password reset or change (KLEDG-R3-AUTH-01, lib/auth.ts): whoever held
 *   the session or the old password may have created a key or connected an
 *   assistant, which must not outlive the eviction;
 * - an unconfirmed account taken over by an administrator (KLEDG-SEC-011,
 *   lib/rbac/add-member-to-company.service.ts).
 *
 * Deleting the consent ends an OAuth access token at once: /api/mcp checks
 * the consent on every call (lib/mcp/auth.ts), and the database triggers drop
 * the tokens and grants of a deleted consent too.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { withUserContext } from '@/lib/rls/context'

type Db = Prisma.TransactionClient

/** Deletes the delegated access of `userId` inside the caller's transaction. */
export async function deleteDelegatedAccess(tx: Db, userId: string): Promise<void> {
  // API keys reference their user without a foreign key.
  await tx.apikey.deleteMany({ where: { referenceId: userId } })
  await tx.oauthConsent.deleteMany({ where: { userId } })
  await tx.oauthAccessToken.deleteMany({ where: { userId } })
  await tx.oauthRefreshToken.deleteMany({ where: { userId } })
  await tx.aiAccessGrant.deleteMany({ where: { userId } })
  await tx.mcpPendingAction.deleteMany({ where: { userId } })
  await tx.mcpConfirmation.deleteMany({ where: { userId } })
}

/**
 * Revokes the delegated access of `userId` in its own transaction, as that
 * user (row level security, docs/rls.md). Browser sessions are left to the
 * caller: a password change keeps the session that made it.
 */
export async function revokeDelegatedAccess(userId: string): Promise<void> {
  await withUserContext(userId, () => prisma.$transaction((tx) => deleteDelegatedAccess(tx, userId)))
}
