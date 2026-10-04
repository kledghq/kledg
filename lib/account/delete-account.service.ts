/**
 * Deletion of the signed-in user's own account, through Better Auth's
 * deleteUser (password checked there). Refused by the instance policy
 * ("delete-account") or when the user is the last administrator of the
 * instance or of a company (deletion-guards.ts, checked again by the
 * beforeDelete hook of lib/auth.ts). Companies are kept: the user only loses
 * access to them.
 *
 * The guards are checked again under the instance users lock, and the
 * deletion runs before it is released: two last administrators deleting
 * their accounts at once are serialized, and the second one is refused.
 */

import { auth } from '@/lib/auth'
import { assertActionAllowed } from '@/lib/instance'
import { enforceRateLimit } from '@/lib/rate-limit'
import { ConflictError, ValidationError } from '@/lib/accounting/errors'
import type { CurrentUser } from '@/lib/session'
import { callAuth } from './auth-errors'
import { checkAccountDeletion, withInstanceUsersLock } from './deletion-guards'
import type { DeleteAccountInput } from './schemas'

/** Returns Better Auth's response headers (they clear the session cookie). */
export async function deleteAccount(user: CurrentUser, headers: Headers, input: DeleteAccountInput): Promise<Headers> {
  await assertActionAllowed('delete-account', { id: user.id, email: user.email, role: user.role })
  if (input.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new ValidationError("L'adresse saisie ne correspond pas à celle de votre compte.")
  }
  // Early answer without the lock (most refusals), checked again under it.
  const { blockers } = await checkAccountDeletion(user)
  if (blockers.length > 0) throw new ConflictError(blockers.join(' '))
  await enforceRateLimit('account-delete', user.id)

  return withInstanceUsersLock(async (tx) => {
    // The role read from the database, not from the session cache.
    const current = await tx.user.findUnique({ where: { id: user.id }, select: { role: true } })
    const { blockers: locked } = await checkAccountDeletion({ id: user.id, role: current?.role ?? null }, { db: tx })
    if (locked.length > 0) throw new ConflictError(locked.join(' '))
    const result = await callAuth(() =>
      auth.api.deleteUser({ headers, body: { password: input.password }, returnHeaders: true }),
    )
    return result.headers
  })
}
