/**
 * The context of a statement sent without one (docs/rls.md#context-propagation).
 *
 * Route wrappers, the MCP endpoint, crons and scripts set their context
 * explicitly. Server components and server actions query through services
 * without a wrapper around them: their first statement without a context
 * derives it from the session cookie of the Next request (the signed-in
 * user, or `anonymous`), once per request. Outside a request there is none,
 * and the statement runs without context (no row, no write).
 *
 * The derivation reads the session row by its token itself, with one query
 * on Better Auth's `session` table (exempt from the policies): it never calls
 * Better Auth, whose own state (an open transaction of its adapter) may
 * belong to the very statement being derived. The token is the secret
 * Better Auth checks too; the signature of the cookie only saves Better Auth
 * a lookup for forged values, which find no row here. The acting user's ban
 * is checked by the database (kledg_rls_company_ids).
 */

import { getSessionCookie } from 'better-auth/cookies'
import { ANONYMOUS_CONTEXT, type RlsContext } from './context'

/** The user of an unexpired session with this token, or undefined. */
export type FindSessionUser = (token: string) => Promise<string | undefined>

/**
 * Tests only (VITEST): the context of statements that tests send directly,
 * outside any request (seeding rows, reading them back). Set by
 * lib/__tests__/helpers/test-db.ts when the suite runs with KLEDG_RLS=enforce.
 */
function testFallback(env: Record<string, string | undefined> = process.env): RlsContext | undefined {
  if (!env.VITEST || env.NODE_ENV === 'production') return undefined
  return env.KLEDG_RLS_TEST_CONTEXT === 'system' ? { access: 'system', reason: 'test' } : undefined
}

async function requestHeaders(): Promise<Headers | undefined> {
  let headers: () => Promise<Headers>
  try {
    headers = (await import('next/headers')).headers as unknown as () => Promise<Headers>
  } catch {
    return undefined
  }
  try {
    return await headers()
  } catch (error) {
    // Prerendering signals (dynamic usage, postpone) must reach Next.
    const { unstable_rethrow } = await import('next/navigation')
    unstable_rethrow(error)
    return undefined
  }
}

/** The session token of a signed session cookie (`<token>.<signature>`), or undefined. */
export function sessionTokenOf(headers: Headers): string | undefined {
  const value = getSessionCookie(headers)
  if (!value) return undefined
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return undefined
  }
  const token = decoded.split('.')[0]
  return token && token.length <= 255 ? token : undefined
}

export function createRequestContextResolver(findSessionUser: FindSessionUser): () => Promise<RlsContext | undefined> {
  /** Derived contexts, per request (the request's headers object). */
  const perRequest = new WeakMap<object, Promise<RlsContext | undefined>>()

  return async function deriveRequestContext() {
    const headers = await requestHeaders()
    if (!headers) return testFallback()
    let pending = perRequest.get(headers)
    if (!pending) {
      const token = sessionTokenOf(headers)
      pending = (async () => {
        const userId = token ? await findSessionUser(token) : undefined
        return userId ? ({ access: 'user', userId } as const) : undefined
      })()
      // A failed lookup (database waking up) is tried again by the next statement.
      pending.catch(() => perRequest.delete(headers))
      perRequest.set(headers, pending)
    }
    return (await pending) ?? testFallback() ?? ANONYMOUS_CONTEXT
  }
}
