/**
 * Flattens the line trees of the compte de résultat and the bilan into the
 * rows the statement table renders, and drops lines that only show zeros
 * when the user asks for a compact view. Pure: no React, no fetch.
 *
 * A line stays visible when it is a total or an intermediate result (they
 * frame the statement even at zero), when one of its amounts is not zero, or
 * when one of its sub-lines stays visible (its header then keeps the
 * sub-line in context).
 */

/** Value of an amount cell: a number, `null` for "not applicable" (rendered "-"), `undefined` for an empty cell. */
export type StatementValue = number | null | undefined

export type StatementRowKind = 'line' | 'section' | 'total'

export interface StatementRow {
  id: string
  /** Depth in the tree, 0 for top level lines. */
  level: number
  label: string
  hideLabel?: boolean
  formCode?: string | null
  kind: StatementRowKind
  /** Short muted note after the label ("2 comptes"). */
  note?: string
  /** Amounts by column key. */
  values: Record<string, StatementValue>
}

interface TreeLine<T> {
  children?: T[]
}

export interface FlattenOptions<T> {
  toRow: (line: T, level: number) => StatementRow
  /** True when every amount of the line itself is zero (its sub-lines are checked separately). */
  isZero: (line: T) => boolean
  hideZeroLines: boolean
}

export interface FlattenResult {
  rows: StatementRow[]
  /** Lines left out because they only show zeros. */
  hiddenCount: number
}

export function flattenStatementLines<T extends TreeLine<T>>(
  lines: T[],
  { toRow, isZero, hideZeroLines }: FlattenOptions<T>,
): FlattenResult {
  let hiddenCount = 0

  const visit = (line: T, level: number): StatementRow[] => {
    const row = toRow(line, level)
    const children = (line.children ?? []).flatMap((child) => visit(child, level + 1))
    const keep = !hideZeroLines || row.kind === 'total' || !isZero(line) || children.length > 0
    if (!keep) {
      // Its sub-lines were all dropped (and counted) by their own visit.
      hiddenCount += 1
      return []
    }
    return [row, ...children]
  }

  const rows = lines.flatMap((line) => visit(line, 0))
  return { rows, hiddenCount }
}

/** Cents-safe zero test for report amounts given in euros. */
export function isZeroAmount(value: number | null | undefined): boolean {
  return value === null || value === undefined || Math.abs(value) < 0.005
}
