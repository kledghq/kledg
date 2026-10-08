'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { acceptInvitation, type Acceptor } from '@/lib/rbac/company-invitations.service'
import { RATE_LIMITS, withinRateLimit } from '@/lib/rate-limit'
import { clientIpOrUnknown } from '@/lib/client-ip'
import { handleError } from '@/lib/accounting/errors'

/** Better Auth's bounds (lib/auth.ts: minPasswordLength 10; its default maximum 128). */
const NewAccountSchema = z.object({
  name: z.string().trim().max(200, 'Le nom est trop long.'),
  password: z
    .string()
    .min(10, 'Le mot de passe doit contenir au moins 10 caractères.')
    .max(128, 'Le mot de passe doit contenir au plus 128 caractères.'),
})

export type AcceptInvitationResult = { ok: true; href: string; email: string } | { ok: false; error: string }

const UNEXPECTED = "L'invitation n'a pas pu être acceptée. Réessayez dans quelques minutes."

async function accept(token: string, acceptor: Acceptor): Promise<AcceptInvitationResult> {
  if (!(await withinRateLimit('invitation-accept', clientIpOrUnknown(await headers())))) {
    return { ok: false, error: RATE_LIMITS['invitation-accept'].message }
  }
  try {
    const result = await acceptInvitation(String(token), acceptor)
    return { ok: true, href: `/${result.companySlug}`, email: result.email }
  } catch (error) {
    const { message, statusCode } = handleError(error)
    return { ok: false, error: statusCode >= 500 ? UNEXPECTED : message }
  }
}

/** "Rejoindre la société" of a signed-in user: their account must be the invited address. */
export async function acceptAsSignedInUser(token: string): Promise<AcceptInvitationResult> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: "Connectez-vous pour accepter l'invitation." }
  return accept(token, { user })
}

/** Creates the invitee's account from the link (when the instance allows it), then the membership. */
export async function acceptWithNewAccount(token: string, input: { name: string; password: string }): Promise<AcceptInvitationResult> {
  const parsed = NewAccountSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }
  return accept(token, { newAccount: parsed.data })
}
