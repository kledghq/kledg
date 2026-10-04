/**
 * The two entries of a fiscal year closing, computed from account balances.
 * Pure: no database access. Amounts are integer cents.
 *
 * 1. Closing entry (journal CL, last day of the year): every class 6 and 7
 *    account is brought to zero and the difference, the result of the year,
 *    is booked in 120 "Résultat de l'exercice - bénéfice" (credit) or 129
 *    "Résultat de l'exercice - perte" (debit) (PCG art. 941-12, compte 12).
 *    The result stays there until the shareholders decide its allocation
 *    (affectation to accounts 106, 11 or 457).
 * 2. Opening entry (journal AN, first day of the next year): the balance of
 *    every balance sheet account (classes 1 to 5) after the closing entry is
 *    brought forward, so the opening balance sheet of the next year equals
 *    the closing balance sheet of the year (Code de commerce art. L. 123-19:
 *    "le bilan d'ouverture d'un exercice doit correspondre au bilan de
 *    clôture de l'exercice précédent").
 */

export interface ClosingAccountBalance {
  code: string
  label?: string
  debitCents: number
  creditCents: number
}

export interface ClosingLine {
  code: string
  debitCents: number
  creditCents: number
}

export const PROFIT_ACCOUNT = { code: '120', label: "Résultat de l'exercice - bénéfice" } as const
export const LOSS_ACCOUNT = { code: '129', label: "Résultat de l'exercice - perte" } as const

const isIncomeStatementAccount = (code: string) => code.startsWith('6') || code.startsWith('7')
const isBalanceSheetAccount = (code: string) => /^[1-5]/.test(code)

/**
 * Lines of the closing entry: each class 6 and 7 balance reversed, and the
 * result in 120 (profit) or 129 (loss). No lines when classes 6 and 7 are
 * all at zero.
 */
export function computeClosingEntry(balances: ClosingAccountBalance[]): {
  lines: ClosingLine[]
  resultCents: number
} {
  const lines: ClosingLine[] = []
  let resultCents = 0
  for (const b of [...balances].sort((x, y) => x.code.localeCompare(y.code))) {
    if (!isIncomeStatementAccount(b.code)) continue
    const balance = b.debitCents - b.creditCents
    if (balance === 0) continue
    resultCents -= balance
    lines.push(
      balance > 0
        ? { code: b.code, debitCents: 0, creditCents: balance }
        : { code: b.code, debitCents: -balance, creditCents: 0 }
    )
  }
  if (lines.length === 0) return { lines, resultCents: 0 }
  if (resultCents > 0) {
    lines.push({ code: PROFIT_ACCOUNT.code, debitCents: 0, creditCents: resultCents })
  } else if (resultCents < 0) {
    lines.push({ code: LOSS_ACCOUNT.code, debitCents: -resultCents, creditCents: 0 })
  }
  return { lines, resultCents }
}

/** Balances after applying entry lines (by account code). */
export function applyLines(
  balances: ClosingAccountBalance[],
  lines: ClosingLine[]
): ClosingAccountBalance[] {
  const byCode = new Map(balances.map((b) => [b.code, { ...b }]))
  for (const line of lines) {
    const current = byCode.get(line.code) ?? { code: line.code, debitCents: 0, creditCents: 0 }
    current.debitCents += line.debitCents
    current.creditCents += line.creditCents
    byCode.set(line.code, current)
  }
  return [...byCode.values()]
}

/**
 * Lines of the opening entry of the next year from the balances of the year
 * after its closing entry: one line per balance sheet account with a
 * balance, on the side of the balance. Throws when they do not balance
 * (classes 6 and 7 not closed, or an unbalanced ledger).
 */
/** The balance sheet accounts do not balance after closing: the ledger itself is unbalanced. */
export class OpeningEntryImbalanceError extends Error {}

export function computeOpeningEntry(balancesAfterClosing: ClosingAccountBalance[]): ClosingLine[] {
  const lines: ClosingLine[] = []
  let total = 0
  for (const b of [...balancesAfterClosing].sort((x, y) => x.code.localeCompare(y.code))) {
    if (!isBalanceSheetAccount(b.code)) continue
    const balance = b.debitCents - b.creditCents
    if (balance === 0) continue
    total += balance
    lines.push(
      balance > 0
        ? { code: b.code, debitCents: balance, creditCents: 0 }
        : { code: b.code, debitCents: 0, creditCents: -balance }
    )
  }
  if (total !== 0) {
    throw new OpeningEntryImbalanceError(
      `Les soldes des comptes de bilan ne s'équilibrent pas (écart de ${(total / 100).toFixed(2)} €) : l'écriture d'à-nouveaux ne peut pas être générée.`
    )
  }
  return lines
}
