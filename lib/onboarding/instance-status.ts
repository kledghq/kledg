/**
 * State of a fresh instance, as explained on the welcome page shown after
 * the first-run setup: can it send emails, where are updates installed, how
 * is the database backed up. Pure: reads an environment record, so tests
 * pass their own; never returns a secret, only whether it is set.
 */

import { detectPlatform, type Platform } from '@/lib/updates/hosting'
import { getAppUrl } from '@/lib/config'

export type EmailStatus =
  /** RESEND_API_KEY and EMAIL_FROM are set: emails leave from the instance's own address. */
  | 'configured'
  /** RESEND_API_KEY without EMAIL_FROM: Resend's test sender, which only delivers to the Resend account owner. */
  | 'test-sender'
  /** No RESEND_API_KEY: emails are written to the server log. */
  | 'log-only'
  /** The instance policy refuses "send-email": emails are written to the server log. */
  | 'disabled'

export type HostingPlatform = Platform

export interface InstanceStatus {
  email: EmailStatus
  /** The sender address when EMAIL_FROM is set (an address, not a secret). */
  emailFrom: string | null
  platform: HostingPlatform
  /** Public address of the instance (BETTER_AUTH_URL), null when not set. */
  appUrl: string | null
  /** CRON_SECRET set: the daily bank sync can be scheduled outside Vercel. */
  cronSecretSet: boolean
  /** The address the instance answers on and puts in its links: BETTER_AUTH_URL, else the host's. */
  effectiveUrl: string
  /** SETUP_TOKEN still set: useless once the first account exists, best removed. */
  setupTokenSet: boolean
  /** BETTER_AUTH_SECRETS set: a rotation of the auth secret is under way (docs/configuration.md#changer-le-secret). */
  secretRotation: boolean
  /** Where the key sealing bank credentials comes from. */
  encryptionKey: 'own' | 'derived'
  /** Company isolation in the database (KLEDG_RLS, docs/rls.md). */
  rls: 'enforce' | 'off'
}

export function instanceStatus(
  env: Record<string, string | undefined>,
  options: { sendEmailAllowed: boolean },
): InstanceStatus {
  const hasKey = Boolean(env.RESEND_API_KEY?.trim())
  const from = env.EMAIL_FROM?.trim() || null
  const email: EmailStatus = !options.sendEmailAllowed
    ? 'disabled'
    : !hasKey
      ? 'log-only'
      : from
        ? 'configured'
        : 'test-sender'
  return {
    email,
    emailFrom: from,
    platform: detectPlatform(env),
    appUrl: env.BETTER_AUTH_URL?.trim() || null,
    cronSecretSet: Boolean(env.CRON_SECRET?.trim()),
    effectiveUrl: getAppUrl(env),
    setupTokenSet: Boolean(env.SETUP_TOKEN?.trim()),
    secretRotation: Boolean(env.BETTER_AUTH_SECRETS?.trim()),
    encryptionKey: env.ENCRYPTION_KEY?.trim() ? 'own' : 'derived',
    rls: env.KLEDG_RLS?.trim() === 'enforce' ? 'enforce' : 'off',
  }
}
