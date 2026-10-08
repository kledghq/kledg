import { ExternalServiceError } from '@/lib/accounting/errors'

/** Default timeout of a bank API call. */
const BANK_API_TIMEOUT_MS = 20_000

/**
 * Outbound call to a bank API: fixed hosts only (the caller builds the URL
 * from configuration), redirects refused, bounded by a timeout. Network
 * failures become a French ExternalServiceError naming the provider.
 */
export async function bankFetch(
  provider: string,
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
  timeoutMs = BANK_API_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new ExternalServiceError(
      timedOut ? `${provider} ne répond pas. Réessayez dans quelques minutes.` : `${provider} est injoignable. Réessayez dans quelques minutes.`,
    )
  }
}
