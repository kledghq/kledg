/**
 * Reads the payload of a Better Auth email verification token (a JWT signed
 * by Better Auth). Only used to pick the email template: the signature is
 * checked by Better Auth when the link is opened, never here.
 */

/** Whether the token confirms an email change (its payload names the new address). */
export function isEmailChangeToken(token: string): boolean {
  const payload = token.split('.')[1]
  if (!payload) return false
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { updateTo?: unknown }
    return typeof json.updateTo === 'string' && json.updateTo.length > 0
  } catch {
    return false
  }
}
