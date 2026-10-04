/**
 * Selection of the lettering screen, on plain values: which lines are
 * selected, their totals and whether they can be lettered, with the same
 * rules as the server (lib/lettering/rules.ts checkSelection).
 */

import { checkSelection, type SelectionCheck } from '@/lib/lettering/rules'

export interface SelectionLine {
  id: string
  debitCents: number
  creditCents: number
  auxiliaryAccountNumber: string | null
  letteringCode: string | null
}

export interface SelectionSummary extends SelectionCheck {
  count: number
  /** The selection can be sent to the server. */
  canLetter: boolean
}

/** The selected lines that still exist (a reload may have removed some), in list order. */
export function selectedLines<T extends SelectionLine>(lines: readonly T[], selected: ReadonlySet<string>): T[] {
  return lines.filter((line) => selected.has(line.id))
}

export function summarizeSelection(lines: readonly SelectionLine[], selected: ReadonlySet<string>): SelectionSummary {
  const chosen = selectedLines(lines, selected)
  const check = checkSelection(chosen)
  return { ...check, count: chosen.length, canLetter: chosen.length >= 2 && check.errors.length === 0 }
}

/** Adds or removes one line. */
export function toggleLine(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** Lines that can be selected: not lettered yet. */
export function selectableIds(lines: readonly SelectionLine[]): string[] {
  return lines.filter((line) => !line.letteringCode).map((line) => line.id)
}

/** Selects every selectable line, or none when they all are already selected. */
export function toggleAll(lines: readonly SelectionLine[], selected: ReadonlySet<string>): Set<string> {
  const ids = selectableIds(lines)
  return ids.length > 0 && ids.every((id) => selected.has(id)) ? new Set() : new Set(ids)
}
