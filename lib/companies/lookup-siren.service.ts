/**
 * Looks a SIREN up in the public company directory to prefill the company
 * wizard (see siren-lookup.ts for the API and the mapping).
 *
 * Only https://recherche-entreprises.api.gouv.fr is called, with the 9
 * digits as the only input, no redirect and a short timeout. The lookup is a
 * convenience: when the directory is slow, down, rate limited or answers
 * something unexpected, the result is "unavailable" and the user types the
 * information. It never throws for those cases, so company creation never
 * depends on it.
 */

import { logger } from '@/lib/logger'
import { mapSearchResponse, normalizeSiren, type ApiSearchResponse, type SirenLookupResult } from './siren-lookup'

export const RECHERCHE_ENTREPRISES_API = 'https://recherche-entreprises.api.gouv.fr'
export const SIREN_LOOKUP_TIMEOUT_MS = 4_000

export type SirenLookupOutcome =
  | { status: 'found'; company: SirenLookupResult }
  | { status: 'not_found' }
  | { status: 'unavailable' }

export async function lookupSiren(
  input: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<SirenLookupOutcome> {
  const siren = normalizeSiren(input)
  if (!siren) return { status: 'not_found' }
  const doFetch = options.fetch ?? fetch
  const url = new URL('/search', RECHERCHE_ENTREPRISES_API)
  url.searchParams.set('q', siren)
  url.searchParams.set('page', '1')
  url.searchParams.set('per_page', '5')
  url.searchParams.set('minimal', 'true')
  url.searchParams.set('include', 'siege')
  try {
    const response = await doFetch(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? SIREN_LOOKUP_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!response.ok) {
      logger.warn('SIREN lookup refused', { status: response.status })
      return { status: 'unavailable' }
    }
    const body = (await response.json()) as ApiSearchResponse
    if (!body || typeof body !== 'object' || !Array.isArray(body.results)) {
      logger.warn('SIREN lookup: unexpected response shape')
      return { status: 'unavailable' }
    }
    const company = mapSearchResponse(siren, body)
    return company ? { status: 'found', company } : { status: 'not_found' }
  } catch (error) {
    logger.warn('SIREN lookup failed', { error: error instanceof Error ? error.name : 'unknown' })
    return { status: 'unavailable' }
  }
}
