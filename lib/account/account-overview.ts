/**
 * What the profile page needs to render: the user's details and, for each
 * account action, whether this instance lets the user perform it (instance
 * policy, email configuration, deletion guards). Refused actions carry the
 * French message shown next to their disabled controls.
 */

import { prisma } from '@/lib/prisma'
import { actionRefusalMessage, isActionAllowed } from '@/lib/instance'
import { NotFoundError } from '@/lib/accounting/errors'
import type { CurrentUser } from '@/lib/session'
import { emailChangeMode, type EmailChangeMode } from './change-email.service'
import { checkAccountDeletion, type AccountCompany } from './deletion-guards'

export type ActionState = { allowed: true } | { allowed: false; message: string }

export interface AccountOverview {
  profile: { name: string; email: string; emailVerified: boolean; isAdmin: boolean }
  email: EmailChangeMode
  password: ActionState
  deletion: ActionState & { blockers: string[]; companies: AccountCompany[] }
}

export async function getAccountOverview(user: CurrentUser): Promise<AccountOverview> {
  const actor = { id: user.id, email: user.email, role: user.role }
  const [row, email, passwordAllowed, deletionAllowed, deletion] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { name: true, email: true, emailVerified: true } }),
    emailChangeMode(user),
    isActionAllowed('change-password', actor),
    isActionAllowed('delete-account', actor),
    checkAccountDeletion(user),
  ])
  if (!row) throw new NotFoundError('Compte introuvable')

  return {
    profile: { name: row.name, email: row.email, emailVerified: row.emailVerified, isAdmin: user.role === 'admin' },
    email,
    password: passwordAllowed ? { allowed: true } : { allowed: false, message: actionRefusalMessage('change-password') },
    deletion: {
      ...(deletionAllowed
        ? { allowed: true as const }
        : { allowed: false as const, message: actionRefusalMessage('delete-account') }),
      blockers: deletion.blockers,
      companies: deletion.companies,
    },
  }
}
