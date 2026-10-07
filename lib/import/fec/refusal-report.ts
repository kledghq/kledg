/**
 * Refused FEC entries as a readable report: one message per distinct
 * reason, with how many entries it concerns and the first line numbers, so
 * a file with 558 entries refused for the same reason reads as one line, not
 * 558. Pure, no imports beyond the plural helper.
 */

import { plural } from '@/lib/utils/plural'
import type { RefusedFecEntry } from './types'

/** Line numbers shown per reason before "et N autres". */
const REFUSAL_SAMPLE_LINES = 5

/**
 * "Écriture VT n° 12 (ligne 40) : <reason>" for a reason met once,
 * "<reason> : 558 écritures (lignes 2, 5, 8, 11, 14 et 553 autres)" for a
 * repeated one. Reasons keep the order of their first line.
 */
export function groupRefusals(refused: RefusedFecEntry[], sample = REFUSAL_SAMPLE_LINES): string[] {
  const byReason = new Map<string, RefusedFecEntry[]>()
  for (const entry of [...refused].sort((a, b) => a.line - b.line)) {
    const list = byReason.get(entry.reason)
    if (list) list.push(entry)
    else byReason.set(entry.reason, [entry])
  }
  return [...byReason.entries()].map(([reason, entries]) => {
    if (entries.length === 1) return `Écriture ${entries[0].entry} (ligne ${entries[0].line}) : ${reason}`
    const lines = entries.slice(0, sample).map((e) => e.line)
    const rest = entries.length - lines.length
    const where = `lignes ${lines.join(', ')}${rest > 0 ? ` et ${plural(rest, 'autre')}` : ''}`
    return `${reason} : ${plural(entries.length, 'écriture')} (${where})`
  })
}
