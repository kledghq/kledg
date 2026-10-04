import { fromCents, toCents } from '@/lib/utils/money'

/** Amounts as the account ledger API returns them (euros, number or decimal string). */
interface LedgerLine {
  debit: number | string
  credit: number | string
}

/**
 * Running balance (debit minus credit) after each line, computed in cents so
 * long ledgers do not drift ("0,30 €" never becomes 0,30000000000000004).
 * Lines are expected oldest first, as the API returns them.
 */
export function runningBalances(lines: LedgerLine[]): number[] {
  let cents = 0
  return lines.map((line) => {
    cents += (toCents(line.debit) ?? 0) - (toCents(line.credit) ?? 0)
    return fromCents(cents)
  })
}

export type BalanceSide = 'debit' | 'credit' | 'zero'

/** Side of a balance computed as debit minus credit. */
export function balanceSide(balance: number): BalanceSide {
  const cents = toCents(balance) ?? 0
  if (cents > 0) return 'debit'
  if (cents < 0) return 'credit'
  return 'zero'
}

/**
 * "Solde débiteur" when debits exceed credits (a bank account holding money,
 * a customer who owes you), "Solde créditeur" otherwise (PCG vocabulary).
 */
export const BALANCE_SIDE_LABELS: Record<BalanceSide, string> = {
  debit: 'Solde débiteur',
  credit: 'Solde créditeur',
  zero: 'Solde nul',
}
