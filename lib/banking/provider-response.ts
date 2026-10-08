/**
 * Responses of the bank APIs (Qonto, Ponto, Revolut) checked with zod at
 * the edge (KLEDG-R3-QUAL-28): a provider that changes its format fails
 * with a clear French error naming the provider, the detail in the log,
 * instead of a wrong or missing field further down (an amount read as
 * undefined, a side read as a credit). Schemas are loose: they check the
 * fields Kledg reads and let the others through.
 */

import type { z } from 'zod'
import { ExternalServiceError } from '@/lib/accounting/errors'
import { logger } from '@/lib/logger'

export function parseProviderResponse<T>(provider: string, operation: string, schema: z.ZodType, body: unknown): T {
  const parsed = schema.safeParse(body)
  if (parsed.success) return parsed.data as T
  logger.error('[bank] Unexpected provider response', {
    provider,
    operation,
    issues: parsed.error.issues.slice(0, 5).map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  })
  throw new ExternalServiceError(`Réponse inattendue de ${provider} : la synchronisation est interrompue, réessayez plus tard. Si le problème persiste, signalez-le.`)
}
