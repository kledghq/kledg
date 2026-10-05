/**
 * Centralized error handling for API routes and services.
 */

import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { logger } from '@/lib/logger'
import { parseDatabaseGuard } from './database-guard'

export class AccountingError extends Error {
  /**
   * Extra JSON fields of the error response, next to `error`, for clients
   * that show more than one message (blocking reasons of a closing, accounts
   * that still have entries). Only data meant for the user: never internals.
   */
  details?: Record<string, unknown>

  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message)
    this.name = 'AccountingError'
  }

  /** Sets `details` and returns the error: `throw new ConflictError(msg).withDetails({ details: reasons })`. */
  withDetails(details: Record<string, unknown>): this {
    this.details = details
    return this
  }
}

export class ValidationError extends AccountingError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends AccountingError {
  /** A single word ("Entry") becomes "Entry not found"; a full sentence is kept as is. */
  constructor(resource: string) {
    super(/\s/.test(resource) ? resource : `${resource} not found`, 'NOT_FOUND', 404)
    this.name = 'NotFoundError'
  }
}

export class UnauthorizedError extends AccountingError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401)
    this.name = 'UnauthorizedError'
  }
}

export class ConflictError extends AccountingError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409)
    this.name = 'ConflictError'
  }
}

export class ForbiddenError extends AccountingError {
  constructor(message: string = 'Forbidden') {
    super(message, 'FORBIDDEN', 403)
    this.name = 'ForbiddenError'
  }
}

/** The request body is larger than the route accepts: 413. */
export class PayloadTooLargeError extends AccountingError {
  constructor(message: string) {
    super(message, 'PAYLOAD_TOO_LARGE', 413)
    this.name = 'PayloadTooLargeError'
  }
}

/** The request body is not of the type the route accepts (JSON, multipart): 415. */
export class UnsupportedMediaTypeError extends AccountingError {
  constructor(message: string) {
    super(message, 'UNSUPPORTED_MEDIA_TYPE', 415)
    this.name = 'UnsupportedMediaTypeError'
  }
}

/** A third-party service (the bank API) refused or failed the request: 502 with its reason. */
export class ExternalServiceError extends AccountingError {
  constructor(message: string) {
    super(message, 'EXTERNAL_SERVICE_ERROR', 502)
    this.name = 'ExternalServiceError'
  }
}

export class RateLimitError extends AccountingError {
  constructor(message: string = 'Too many requests. Please try again later.') {
    super(message, 'RATE_LIMIT', 429)
    this.name = 'RateLimitError'
  }
}

/** Refusal to delete a company that holds books (service check and trigger KLEDG_COMPANY_HAS_BOOKS, migration 20261011100000). */
export const COMPANY_HAS_BOOKS_MESSAGE =
  'Cette société a des écritures validées ou un exercice clôturé : ses livres doivent être conservés 10 ans (Code de commerce, art. L123-22). Archivez-la plutôt : elle passera en lecture seule et disparaîtra des listes.'

/** Marker of the database error raised when a closed fiscal year would change (lib/accounting/fiscal-year-closure/lock.ts). */
export const CLOSED_FISCAL_YEAR_MARKER = 'KLEDG_FISCAL_YEAR_CLOSED'

export const CLOSED_FISCAL_YEAR_MESSAGE =
  "L'exercice est clôturé : ses écritures ne peuvent plus être créées, modifiées ni supprimées. Passez la correction sur l'exercice ouvert."

/** A write in a closed fiscal year: 409. */
export class ClosedFiscalYearError extends ConflictError {
  constructor(year?: number) {
    super(
      year
        ? `L'exercice ${year} est clôturé : ses écritures ne peuvent plus être créées, modifiées ni supprimées. Passez la correction sur l'exercice ouvert.`
        : CLOSED_FISCAL_YEAR_MESSAGE
    )
    this.name = 'ClosedFiscalYearError'
  }
}

/** Whether `error` is the database refusing a write in a closed fiscal year. */
export function isClosedFiscalYearDbError(error: unknown): boolean {
  const seen = new Set<unknown>()
  const visit = (value: unknown, depth: number): boolean => {
    if (value === null || value === undefined || depth > 4) return false
    if (typeof value === 'string') return value.includes(CLOSED_FISCAL_YEAR_MARKER)
    if (typeof value !== 'object' || seen.has(value)) return false
    seen.add(value)
    const record = value as Record<string, unknown>
    return ['message', 'meta', 'cause', 'originalMessage', 'reason'].some((key) => visit(record[key], depth + 1))
  }
  return visit(error, 0)
}

/** French text after a trigger marker ("KLEDG_<MARKER>: <French text>") in a database error, or null. */
function triggerText(error: unknown, marker: string): string | null {
  const sources: string[] = []
  if (error instanceof Error) sources.push(error.message)
  if (error && typeof error === 'object') {
    const meta = (error as { meta?: unknown }).meta
    if (meta) sources.push(JSON.stringify(meta))
    const cause = (error as { cause?: unknown }).cause
    if (cause instanceof Error) sources.push(cause.message)
  }
  const pattern = new RegExp(`${marker}: ([^\\n"]+)`)
  for (const source of sources) {
    const match = pattern.exec(source)
    if (match) {
      const text = match[1].trim()
      return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
    }
  }
  return null
}

/**
 * Message of the database refusing to rename a journal or an account the
 * books use (triggers of migration 20261107090000_ledger_references_lock:
 * "KLEDG_LEDGER_REFERENCE: <French text>"), or null.
 */
export function ledgerReferenceMessage(error: unknown): string | null {
  const text = triggerText(error, 'KLEDG_LEDGER_REFERENCE')
  return text ? `${text} (PCG art. 1031-3 et 1031-4).` : null
}

/**
 * Message of the database refusing an entry in a closed period, or a period
 * lock it cannot take (triggers of migration 20261108090000_period_lock:
 * "KLEDG_PERIOD_LOCKED: <French text>"), or null.
 */
export function periodLockedMessage(error: unknown): string | null {
  const text = triggerText(error, 'KLEDG_PERIOD_LOCKED')
  return text ? `${text} (PCG art. 1031-4).` : null
}

/** Shown for every unexpected (500) error: details go to the server log only. */
export const INTERNAL_ERROR_MESSAGE = 'Une erreur interne est survenue. Réessayez ou contactez votre administrateur.'

/**
 * Maps an error to an HTTP status and a message safe to show to the client.
 * Known errors keep their message; anything unexpected becomes a generic 500
 * (the real error is logged, never returned: it may contain SQL, paths or secrets).
 */
export function handleError(error: unknown): { message: string; statusCode: number; details?: Record<string, unknown> } {
  if (error instanceof AccountingError) {
    return { message: error.message, statusCode: error.statusCode, ...(error.details && { details: error.details }) }
  }

  if (isClosedFiscalYearDbError(error)) {
    return { message: CLOSED_FISCAL_YEAR_MESSAGE, statusCode: 409 }
  }

  if (error instanceof ZodError) {
    return {
      message: error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; '),
      statusCode: 400,
    }
  }

  if (error instanceof Error && error.message.includes('KLEDG_COMPANY_HAS_BOOKS')) {
    return { message: COMPANY_HAS_BOOKS_MESSAGE, statusCode: 409 }
  }

  const reference = ledgerReferenceMessage(error) ?? periodLockedMessage(error)
  if (reference) return { message: reference, statusCode: 409 }

  // Database guards on accounting entries (validated entries are definitive)
  const guard = parseDatabaseGuard(error)
  if (guard) return { message: guard.text, statusCode: guard.kind === 'immutable' ? 409 : 400 }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return { message: 'Un enregistrement avec ces informations existe déjà.', statusCode: 409 }
      case 'P2003':
        return { message: 'Référence invalide : un élément lié est introuvable ou encore utilisé.', statusCode: 400 }
      case 'P2025':
        return { message: 'Élément introuvable.', statusCode: 404 }
    }
  }

  logger.error('Unhandled error in request:', error)
  return { message: INTERNAL_ERROR_MESSAGE, statusCode: 500 }
}
