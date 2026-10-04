/**
 * Better Auth errors of the account endpoints, translated into Kledg's typed
 * errors with French messages. Better Auth's own messages are English and
 * never reach the user.
 */

import { ForbiddenError, UnauthorizedError, ValidationError } from '@/lib/accounting/errors'

const MESSAGES: Readonly<Record<string, string>> = {
  INVALID_PASSWORD: 'Mot de passe incorrect. Saisissez le mot de passe de votre compte.',
  PASSWORD_TOO_SHORT: 'Le nouveau mot de passe est trop court (au moins 10 caractères).',
  PASSWORD_TOO_LONG: 'Le nouveau mot de passe est trop long.',
  CREDENTIAL_ACCOUNT_NOT_FOUND: "Ce compte n'a pas de mot de passe Kledg.",
  SESSION_EXPIRED: 'Votre session a expiré. Reconnectez-vous, puis recommencez.',
}

function codeOf(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('body' in error)) return null
  const body = (error as { body?: unknown }).body
  if (!body || typeof body !== 'object' || !('code' in body)) return null
  const code = (body as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) return null
  const status = (error as { statusCode?: unknown }).statusCode
  return typeof status === 'number' ? status : null
}

/**
 * Rethrows a Better Auth APIError as a typed error. A 403 from the auth hook
 * carries the instance policy's French message, kept as is. Anything else
 * propagates (a 500 for the route wrapper).
 */
export function rethrowAuthError(error: unknown): never {
  const code = codeOf(error)
  if (code && MESSAGES[code]) {
    if (code === 'SESSION_EXPIRED') throw new UnauthorizedError(MESSAGES[code])
    throw new ValidationError(MESSAGES[code])
  }
  const status = statusOf(error)
  if (status === 401) throw new UnauthorizedError('Non authentifié')
  if (status === 403 && error instanceof Error && error.message) throw new ForbiddenError(error.message)
  throw error
}

/** Calls a Better Auth endpoint and translates its errors. */
export async function callAuth<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    rethrowAuthError(error)
  }
}
