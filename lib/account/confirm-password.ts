/**
 * Checks the password of a signed-in user typed again before a sensitive
 * action (a full control API key, KLEDG-R3-AUTH-01). The user is already
 * authenticated by the route wrapper; this only proves the person at the
 * keyboard knows the password, with Better Auth's own hasher.
 */

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'

const INVALID_PASSWORD = 'Mot de passe incorrect. Saisissez le mot de passe de votre compte.'

export async function assertCurrentPassword(userId: string, password: string): Promise<void> {
  const account = await prisma.authAccount.findFirst({
    where: { userId, providerId: 'credential' },
    select: { password: true },
  })
  const context = await auth.$context
  // Same message whether the account has no password or a different one.
  if (!account?.password || !(await context.password.verify({ hash: account.password, password }))) {
    throw new ValidationError(INVALID_PASSWORD)
  }
}
