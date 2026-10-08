/**
 * Statement layouts read back from the database (line configurations and
 * saved templates, a JSON column) checked with zod before they reach the
 * statement engine (KLEDG-R3-QUAL-28): a damaged layout is a clear French
 * error, logged, instead of lines silently missing from the bilan or the
 * compte de résultat. Loose objects: the fields the engine reads are
 * checked, the others pass through.
 */

import { z } from 'zod'
import { ConflictError } from '@/lib/accounting/errors'
import { logger } from '@/lib/logger'

const codes = z.array(z.string())

/** A line of a layout with its nested children. */
const StatementLineSchema: z.ZodType = z.looseObject({
  id: z.string(),
  parentId: z.string().nullish(),
  section: z.string().nullish(),
  lineLabel: z.string(),
  lineType: z.string().nullish(),
  formCode: z.string().nullish(),
  accountCodes: codes,
  excludedAccountCodes: codes.nullish(),
  amortissementAccountCodes: codes.nullish(),
  filterType: z.string().nullish(),
  balanceType: z.string(),
  displayType: z.string().nullish(),
  order: z.number(),
  children: z.lazy(() => z.array(StatementLineSchema)).optional(),
})

const StatementLinesSchema = z.array(StatementLineSchema)

/** A saved template: its variant and its lines. */
const TemplateConfigSchema = z.looseObject({
  reportVariant: z.enum(['complete', 'simplified']),
  lines: StatementLinesSchema,
})

const LAYOUT_DAMAGED = (what: string) =>
  `La mise en page ${what} est illisible : rétablissez la mise en page par défaut dans la personnalisation des états.`

function parseOrThrow<T>(schema: z.ZodType, value: unknown, what: string, context: Record<string, unknown>): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data as T
  logger.error('[reports] Damaged statement layout', {
    ...context,
    issues: parsed.error.issues.slice(0, 5).map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  })
  throw new ConflictError(LAYOUT_DAMAGED(what))
}

/** The lines of a statement layout as the engine's rules (`what`: "du bilan", "du compte de résultat"). */
export function parseStatementRules<T>(lines: unknown, what: string, context: Record<string, unknown> = {}): T[] {
  return parseOrThrow<T[]>(StatementLinesSchema, lines, what, context)
}

/** The configuration a saved template holds (JSON column). */
export function parseTemplateConfig<T>(value: unknown, context: Record<string, unknown> = {}): T {
  return parseOrThrow<T>(TemplateConfigSchema, value, 'du modèle', context)
}
