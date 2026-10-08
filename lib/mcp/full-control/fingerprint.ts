/**
 * The state a high-impact action acts on, bound to its approval
 * (finding KLEDG-R3-MCP-01).
 *
 * The arguments of most high-impact tools are ids (entryIds, invoiceId,
 * ruleId...), while the rows behind them stay editable by direct tools
 * (update_draft_entry, update_draft_invoice, update_rule...). Binding the
 * approval to the arguments only would let an assistant rewrite an approved
 * draft before executing the action. So, in validation mode, define.ts
 * stores a fingerprint of what the user approved when the action is
 * prepared: the dry run (with the values that move on their own removed,
 * like the indicative numbers) and the rows the tool targets (`targetState`
 * of the tool: references to entries, invoices, rules..., read by
 * lib/approved-state/targets.ts). At execution it is checked twice:
 * - right after the approved action is claimed, the whole fingerprint is
 *   computed again (dry run included) and compared;
 * - then the service runs inside runWithApprovedState
 *   (lib/approved-state/guard.ts) and checks each target again inside its
 *   own transaction, under a lock of the rows, so an edit landing between
 *   the first check and the service's write is refused as well.
 */

import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { loadTargetState, normalizeState, targetKey, type TargetRef, type TargetTable } from '@/lib/approved-state/targets'
import { canonicalJson } from './canonical-json'

export { STATE_CHANGED_MESSAGE } from '@/lib/approved-state/guard'

/** Keys of a dry run that change without any edit of the data (indicative numbers, notes). */
const VOLATILE_PREVIEW_KEYS = new Set(['numberToAssign', 'note'])

function withoutVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutVolatile)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !VOLATILE_PREVIEW_KEYS.has(key))
      .map(([key, v]) => [key, withoutVolatile(v)]),
  )
}

export interface TargetSnapshot {
  ref: TargetRef
  state: unknown
}

/** The current state of each target (read without lock, outside any transaction). */
export async function readTargets(refs: TargetRef[]): Promise<TargetSnapshot[]> {
  const unique = new Map(refs.map((ref) => [targetKey(ref), ref]))
  const snapshots: TargetSnapshot[] = []
  for (const ref of unique.values()) snapshots.push({ ref, state: await loadTargetState(prisma, ref) })
  return snapshots
}

/** SHA-256 of a dry run and of the rows the action targets. */
export function stateFingerprint(preview: unknown, targets: TargetSnapshot[]): string {
  const target = Object.fromEntries(targets.map(({ ref, state }) => [targetKey(ref), normalizeState(state)]))
  const state = { preview: withoutVolatile(normalizeState(preview)), target }
  return createHash('sha256').update(canonicalJson(state)).digest('hex')
}

/** References to entries of the company. */
export const entryTargets = (companyId: string, ids: string[]): TargetRef[] => [...new Set(ids)].map((id) => ({ kind: 'entry', companyId, id }))

/** Reference to an invoice of the company. */
export const invoiceTarget = (companyId: string, id: string): TargetRef[] => [{ kind: 'invoice', companyId, id }]

/** Reference to an expense report of the company. */
export const expenseReportTarget = (companyId: string, id: string): TargetRef[] => [{ kind: 'expenseReport', companyId, id }]

/** Reference to one rule, or to every rule of the company. */
export const ruleTargets = (companyId: string, ruleId?: string): TargetRef[] =>
  ruleId ? [{ kind: 'rule', companyId, id: ruleId }] : [{ kind: 'rules', companyId }]

/**
 * The company, locked to serialize (its content is not approved): every
 * action whose targets are generic rows starts with it, so two approved
 * actions of one company never interleave, and an action that creates rows
 * (an import, a closing) holds a stable parent row.
 */
export const companyLock = (companyId: string): TargetRef => ({ kind: 'lock', table: 'companies', companyId, id: companyId })

/** Rows of `table` named by the arguments, their content approved (none when the argument is absent). */
export const rowTargets = (table: TargetTable, companyId: string, ids: Array<string | null | undefined> | string | null | undefined): TargetRef[] =>
  [...new Set((Array.isArray(ids) ? ids : [ids]).filter((id): id is string => typeof id === 'string' && id.length > 0))].map((id) => ({ kind: 'row', table, companyId, id }))

/** A fiscal year and every entry of it (a closing, the depreciation, the allocation of the result read them all). */
export const fiscalYearTargets = (companyId: string, fiscalYearId: string | null | undefined): TargetRef[] =>
  fiscalYearId
    ? [...rowTargets('fiscal_years', companyId, fiscalYearId), { kind: 'children', table: 'accounting_entries', companyId, column: 'fiscalYearId', id: fiscalYearId }]
    : []
