/**
 * State of a fresh instance, as explained on the welcome page shown after
 * the first-run setup: can it send emails, where are updates installed, how
 * is the database backed up. Pure: reads an environment record, so tests
 * pass their own; never returns a secret, only whether it is set.
 */

import { detectPlatform, type Platform } from '@/lib/updates/hosting'

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
  }
}
