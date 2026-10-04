/**
 * Better Auth errors of the account endpoints translated into typed errors
 * with French messages (lib/account/auth-errors.ts). Better Auth's English
 * messages never reach the user.
 */

import { describe, expect, it } from 'vitest'
import { ForbiddenError, UnauthorizedError, ValidationError } from '@/lib/accounting/errors'
import { callAuth, rethrowAuthError } from '@/lib/account/auth-errors'

/** Shape of a Better Auth APIError: a message, a status code and a body with a code. */
function apiError(message: string, statusCode: number, code?: string) {
  return Object.assign(new Error(message), { statusCode, body: code ? { code, message } : { message } })
}

function caught(error: unknown): unknown {
  try {
    rethrowAuthError(error)
  } catch (thrown) {
    return thrown
  }
  throw new Error('rethrowAuthError returned')
}

describe('rethrowAuthError', () => {
  it.each([
    ['INVALID_PASSWORD', 'Mot de passe incorrect. Saisissez le mot de passe de votre compte.'],
    ['PASSWORD_TOO_SHORT', 'Le nouveau mot de passe est trop court (au moins 10 caractères).'],
    ['PASSWORD_TOO_LONG', 'Le nouveau mot de passe est trop long.'],
    ['CREDENTIAL_ACCOUNT_NOT_FOUND', "Ce compte n'a pas de mot de passe Kledg."],
  ])('maps %s to a French 400', (code, message) => {
    const thrown = caught(apiError('Invalid password', 400, code))
    expect(thrown).toBeInstanceOf(ValidationError)
    expect((thrown as Error).message).toBe(message)
  })

  it('maps an expired session to a French 401', () => {
    const thrown = caught(apiError('Session expired. Re-authenticate to perform this action.', 401, 'SESSION_EXPIRED'))
    expect(thrown).toBeInstanceOf(UnauthorizedError)
    expect((thrown as Error).message).toBe('Votre session a expiré. Reconnectez-vous, puis recommencez.')
  })

  it('maps another 401 to "Non authentifié"', () => {
    const thrown = caught(apiError('Unauthorized', 401, 'UNKNOWN_CODE'))
    expect(thrown).toBeInstanceOf(UnauthorizedError)
    expect((thrown as Error).message).toBe('Non authentifié')
  })

  it("keeps the instance policy's French message of a 403", () => {
    const message = "Cette action est désactivée sur cette instance. Contactez l'administrateur de l'instance."
    const thrown = caught(apiError(message, 403))
    expect(thrown).toBeInstanceOf(ForbiddenError)
    expect((thrown as Error).message).toBe(message)
  })

  it('lets anything else through unchanged (a 500 for the route wrapper)', () => {
    const database = new Error('connect ECONNREFUSED')
    expect(caught(database)).toBe(database)
    const limited = apiError('Too many requests', 429, 'RATE_LIMITED')
    expect(caught(limited)).toBe(limited)
    // A 403 without a message carries nothing to show
    const silent = Object.assign(new Error(''), { statusCode: 403 })
    expect(caught(silent)).toBe(silent)
    expect(caught('boom')).toBe('boom')
    const odd = { body: { code: 42 }, statusCode: '401' }
    expect(caught(odd)).toBe(odd)
  })
})

describe('callAuth', () => {
  it('returns the result of the endpoint', async () => {
    expect(await callAuth(async () => ({ status: true }))).toEqual({ status: true })
  })

  it('translates the error of the endpoint', async () => {
    const error = await callAuth(async () => Promise.reject(apiError('Invalid password', 400, 'INVALID_PASSWORD'))).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as Error).message).toBe('Mot de passe incorrect. Saisissez le mot de passe de votre compte.')
  })
})
