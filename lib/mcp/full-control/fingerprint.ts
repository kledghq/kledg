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
 * of the tool: entries with their lines, invoices with their lines, rules
 * with their conditions...). At execution it computes the fingerprint
 * again and refuses the action when it differs.
 *
 * The check runs right before the execution, once the approved action is
 * claimed (an action refused here cannot be executed again).
 */

import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { canonicalJson } from './canonical-json'

/** Keys of a dry run that change without any edit of the data (indicative numbers, notes). */
const VOLATILE_PREVIEW_KEYS = new Set(['numberToAssign', 'note'])

export const STATE_CHANGED_MESSAGE =
  "Les données ont changé depuis l'approbation : l'action n'a pas été exécutée. Préparez une nouvelle action (appel sans actionId) et faites-la approuver de nouveau."

/** JSON as stored (Decimal, Date and other toJSON values serialized the same way). */
function normalize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null))
}

function withoutVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutVolatile)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !VOLATILE_PREVIEW_KEYS.has(key))
      .map(([key, v]) => [key, withoutVolatile(v)]),
  )
}

/** SHA-256 of a dry run and of the rows the action targets. */
export function stateFingerprint(preview: unknown, target: unknown): string {
  const state = { preview: withoutVolatile(normalize(preview)), target: normalize(target) }
  return createHash('sha256').update(canonicalJson(state)).digest('hex')
}

/** Entries of the company among `ids`, every column with their lines (lines replaced by an edit get new ids). */
export function entriesState(companyId: string, ids: string[]) {
  return prisma.accountingEntry.findMany({
    where: { id: { in: [...new Set(ids)] }, companyId },
    include: { lines: { orderBy: { id: 'asc' } } },
    orderBy: { id: 'asc' },
  })
}

/** An invoice of the company, every column with its lines, VAT breakdown and payments. */
export function invoiceState(companyId: string, invoiceId: string) {
  return prisma.invoice.findFirst({
    where: { id: invoiceId, companyId },
    include: { lines: { orderBy: { id: 'asc' } }, vatBreakdown: { orderBy: { id: 'asc' } }, payments: { orderBy: { id: 'asc' } } },
  })
}

/** Assignment rules of the company (one, or all of them), with their conditions and entry lines. */
export function rulesState(companyId: string, ruleId?: string) {
  return prisma.transactionRule.findMany({
    where: { companyId, ...(ruleId && { id: ruleId }) },
    include: { conditions: { orderBy: { id: 'asc' } }, entryLines: { orderBy: { id: 'asc' } } },
    orderBy: { id: 'asc' },
  })
}

/** An expense report of the company, every column with its lines. */
export function expenseReportState(companyId: string, reportId: string) {
  return prisma.expenseReport.findFirst({
    where: { id: reportId, companyId },
    include: { lines: { orderBy: { id: 'asc' } } },
  })
}
