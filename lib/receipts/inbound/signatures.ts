/**
 * Checks that an inbound email request comes from its provider (pure
 * module, node:crypto). Every comparison is in constant time, and a signed
 * request older or newer than TOLERANCE_SECONDS is refused (a replay of an
 * old request would only stage the same files again, which staging
 * ignores, but it is refused all the same).
 *
 * - Resend signs with Svix: base64 HMAC-SHA256, keyed with the base64 part
 *   of the secret after "whsec_", of "<svix-id>.<svix-timestamp>.<raw body>";
 *   svix-signature lists signatures as "v1,<base64>" separated by spaces
 *   (https://docs.svix.com/receiving/verifying-payloads/how-manual).
 * - Mailgun signs a posted message with hex HMAC-SHA256, keyed with the
 *   webhook signing key, of timestamp followed by token
 *   (https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks).
 * - Postmark does not sign inbound webhooks: the password of the basic
 *   authentication in the webhook URL is checked
 *   (https://postmarkapp.com/developer/webhooks/webhooks-overview).
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export const TOLERANCE_SECONDS = 5 * 60

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function fresh(timestamp: string, now: Date): boolean {
  const seconds = Number(timestamp)
  return Number.isInteger(seconds) && Math.abs(now.getTime() / 1000 - seconds) <= TOLERANCE_SECONDS
}

export function verifySvix(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  now: Date = new Date(),
): boolean {
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature || !fresh(timestamp, now)) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  if (key.length === 0) return false
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64')
  return signature
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .some((part) => sameText(part.slice(3), expected))
}

export function verifyMailgun(fields: { timestamp: string | null; token: string | null; signature: string | null }, signingKey: string, now: Date = new Date()): boolean {
  const { timestamp, token, signature } = fields
  if (!timestamp || !token || !signature || !fresh(timestamp, now)) return false
  const expected = createHmac('sha256', signingKey).update(`${timestamp}${token}`).digest('hex')
  return sameText(signature.toLowerCase(), expected)
}

/** The password of an "Authorization: Basic ..." header (any user name). */
export function verifyBasicPassword(authorization: string | null, password: string): boolean {
  if (!authorization?.startsWith('Basic ')) return false
  const decoded = Buffer.from(authorization.slice(6).trim(), 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  return colon >= 0 && sameText(decoded.slice(colon + 1), password)
}
