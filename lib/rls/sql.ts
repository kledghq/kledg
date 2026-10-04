/**
 * The SQL that hands a row level security context to PostgreSQL (docs/rls.md).
 * Pure: no database access, testable on plain values.
 */

import type { RlsContext } from './context'

/** Escapes a value as a SQL string literal (node-postgres' Client#escapeLiteral). */
export type EscapeLiteral = (value: string) => string

/** PostgreSQL text array literal of `ids`, read back by kledg_rls_scope(): `{"a","b"}`. */
export function textArrayLiteral(ids: readonly string[]): string {
  return `{${ids.map((id) => `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`
}

/**
 * The transaction settings of a context. Every key is always set (empty when
 * unused), so nothing of an earlier transaction on the same server
 * connection can remain.
 */
export function contextSettings(context: RlsContext | undefined): Record<string, string> {
  if (!context) return { 'kledg.access': '', 'kledg.user_id': '', 'kledg.company_scope': '', 'kledg.reason': '' }
  switch (context.access) {
    case 'user':
      return {
        'kledg.access': 'user',
        'kledg.user_id': context.userId,
        'kledg.company_scope': context.companyIds ? textArrayLiteral(context.companyIds) : '',
        'kledg.reason': '',
      }
    case 'system':
      return {
        'kledg.access': 'system',
        'kledg.user_id': '',
        'kledg.company_scope': context.companyIds ? textArrayLiteral(context.companyIds) : '',
        'kledg.reason': context.reason,
      }
    case 'anonymous':
      return { 'kledg.access': 'anonymous', 'kledg.user_id': '', 'kledg.company_scope': '', 'kledg.reason': '' }
  }
}

/** `SELECT set_config(..., true), ...`: transaction scoped, safe behind PgBouncer in transaction mode. */
export function setContextSql(context: RlsContext | undefined, escapeLiteral: EscapeLiteral): string {
  const calls = Object.entries(contextSettings(context)).map(
    ([name, value]) => `set_config(${escapeLiteral(name)}, ${escapeLiteral(value)}, true)`,
  )
  return `SELECT ${calls.join(', ')}`
}

/** `BEGIN` (with an isolation level when the transaction asked for one) and the context, in one round trip. */
export function beginWithContextSql(
  context: RlsContext | undefined,
  escapeLiteral: EscapeLiteral,
  isolationLevel?: string,
): string {
  return `${isolationLevel ? `BEGIN ISOLATION LEVEL ${isolationLevel}` : 'BEGIN'}; ${setContextSql(context, escapeLiteral)}`
}

const ISOLATION = /^\s*SET\s+TRANSACTION\s+ISOLATION\s+LEVEL\s+(READ\s+UNCOMMITTED|READ\s+COMMITTED|REPEATABLE\s+READ|SERIALIZABLE)\s*;?\s*$/i

/** The isolation level of a `SET TRANSACTION ISOLATION LEVEL ...` statement (Prisma sends it right after BEGIN). */
export function isolationLevelOf(sql: string): string | undefined {
  const match = ISOLATION.exec(sql)
  return match ? match[1].toUpperCase().replace(/\s+/g, ' ') : undefined
}

const WRITE = /^\s*(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|COPY)\b/i
const WITH_WRITE = /^\s*WITH\b[\s\S]*\b(?:INSERT\s+INTO|UPDATE\s+"?\w+|DELETE\s+FROM|MERGE\s+INTO)\b/i

/**
 * Whether a statement writes rows. Used to refuse writes without a context
 * (reads then return no row through the policies). Prisma's statements
 * start with their verb; a CTE is a write when it contains one.
 */
export function isWriteStatement(sql: string): boolean {
  return WRITE.test(sql) || WITH_WRITE.test(sql)
}

export type TransactionControl = 'begin' | 'commit' | 'rollback'

/** BEGIN, COMMIT and ROLLBACK as Prisma's adapter sends them. */
export function transactionControlOf(sql: string): TransactionControl | undefined {
  const normalized = sql.trim().replace(/;$/, '').trim().toUpperCase()
  if (normalized === 'BEGIN' || normalized === 'START TRANSACTION') return 'begin'
  if (normalized === 'COMMIT' || normalized === 'END') return 'commit'
  if (normalized === 'ROLLBACK') return 'rollback'
  return undefined
}
