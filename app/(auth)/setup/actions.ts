'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import {
  consumeSetupLinks,
  getSetupAdminEmail,
  isValidSetupCredential,
  maskEmail,
  needsSetup,
  runFirstUserCreation,
  sendSetupLink,
  SETUP_LINK_TTL_MINUTES,
  SetupAlreadyDoneError,
  setupMode,
} from '@/lib/setup'
import { isActionAllowed } from '@/lib/instance'
import { RATE_LIMITS, withinRateLimit } from '@/lib/rate-limit'
import { clientIpOrUnknown } from '@/lib/client-ip'
import { logger } from '@/lib/logger'

const schema = z.object({
  name: z.string().trim().min(1, 'Le nom est requis'),
  email: z.email('Email invalide').transform((v) => v.trim().toLowerCase()),
  password: z.string().min(10, 'Le mot de passe doit contenir au moins 10 caractères'),
  token: z.string().max(500).optional(),
})

export type SetupResult = { ok: true } | { ok: false; error: string }

const ALREADY_DONE = 'Cette instance est déjà configurée.'

const SETUP_BLOCKED =
  "Installation bloquée : définissez BETTER_AUTH_SECRET, ou SETUP_TOKEN (au moins 16 caractères), puis redéployez."

export async function createFirstAdmin(input: z.input<typeof schema>): Promise<SetupResult> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Données invalides' }
  }

  if (!(await isActionAllowed('setup')) || !(await needsSetup())) {
    return { ok: false, error: ALREADY_DONE }
  }

  // Neither a usable SETUP_TOKEN nor email delivery: nobody can claim the instance (lib/setup.ts).
  const mode = await setupMode()
  if (mode === 'blocked') return { ok: false, error: SETUP_BLOCKED }

  const ip = clientIpOrUnknown(await headers())
  if (!(await withinRateLimit('setup', ip))) {
    return { ok: false, error: RATE_LIMITS.setup.message }
  }

  if (!(await isValidSetupCredential(parsed.data.token))) {
    return {
      ok: false,
      error:
        mode === 'token'
          ? "Jeton d'installation invalide. Utilisez le lien contenant SETUP_TOKEN, défini lors du déploiement."
          : "Ce lien d'installation n'est plus valable. Reprenez le lien donné par le guide de déploiement, ou demandez-en un nouveau.",
    }
  }

  const allowedEmail = getSetupAdminEmail()
  if (allowedEmail && parsed.data.email !== allowedEmail) {
    return {
      ok: false,
      error: 'Cet email ne correspond pas à ADMIN_EMAIL, défini lors du déploiement.',
    }
  }

  try {
    // Serialized with an advisory lock: only the first of concurrent submissions creates the account.
    await runFirstUserCreation(() =>
      // Called server-side without a session: the admin plugin allows it.
      auth.api.createUser({
        body: {
          email: parsed.data.email,
          password: parsed.data.password,
          name: parsed.data.name,
          role: 'admin',
        },
      }),
    )
  } catch (error) {
    if (error instanceof SetupAlreadyDoneError) return { ok: false, error: ALREADY_DONE }
    logger.error('Setup failed:', error)
    return { ok: false, error: 'La création du compte a échoué. Consultez les journaux du serveur.' }
  }

  await consumeSetupLinks().catch((error: unknown) => logger.error('Setup links cleanup failed:', error))
  return { ok: true }
}

export type SetupLinkRequestResult = { ok: true; sentTo: string; ttlMinutes: number } | { ok: false; error: string }

const SETUP_LINK_FAILED =
  "L'email n'a pas pu partir. Tant qu'aucun domaine n'est vérifié dans Resend, Resend n'envoie qu'à l'adresse de votre compte Resend : utilisez-la comme ADMIN_EMAIL, ou vérifiez un domaine et définissez EMAIL_FROM, puis redéployez. Vous pouvez aussi définir SETUP_TOKEN."

/** "Send me the installation link" on /setup (email mode, lib/setup.ts). The link only ever goes to ADMIN_EMAIL. */
export async function requestSetupLink(): Promise<SetupLinkRequestResult> {
  if (!(await isActionAllowed('setup')) || !(await needsSetup())) {
    return { ok: false, error: ALREADY_DONE }
  }
  const adminEmail = getSetupAdminEmail()
  if ((await setupMode()) !== 'email' || !adminEmail) return { ok: false, error: SETUP_BLOCKED }

  const ip = clientIpOrUnknown(await headers())
  if (!(await withinRateLimit('setup', ip))) {
    return { ok: false, error: RATE_LIMITS.setup.message }
  }

  const result = await sendSetupLink()
  if (result === 'failed') return { ok: false, error: SETUP_LINK_FAILED }
  // "throttled": a link left less than a minute ago, the same answer points to it.
  return { ok: true, sentTo: maskEmail(adminEmail), ttlMinutes: SETUP_LINK_TTL_MINUTES }
}
