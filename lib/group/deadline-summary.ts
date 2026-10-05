/**
 * The declarations tracker of every company of a group summed up by kind
 * (Impôts et échéances of the group space, docs/vue-groupe.md). Pure: the
 * statuses come from lib/declarations/status.ts, as on each company's
 * Échéances page.
 *
 * Columns: TVA (CA3, CA12, acomptes), IS (acomptes, solde, liasse), CFE
 * (and CVAE), approval of the accounts (approbation, dépôt des comptes).
 * Other obligations (DAS2) count in "Autres".
 */

import type { DeadlineCategory } from '@/lib/deadlines/types'
import type { DeclarationStatusCode } from '@/lib/declarations/status'

export const DEADLINE_COLUMNS = ['tva', 'is', 'cfe', 'approval', 'other'] as const
export type DeadlineColumn = (typeof DEADLINE_COLUMNS)[number]

export const DEADLINE_COLUMN_LABELS: Record<DeadlineColumn, string> = {
  tva: 'TVA',
  is: 'Impôt sur les sociétés',
  cfe: 'CFE et CVAE',
  approval: 'Approbation des comptes',
  other: 'Autres',
}

/** The column of a deadline, from its rule and category (lib/deadlines/rules.ts). */
export function columnOf(deadline: { ruleId: string; category: DeadlineCategory }): DeadlineColumn {
  if (deadline.ruleId === 'approbation' || deadline.ruleId === 'depot-comptes') return 'approval'
  if (deadline.ruleId === 'das2') return 'other'
  if (deadline.category === 'tva') return 'tva'
  if (deadline.category === 'is' || deadline.category === 'liasse') return 'is'
  if (deadline.category === 'cfe' || deadline.category === 'cvae') return 'cfe'
  return 'other'
}

export interface ColumnSummary {
  total: number
  /** Nothing left to do: filed or paid as asked, or not due. */
  settled: number
  overdue: number
  /** To do and not late yet (filed without the payment counts here). */
  pending: number
  /** The worst status of the column: overdue, then pending, then settled; null without any deadline. */
  status: 'overdue' | 'pending' | 'settled' | null
}

export interface SummarizedDeadline {
  ruleId: string
  category: DeadlineCategory
  status: { status: DeclarationStatusCode; settled: boolean }
}

export function summarizeDeadlines(deadlines: readonly SummarizedDeadline[]): Record<DeadlineColumn, ColumnSummary> {
  const summary = Object.fromEntries(DEADLINE_COLUMNS.map((c) => [c, { total: 0, settled: 0, overdue: 0, pending: 0, status: null }])) as Record<DeadlineColumn, ColumnSummary>
  for (const d of deadlines) {
    const column = summary[columnOf(d)]
    column.total += 1
    if (d.status.settled) column.settled += 1
    else if (d.status.status === 'overdue') column.overdue += 1
    else column.pending += 1
  }
  for (const column of Object.values(summary)) {
    column.status = column.total === 0 ? null : column.overdue > 0 ? 'overdue' : column.pending > 0 ? 'pending' : 'settled'
  }
  return summary
}
