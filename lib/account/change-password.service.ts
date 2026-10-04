/**
 * Password change of the signed-in user through Better Auth (it checks the
 * current password and the 10 character minimum of lib/auth.ts), after the
 * instance policy ("change-password").
 */

import { auth } from '@/lib/auth'
import { assertActionAllowed } from '@/lib/instance'
import { enforceRateLimit } from '@/lib/rate-limit'
import type { CurrentUser } from '@/lib/session'
import { callAuth } from './auth-errors'
import type { ChangePasswordInput } from './schemas'

/**
 * Returns the response headers of Better Auth: when other sessions are
 * revoked, the current one is replaced and its cookie must reach the browser.
 */
export async function changePassword(user: CurrentUser, headers: Headers, input: ChangePasswordInput): Promise<Headers> {
  await assertActionAllowed('change-password', { id: user.id, email: user.email, role: user.role })
  await enforceRateLimit('account-change-password', user.id)
  const result = await callAuth(() =>
    auth.api.changePassword({
      headers,
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        // Other sessions end unless the user explicitly keeps them.
        revokeOtherSessions: input.revokeOtherSessions ?? true,
      },
      returnHeaders: true,
    }),
  )
  return result.headers
}
