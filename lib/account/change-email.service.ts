/**
 * Email change of the signed-in user. An address is never changed without
 * proof that the user owns it: Better Auth's changeEmail flow sends a link
 * to the new address and only switches when it is opened; the current
 * address gets a notice. The current password is asked first, so a session
 * left open cannot redirect the account to another mailbox.
 *
 * When the instance cannot send emails (no RESEND_API_KEY, or the policy
 * refuses "send-email"), no proof can be collected: regular users are told
 * to ask the instance administrator to configure emails, and an instance
 * administrator may change their own address directly after confirming their
 * password (they control the instance and its database anyway).
 */

import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { getAppUrl } from '@/lib/config'
import { isEmailEnabled, sendEmail } from '@/lib/email'
import { emailChangeNoticeEmail } from '@/lib/email/templates'
import { actionRefusalMessage, isActionAllowed } from '@/lib/instance'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ConflictError, ForbiddenError, ValidationError } from '@/lib/accounting/errors'
import type { CurrentUser } from '@/lib/session'
import { callAuth } from './auth-errors'
import type { ChangeEmailInput } from './schemas'

/**
 * How this user can change their email on this instance:
 * - verify: a confirmation link is sent to the new address;
 * - direct: instance administrator on an instance without emails;
 * - unavailable: emails are not configured, ask the administrator;
 * - refused: the instance policy refuses "change-email".
 */
export type EmailChangeMode =
  | { kind: 'verify' }
  | { kind: 'direct' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'refused'; message: string }

export const EMAIL_CHANGE_UNAVAILABLE_MESSAGE =
  "L'envoi d'emails n'est pas configuré sur cette instance : la nouvelle adresse ne peut pas être vérifiée. Demandez à l'administrateur de l'instance de configurer l'envoi d'emails."

/** Where the confirmation link brings the user back. */
const EMAIL_CHANGE_CALLBACK = '/settings/profile?email=confirmed'

function actorOf(user: CurrentUser) {
  return { id: user.id, email: user.email, role: user.role }
}

export async function emailChangeMode(user: CurrentUser): Promise<EmailChangeMode> {
  if (!(await isActionAllowed('change-email', actorOf(user)))) {
    return { kind: 'refused', message: actionRefusalMessage('change-email') }
  }
  if (await isEmailEnabled()) return { kind: 'verify' }
  if (user.role === 'admin') return { kind: 'direct' }
  return { kind: 'unavailable', message: EMAIL_CHANGE_UNAVAILABLE_MESSAGE }
}

export type ChangeEmailResult = { status: 'verification-sent' } | { status: 'updated'; email: string }

export async function requestEmailChange(
  user: CurrentUser,
  headers: Headers,
  input: ChangeEmailInput,
): Promise<ChangeEmailResult> {
  const mode = await emailChangeMode(user)
  if (mode.kind === 'refused') throw new ForbiddenError(mode.message)
  if (mode.kind === 'unavailable') throw new ConflictError(mode.message)

  const newEmail = input.newEmail
  if (newEmail === user.email.toLowerCase()) {
    throw new ValidationError("C'est déjà l'adresse de votre compte.")
  }
  await enforceRateLimit('account-change-email', user.id)

  await callAuth(() => auth.api.verifyPassword({ headers, body: { password: input.password } }))

  if (mode.kind === 'direct') {
    const taken = await prisma.user.findFirst({ where: { email: newEmail, id: { not: user.id } }, select: { id: true } })
    if (taken) throw new ConflictError('Cette adresse est déjà utilisée par un autre compte.')
    // Not verified: nobody proved the mailbox exists. The administrator chose it.
    await prisma.user.update({ where: { id: user.id }, data: { email: newEmail, emailVerified: false } })
    return { status: 'updated', email: newEmail }
  }

  // Better Auth answers the same way when the address belongs to another
  // account (nothing is sent), so the response never reveals who is
  // registered: neither by its content nor by its time, since the link to a
  // free address is sent after the response (lib/auth.ts, KLEDG-R3-AUTH-03).
  await callAuth(() => auth.api.changeEmail({ headers, body: { newEmail, callbackURL: EMAIL_CHANGE_CALLBACK } }))
  // The change itself is pending on the new address; the notice is best
  // effort, sent after the response too.
  waitUntil(
    sendEmail(emailChangeNoticeEmail(user.email, newEmail, `${getAppUrl()}/settings/profile`)).catch((error: unknown) => {
      logger.warn('Email change notice could not be sent', error)
    }),
  )
  return { status: 'verification-sent' }
}
