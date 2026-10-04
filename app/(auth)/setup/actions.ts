'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import {
  getSetupAdminEmail,
  isValidSetupToken,
  needsSetup,
  setupTokenStatus,
  runFirstUserCreation,
  SetupAlreadyDoneError,
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

const SETUP_TOKEN_MISSING =
  "Installation bloquée : définissez la variable d'environnement SETUP_TOKEN (au moins 16 caractères, par exemple avec openssl rand -base64 24), redéployez, puis ouvrez /setup?token=<SETUP_TOKEN>."

export async function createFirstAdmin(input: z.input<typeof schema>): Promise<SetupResult> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Données invalides' }
  }

  if (!(await isActionAllowed('setup')) || !(await needsSetup())) {
    return { ok: false, error: ALREADY_DONE }
  }

  // No usable SETUP_TOKEN: nobody can claim the instance (lib/setup.ts).
  if (setupTokenStatus() !== 'ok') return { ok: false, error: SETUP_TOKEN_MISSING }

  const ip = clientIpOrUnknown(await headers())
  if (!(await withinRateLimit('setup', ip))) {
    return { ok: false, error: RATE_LIMITS.setup.message }
  }

  if (!isValidSetupToken(parsed.data.token)) {
    return {
      ok: false,
      error: "Jeton d'installation invalide. Utilisez le lien contenant SETUP_TOKEN, défini lors du déploiement.",
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

  return { ok: true }
}
