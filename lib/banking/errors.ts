/**
 * Errors of the bank providers, as users see them.
 *
 * Invariant: a message written by a bank API (its error body, an English
 * detail, an internal code) never reaches the user, the database columns
 * shown in the UI (lastSyncError) or an API response. Provider failures are
 * mapped to French messages that say what to do; the provider's own detail
 * goes to the server log only.
 */

import { AccountingError, ExternalServiceError, RateLimitError } from '@/lib/accounting/errors'
import { logger } from '@/lib/logger'

/**
 * The provider refused the credentials or the bank consent (HTTP 401/403):
 * the user has to reconnect or renew the access. Reported as a 502 with its
 * reason, like any bank API failure.
 */
export class BankAuthorizationError extends ExternalServiceError {
  constructor(message: string) {
    super(message)
    this.name = 'BankAuthorizationError'
  }
}

/** Qonto refused credentials typed by the user (connection or update form). */
export const QONTO_CREDENTIALS_REFUSED = "Qonto refuse ces identifiants : vérifiez l'identifiant et la clé secrète de l'API."

/** Shown when a failure has no message written for users (database, bug, unknown library error). */
export const UNEXPECTED_BANK_ERROR_MESSAGE =
  'Une erreur inattendue a interrompu la synchronisation. Réessayez dans quelques minutes.'

export type BankProviderName = 'Qonto' | 'Ponto' | 'Revolut'

/** What to do when a provider refuses the access, per provider. */
const AUTHORIZATION_HINTS: Record<BankProviderName, string> = {
  Qonto: "Qonto refuse l'accès : vérifiez l'identifiant et la clé secrète de l'API, puis mettez-les à jour depuis la page Banque.",
  Ponto: "Ponto refuse l'accès : vérifiez l'identifiant et le secret de l'intégration Ponto, ou renouvelez l'accès à votre banque.",
  Revolut: "Revolut refuse l'accès : autorisez de nouveau Kledg dans Revolut Business.",
}

/** Provider error codes with a message of their own. */
const KNOWN_CODES: Record<string, (provider: BankProviderName) => AccountingError> = {
  // Ponto refuses a new bank synchronization a few minutes after the last one
  accountRecentlySynchronized: (p) =>
    new ExternalServiceError(`${p} a synchronisé ce compte avec la banque il y a peu : réessayez dans quelques minutes.`),
  authorizationExpired: (p) =>
    new BankAuthorizationError(`L'accès de ${p} à votre banque a expiré : renouvelez-le depuis la page Banque.`),
  invalid_client: (p) => new BankAuthorizationError(AUTHORIZATION_HINTS[p]),
  invalid_grant: (p) => new BankAuthorizationError(AUTHORIZATION_HINTS[p]),
}

export interface ProviderFailure {
  provider: BankProviderName
  status: number
  /** Provider error code, when its body has one. */
  code?: string
  /** Provider message: logged, never shown. */
  detail?: string
  /** What was being done, for the log. */
  operation?: string
}

/**
 * Maps a failed provider response to a typed error with a French message.
 * The provider's detail is logged (truncated), not returned.
 */
export function providerError(failure: ProviderFailure): AccountingError {
  const { provider, status, code } = failure
  if (status !== 429) {
    logger.error(`[Bank] ${provider} API error`, {
      status,
      code,
      operation: failure.operation,
      detail: failure.detail?.replace(/\s+/g, ' ').slice(0, 300),
    })
  }
  if (status === 429) return new RateLimitError(`${provider} limite le nombre de requêtes : réessayez dans quelques minutes.`)
  const known = code ? KNOWN_CODES[code] : undefined
  if (known) return known(provider)
  if (status === 401 || status === 403) return new BankAuthorizationError(AUTHORIZATION_HINTS[provider])
  if (status === 404) return new ExternalServiceError(`${provider} ne trouve pas l'élément demandé : actualisez la page puis réessayez.`)
  if (status >= 500) return new ExternalServiceError(`${provider} est indisponible pour le moment. Réessayez dans quelques minutes.`)
  return new ExternalServiceError(`${provider} a refusé la demande (erreur ${status}). Réessayez, ou vérifiez la connexion depuis la page Banque.`)
}

/**
 * Short, single-line reason from an error, safe to store and display.
 *
 * Only Kledg's typed errors (AccountingError and its subclasses) carry a
 * message written for users; anything else (a database error, a library
 * error, a bug) is logged and replaced by a generic French message.
 */
export function errorReason(error: unknown, max = 300): string {
  if (error instanceof AccountingError) return error.message.replace(/\s+/g, ' ').trim().slice(0, max)
  logger.error('[Bank] Unexpected error', error)
  return UNEXPECTED_BANK_ERROR_MESSAGE
}
