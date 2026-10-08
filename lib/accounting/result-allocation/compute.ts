/**
 * Allocation of the previous year's result (affectation du résultat), as
 * voted by the shareholders. Pure: amounts in cents, no database access.
 *
 * Sources:
 * - Code de commerce art. L. 232-10 (SARL and sociétés par actions: SA,
 *   SAS, SASU, SCA): on the year's profit, less prior losses, at least one
 *   twentieth (5 %) goes to the legal reserve (1061), until the reserve
 *   reaches one tenth of the share capital.
 * - Code de commerce art. L. 232-11: the distributable profit is the
 *   year's profit, less prior losses and the reserves the law or the
 *   articles require, plus the report à nouveau bénéficiaire; dividends
 *   (457 Associés - Dividendes à payer) cannot exceed it.
 * - PCG accounts: 120 / 129 (result), 1061 (réserve légale), 1068 (autres
 *   réserves), 110 / 119 (report à nouveau créditeur / débiteur).
 *
 * A profit goes, in this order, to the legal reserve, the dividends, the
 * other reserves, then to clear a debit report à nouveau (119), the rest to
 * 110. A loss goes to 119.
 */

export interface AllocationBalances {
  /** Result to allocate: credit balance of 120 minus debit balance of 129. */
  resultCents: number
  /** Current legal reserve (credit balance of 1061). */
  legalReserveCents: number
  /** Share capital (credit balance of 101). */
  capitalCents: number
  /** Report à nouveau créditeur (credit balance of 110). */
  retainedEarningsCents: number
  /** Report à nouveau débiteur, prior losses (debit balance of 119). */
  priorLossesCents: number
}

export interface AllocationChoice {
  dividendsCents: number
  otherReservesCents: number
}

export interface AllocationPlan {
  resultCents: number
  /** Whether the legal reserve rule applies (SARL, EURL, SA, SAS, SASU, SCA). */
  legalReserveRequired: boolean
  legalReserveCents: number
  /** Most the shareholders may distribute (L. 232-11). */
  distributableCents: number
  dividendsCents: number
  otherReservesCents: number
  /** Part of the profit that clears prior losses (119). */
  priorLossesClearedCents: number
  /** Rest to report à nouveau: 110 (credit) when positive, 119 (debit) for a loss. */
  retainedEarningsCents: number
  lines: Array<{ code: string; debitCents: number; creditCents: number }>
  errors: string[]
}

/**
 * Legal forms subject to the legal reserve (Code de commerce L. 232-10:
 * SARL and sociétés par actions). SASU is an SAS, EURL an SARL, SELARL and
 * SELAS are SARL and SAS of the liberal professions (loi n° 90-1258).
 */
export function legalReserveApplies(legalType: string | null | undefined): boolean {
  return ['SARL', 'EURL', 'SELARL', 'SA', 'SAS', 'SASU', 'SELAS', 'SCA'].includes(legalType ?? '')
}

/** Legal reserve to set aside: 5 % of the profit less prior losses, up to 10 % of the capital. */
export function legalReserveFor(balances: AllocationBalances): number {
  const base = Math.max(0, balances.resultCents - balances.priorLossesCents)
  const ceiling = Math.max(0, Math.round(balances.capitalCents / 10) - balances.legalReserveCents)
  return Math.min(Math.ceil(base / 20), ceiling)
}

const euros = (cents: number) =>
  `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

export function planAllocation(
  balances: AllocationBalances,
  choice: AllocationChoice,
  options: { legalReserveRequired: boolean }
): AllocationPlan {
  const errors: string[] = []
  const lines: AllocationPlan['lines'] = []
  const plan: AllocationPlan = {
    resultCents: balances.resultCents,
    legalReserveRequired: options.legalReserveRequired,
    legalReserveCents: 0,
    distributableCents: 0,
    dividendsCents: 0,
    otherReservesCents: 0,
    priorLossesClearedCents: 0,
    retainedEarningsCents: 0,
    lines,
    errors,
  }
  if (choice.dividendsCents < 0 || choice.otherReservesCents < 0) {
    errors.push('Les montants affectés ne peuvent pas être négatifs.')
    return plan
  }
  if (balances.resultCents === 0) {
    errors.push("Aucun résultat à affecter : les comptes 120 et 129 sont soldés (le résultat a peut-être déjà été affecté).")
    return plan
  }

  if (balances.resultCents < 0) {
    if (choice.dividendsCents > 0 || choice.otherReservesCents > 0) {
      errors.push('Une perte ne peut pas être distribuée ni mise en réserve : elle est reportée à nouveau (compte 119).')
    }
    const loss = -balances.resultCents
    plan.retainedEarningsCents = balances.resultCents
    lines.push({ code: '119', debitCents: loss, creditCents: 0 }, { code: '129', debitCents: 0, creditCents: loss })
    return plan
  }

  const legal = options.legalReserveRequired ? legalReserveFor(balances) : 0
  const distributable = Math.max(
    0,
    balances.resultCents - balances.priorLossesCents - legal + balances.retainedEarningsCents
  )
  plan.legalReserveCents = legal
  plan.distributableCents = distributable
  plan.dividendsCents = choice.dividendsCents
  plan.otherReservesCents = choice.otherReservesCents

  if (choice.dividendsCents > distributable) {
    errors.push(
      `Les dividendes (${euros(choice.dividendsCents)}) dépassent le bénéfice distribuable (${euros(distributable)}, Code de commerce art. L. 232-11).`
    )
  }
  // This allocation spends the year's profit; dividends taken on the
  // existing report à nouveau come out of 110.
  let rest = balances.resultCents - legal - choice.otherReservesCents
  if (rest < 0) {
    errors.push(
      `Les réserves (${euros(legal + choice.otherReservesCents)}) dépassent le bénéfice de l'exercice (${euros(balances.resultCents)}).`
    )
    return plan
  }
  const fromProfit = Math.min(choice.dividendsCents, rest)
  const fromRetained = choice.dividendsCents - fromProfit
  rest -= fromProfit
  const cleared = Math.min(rest, balances.priorLossesCents)
  rest -= cleared
  plan.priorLossesClearedCents = cleared
  plan.retainedEarningsCents = rest - fromRetained
  if (errors.length > 0) return plan

  lines.push({ code: '120', debitCents: balances.resultCents, creditCents: 0 })
  if (fromRetained > 0) lines.push({ code: '110', debitCents: fromRetained, creditCents: 0 })
  if (legal > 0) lines.push({ code: '1061', debitCents: 0, creditCents: legal })
  if (choice.otherReservesCents > 0) lines.push({ code: '1068', debitCents: 0, creditCents: choice.otherReservesCents })
  if (choice.dividendsCents > 0) lines.push({ code: '457', debitCents: 0, creditCents: choice.dividendsCents })
  if (cleared > 0) lines.push({ code: '119', debitCents: 0, creditCents: cleared })
  if (rest > 0) lines.push({ code: '110', debitCents: 0, creditCents: rest })
  return plan
}
