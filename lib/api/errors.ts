import { NextResponse } from 'next/server'
import { handleError } from '@/lib/accounting/errors'

/**
 * JSON error response `{ error }` with the status mapped by handleError,
 * plus the `details` fields of a typed error (they never replace `error`).
 */
export function toErrorResponse(error: unknown): NextResponse {
  const { message, statusCode, details } = handleError(error)
  return NextResponse.json({ ...details, error: message }, { status: statusCode })
}
