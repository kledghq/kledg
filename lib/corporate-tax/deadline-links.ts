/**
 * Links between the deadline calendar (lib/deadlines) and the impôt sur les
 * sociétés worksheet. Pure, no imports: the calendar page uses it on the
 * client.
 *
 * Deadline ids are built by the engine: "is-acompte:<end of the exercice
 * paying it>:<n>", "is-solde:<end of the exercice>", "liasse:<end of the
 * exercice>". The acomptes of an exercice are computed on the worksheet of
 * the exercice before it; the solde and the liasse on the exercice itself.
 */

export type CorporateTaxDeadlineTarget =
  | { kind: 'acompte'; exerciceEnd: string; number: number }
  | { kind: 'solde' | 'liasse'; exerciceEnd: string }

export const CORPORATE_TAX_DEADLINE_PATTERN = /^(is-acompte|is-solde|liasse):(\d{4}-\d{2}-\d{2})(?::(\d))?$/

export function corporateTaxDeadlineTarget(deadlineId: string): CorporateTaxDeadlineTarget | null {
  const match = CORPORATE_TAX_DEADLINE_PATTERN.exec(deadlineId)
  if (!match) return null
  const [, rule, end, n] = match
  if (rule === 'is-acompte') return n ? { kind: 'acompte', exerciceEnd: end, number: Number(n) } : null
  if (n) return null
  return { kind: rule === 'is-solde' ? 'solde' : 'liasse', exerciceEnd: end }
}

/** The page of the worksheet a calendar deadline opens, null for a deadline of another tax. */
export function corporateTaxPageOf(deadline: { id: string; ruleId: string }): string | null {
  if (deadline.ruleId !== 'is-acompte' && deadline.ruleId !== 'is-solde' && deadline.ruleId !== 'liasse') return null
  if (!corporateTaxDeadlineTarget(deadline.id)) return null
  return `impot-societes?echeance=${encodeURIComponent(deadline.id)}`
}
