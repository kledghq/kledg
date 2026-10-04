/**
 * Automatic lettering proposals (auto-lettrage) on plain values. Pure module
 * without imports, shared by the lettering service and its tests.
 *
 * Every proposal balances to the cent (debits = credits), so applying it is
 * an ordinary lettering (lib/lettering/rules.ts checkSelection). Three kinds,
 * tried in this order on the unlettered lines of one account:
 *
 * 1. same-third-party: a debit and a credit of the same amount on the same
 *    auxiliary account (an invoice and its payment). When several lines of
 *    that tiers have the amount, the pairs with the closest dates win.
 * 2. same-amount: a debit and a credit of the same amount where one of them
 *    has no auxiliary account (a bank payment booked on the collective
 *    account during reconciliation). Proposed only when the pair is
 *    unambiguous: each line is the only line of that amount the other can
 *    match.
 * 3. third-party-settled: the remaining lines of one auxiliary account sum
 *    to zero (an invoice paid in several instalments), up to MAX_GROUP lines.
 *
 * A proposal says whether one of its lines belongs to an entry reconciled
 * with a bank transaction: those come first, they are the payments the bank
 * confirmed.
 */

export interface MatchableLine {
  id: string
  /** Entry date, yyyy-mm-dd. */
  date: string
  debitCents: number
  creditCents: number
  auxiliaryAccountNumber: string | null
  /** The entry is reconciled with a bank transaction. */
  reconciled?: boolean
}

export type SuggestionReason = 'same-third-party' | 'same-amount' | 'third-party-settled'

export interface LetteringSuggestion {
  lineIds: string[]
  /** Total of the debits (equal to the credits). */
  amountCents: number
  auxiliaryAccountNumber: string | null
  reason: SuggestionReason
  /** One of the lines belongs to an entry reconciled with a bank transaction. */
  fromReconciliation: boolean
}

/** Lines of one tiers lettered together at most by a third-party-settled proposal. */
export const MAX_GROUP = 30

const auxOf = (line: MatchableLine) => line.auxiliaryAccountNumber?.trim() || null
const netOf = (line: MatchableLine) => line.debitCents - line.creditCents
const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000
const byDateThenId = (a: MatchableLine, b: MatchableLine) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function suggestion(lines: MatchableLine[], reason: SuggestionReason): LetteringSuggestion {
  return {
    lineIds: lines.map((line) => line.id),
    amountCents: lines.reduce((sum, line) => sum + line.debitCents, 0),
    auxiliaryAccountNumber: lines.map(auxOf).find((aux) => aux !== null) ?? null,
    reason,
    fromReconciliation: lines.some((line) => line.reconciled === true),
  }
}

/** Proposals for the unlettered lines of one account (see the module header). */
export function suggestLettering(lines: readonly MatchableLine[]): LetteringSuggestion[] {
  const open = [...lines].filter((line) => netOf(line) !== 0).sort(byDateThenId)
  const used = new Set<string>()
  const result: LetteringSuggestion[] = []
  const debits = () => open.filter((line) => !used.has(line.id) && netOf(line) > 0)
  const credits = () => open.filter((line) => !used.has(line.id) && netOf(line) < 0)

  // 1. Same tiers, same amount: of all such pairs, the closest dates first.
  const pairs: Array<{ debit: MatchableLine; credit: MatchableLine; gap: number }> = []
  for (const debit of debits()) {
    const aux = auxOf(debit)
    if (aux === null) continue
    for (const credit of credits()) {
      if (auxOf(credit) === aux && -netOf(credit) === netOf(debit)) {
        pairs.push({ debit, credit, gap: Math.abs(dayNumber(credit.date) - dayNumber(debit.date)) })
      }
    }
  }
  pairs.sort((a, b) => a.gap - b.gap || byDateThenId(a.debit, b.debit) || byDateThenId(a.credit, b.credit))
  for (const { debit, credit } of pairs) {
    if (used.has(debit.id) || used.has(credit.id)) continue
    used.add(debit.id)
    used.add(credit.id)
    result.push(suggestion([debit, credit], 'same-third-party'))
  }

  // 2. Same amount, one side without a tiers: only unambiguous pairs.
  const compatible = (a: MatchableLine, b: MatchableLine) => auxOf(a) === null || auxOf(b) === null || auxOf(a) === auxOf(b)
  const openDebits = debits()
  const openCredits = credits()
  for (const debit of openDebits) {
    const forDebit = openCredits.filter((credit) => !used.has(credit.id) && -netOf(credit) === netOf(debit) && compatible(debit, credit))
    if (forDebit.length !== 1) continue
    const credit = forDebit[0]
    const forCredit = openDebits.filter((other) => !used.has(other.id) && netOf(other) === -netOf(credit) && compatible(other, credit))
    if (forCredit.length !== 1 || forCredit[0].id !== debit.id) continue
    used.add(debit.id)
    used.add(credit.id)
    result.push(suggestion([debit, credit], 'same-amount'))
  }

  // 3. What is left of a tiers sums to zero.
  const byTiers = new Map<string, MatchableLine[]>()
  for (const line of open) {
    const aux = auxOf(line)
    if (aux === null || used.has(line.id)) continue
    const group = byTiers.get(aux)
    if (group) group.push(line)
    else byTiers.set(aux, [line])
  }
  for (const group of byTiers.values()) {
    if (group.length < 2 || group.length > MAX_GROUP) continue
    if (group.reduce((sum, line) => sum + netOf(line), 0) !== 0) continue
    for (const line of group) used.add(line.id)
    result.push(suggestion(group, 'third-party-settled'))
  }

  // Bank-confirmed payments first, then by the date of their first line.
  const firstDate = new Map(open.map((line) => [line.id, line.date]))
  return result.sort(
    (a, b) =>
      Number(b.fromReconciliation) - Number(a.fromReconciliation) ||
      (firstDate.get(a.lineIds[0]) ?? '').localeCompare(firstDate.get(b.lineIds[0]) ?? ''),
  )
}

/** French label of a proposal kind, for the screen and the assistants. */
export const SUGGESTION_LABELS: Record<SuggestionReason, string> = {
  'same-third-party': 'Même tiers, même montant',
  'same-amount': 'Même montant',
  'third-party-settled': 'Tiers soldé',
}
