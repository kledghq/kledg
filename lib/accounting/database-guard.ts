/**
 * Errors raised by the database guards on accounting entries (triggers of
 * migration 20261003180000): "KLEDG_IMMUTABLE_ENTRY: <French text>" when a
 * validated entry is changed or deleted, "KLEDG_INVALID_ENTRY: <French text>"
 * when a validation is refused. No imports: used by lib/accounting/errors.ts.
 */

const GUARD_PATTERN = /KLEDG_(IMMUTABLE|INVALID)_ENTRY: ([^\n"]+)/

/** Kind and French message of a database guard (trigger) error, or null. */
export function parseDatabaseGuard(error: unknown): { kind: 'immutable' | 'invalid'; text: string } | null {
  if (!error || typeof error !== 'object') return null
  const sources: string[] = []
  if (error instanceof Error) sources.push(error.message)
  const meta = (error as { meta?: unknown }).meta
  if (meta) sources.push(JSON.stringify(meta))
  const cause = (error as { cause?: unknown }).cause
  if (cause instanceof Error) sources.push(cause.message)
  for (const source of sources) {
    const match = GUARD_PATTERN.exec(source)
    if (match) {
      const kind = match[1] === 'IMMUTABLE' ? 'immutable' : 'invalid'
      const base = match[2].trim()
      const sentence = base.charAt(0).toUpperCase() + base.slice(1)
      return {
        kind,
        text: kind === 'immutable'
          ? `${sentence} (PCG art. 1031-3). Passez une écriture de contre-passation.`
          : `${sentence}.`,
      }
    }
  }
  return null
}
