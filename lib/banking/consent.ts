/**
 * Bank consent expiry (pure, shared by server and client).
 *
 * PSD2 access to an account must be renewed by the user at the bank: every
 * 90 days for Revolut Business (refresh token lifetime), 90 or 180 days for
 * Ponto banks (authorizationExpirationExpectedAt). Kledg warns 14 days and
 * 3 days before, then shows the account as stale since the expiry date.
 */

export const CONSENT_WARNING_DAYS = 14
export const CONSENT_URGENT_DAYS = 3

export type ConsentLevel = 'none' | 'ok' | 'soon' | 'urgent' | 'expired'

export interface ConsentStatus {
  level: ConsentLevel
  /** Whole days left (ceil), negative once expired; null without expiry. */
  daysLeft: number | null
  /** The expiry date once passed: data is stale since then. */
  staleSince: Date | null
}

const DAY_MS = 86_400_000

export function consentStatus(expiresAt: Date | string | null | undefined, now: Date = new Date()): ConsentStatus {
  if (!expiresAt) return { level: 'none', daysLeft: null, staleSince: null }
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt
  if (Number.isNaN(expiry.getTime())) return { level: 'none', daysLeft: null, staleSince: null }
  const remaining = expiry.getTime() - now.getTime()
  if (remaining <= 0) {
    return { level: 'expired', daysLeft: Math.floor(remaining / DAY_MS), staleSince: expiry }
  }
  const daysLeft = Math.ceil(remaining / DAY_MS)
  const level: ConsentLevel = daysLeft <= CONSENT_URGENT_DAYS ? 'urgent' : daysLeft <= CONSENT_WARNING_DAYS ? 'soon' : 'ok'
  return { level, daysLeft, staleSince: null }
}

/** Earliest of several expiry dates (null when none). */
export function earliestExpiry(dates: Array<Date | null | undefined>): Date | null {
  let earliest: Date | null = null
  for (const d of dates) if (d && (!earliest || d < earliest)) earliest = d
  return earliest
}
