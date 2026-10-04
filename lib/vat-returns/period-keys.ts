/**
 * Keys of the VAT return periods, as the deadline calendar keys its VAT
 * deadlines: "2026-09" (CA3 of a month), "2026-T3" (CA3 of a quarter),
 * "2026" (CA12 of a year). Pure, no imports: the Échéances page links each
 * VAT deadline to its return with periodKeyOfDeadline.
 */

export const PERIOD_KEY_PATTERN = /^(\d{4})(?:-(0[1-9]|1[0-2])|-T([1-4]))?$/

/** The kind and numbers of a period key, null when it is not one. */
export function parsePeriodKey(key: string): { year: number; month?: number; quarter?: number } | null {
  const match = PERIOD_KEY_PATTERN.exec(key)
  if (!match) return null
  const year = Number(match[1])
  if (match[2]) return { year, month: Number(match[2]) }
  if (match[3]) return { year, quarter: Number(match[3]) }
  return { year }
}

/**
 * The period a VAT deadline of the calendar prepares ("tva-ca3:2026-09" ->
 * "2026-09"). An acompte of the réel simplifié is computed on the CA12 of
 * the year before (line 57, CGI art. 287, 3): July 2026 -> "2025". Null for
 * any other deadline.
 */
export function periodKeyOfDeadline(deadline: { ruleId: string; id: string }): string | null {
  const key = deadline.id.slice(deadline.id.indexOf(':') + 1)
  if (deadline.ruleId === 'tva-ca3' || deadline.ruleId === 'tva-ca12') return parsePeriodKey(key) ? key : null
  if (deadline.ruleId === 'tva-acompte') return parsePeriodKey(key) ? String(Number(key.slice(0, 4)) - 1) : null
  return null
}
