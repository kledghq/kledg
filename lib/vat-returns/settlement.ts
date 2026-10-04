/**
 * The settlement entry of a VAT return ("écriture de liquidation"), on plain
 * values: it clears the VAT accounts of the period and books what the
 * return declares, PCG art. 944-44 (4455 "Taxes sur le chiffre d'affaires à
 * décaisser", 44567 "Crédit de TVA à reporter"):
 * - debit of the collected VAT (4457x except 44574) and of the
 *   self-assessed VAT (4452) of the period, credit of the deductible VAT
 *   (44562, 44566, 44563) of the period, each account by its own net
 *   movement, so the period's accounts end at zero;
 * - credit of 44567 by the credit carried forward the return uses (CA3
 *   line 22, CA12 line 24), and, on a CA12, credit of 44581 by the
 *   acomptes paid (line 30);
 * - the result: credit of 44551 "TVA à décaisser" by the amount due on the
 *   form (CA3 line 28, CA12 line 33), or debit of 44567 by the credit to
 *   carry (CA3 line 27, CA12 line 35);
 * - the form rounds every line to the euro: the difference with the books
 *   goes to 658 "Pénalités et autres charges" or 758 "Indemnités et autres
 *   produits" (PCG 2025 accounts of other operating charges and income).
 * Lines the user fills by hand (refunds, taxes assimilées, regularisations
 * of earlier returns) are not in the books of the period and not in this
 * entry. Pure; settle-vat-return.service.ts books it as a draft.
 */

import type { VatPeriod } from './periods'

export interface SettlementLine {
  code: string
  label: string
  debitCents: number
  creditCents: number
}

export interface SettlementInput {
  period: Pick<VatPeriod, 'id' | 'form' | 'label'>
  /** Net movements of the period by account code (debit minus credit), settlement entries left out. */
  periodNetByCode: Map<string, number>
  /** Credit carried forward the return uses, and the 44567 account it sits on. */
  creditCarried: { cents: number; code: string }
  /** CA12: acomptes paid (debits of 44581) and their account. */
  acomptes: { cents: number; code: string } | null
  /** What the form declares, whole euros: due (CA3 28, CA12 33) or credit (CA3 27, CA12 35). */
  dueEuros: number
  creditEuros: number
}

export const SETTLEMENT_ACCOUNTS = {
  toPay: { code: '44551', label: 'TVA à décaisser' },
  credit: { code: '44567', label: 'Crédit de TVA à reporter' },
  roundingCharge: { code: '658', label: 'Pénalités et autres charges' },
  roundingIncome: { code: '758', label: 'Indemnités et autres produits' },
} as const

const LABELS: Array<[string, string]> = [
  ['44574', 'TVA collectée en attente d’encaissement'],
  ['4457', 'TVA collectée'],
  ['4452', 'TVA due intracommunautaire'],
  ['44562', 'TVA sur immobilisations'],
  ['44563', 'TVA transférée par d’autres entités'],
  ['44566', 'TVA sur autres biens et services'],
  ['4456', 'Taxes sur le chiffre d’affaires déductibles'],
]

const labelOf = (code: string) => LABELS.find(([root]) => code.startsWith(root))?.[1] ?? `Compte ${code}`

/** Accounts the settlement clears by their period movement. */
export const isSettledCode = (code: string) =>
  (code.startsWith('4457') && !code.startsWith('44574') && !code.startsWith('44578')) ||
  code.startsWith('4452') ||
  code.startsWith('44562') ||
  code.startsWith('44563') ||
  code.startsWith('44566') ||
  code === '4456'

/** "TVA-CA3-2026-09", "TVA-CA12-2026": the reference that makes the preparation idempotent. */
export function settlementReference(period: Pick<VatPeriod, 'id' | 'form'>): string {
  return `TVA-${period.form}-${period.id}`
}

export function settlementDescription(period: Pick<VatPeriod, 'form' | 'label'>): string {
  return `Liquidation de la TVA, ${period.form} ${period.label}`
}

export function planSettlement(input: SettlementInput): SettlementLine[] {
  const lines: SettlementLine[] = []
  const codes = [...input.periodNetByCode.keys()].filter(isSettledCode).sort()
  for (const code of codes) {
    const net = input.periodNetByCode.get(code) ?? 0
    if (net === 0) continue
    // A credit balance is cleared by a debit and the other way round.
    lines.push(net < 0 ? { code, label: labelOf(code), debitCents: -net, creditCents: 0 } : { code, label: labelOf(code), debitCents: 0, creditCents: net })
  }
  if (input.creditCarried.cents > 0) {
    lines.push({ code: input.creditCarried.code, label: SETTLEMENT_ACCOUNTS.credit.label, debitCents: 0, creditCents: input.creditCarried.cents })
  }
  if (input.acomptes && input.acomptes.cents > 0) {
    lines.push({ code: input.acomptes.code, label: 'Acomptes, régime simplifié d’imposition', debitCents: 0, creditCents: input.acomptes.cents })
  }

  if (input.dueEuros > 0) {
    lines.push({ ...SETTLEMENT_ACCOUNTS.toPay, debitCents: 0, creditCents: input.dueEuros * 100 })
  } else if (input.creditEuros > 0) {
    lines.push({ code: input.creditCarried.code, label: SETTLEMENT_ACCOUNTS.credit.label, debitCents: input.creditEuros * 100, creditCents: 0 })
  }
  // What remains is the rounding of the form to the euro.
  const difference = lines.reduce((s, l) => s + l.debitCents - l.creditCents, 0)
  if (difference > 0) lines.push({ ...SETTLEMENT_ACCOUNTS.roundingIncome, debitCents: 0, creditCents: difference })
  else if (difference < 0) lines.push({ ...SETTLEMENT_ACCOUNTS.roundingCharge, debitCents: -difference, creditCents: 0 })
  return netByAccount(lines)
}

/** One line per account: the credit used and the credit carried on 44567 net into one movement; zero lines dropped. */
export function netByAccount(lines: SettlementLine[]): SettlementLine[] {
  const out: SettlementLine[] = []
  for (const line of lines) {
    const same = out.find((l) => l.code === line.code)
    if (!same) {
      out.push({ ...line })
      continue
    }
    const net = same.debitCents - same.creditCents + line.debitCents - line.creditCents
    same.debitCents = Math.max(net, 0)
    same.creditCents = Math.max(-net, 0)
  }
  return out.filter((l) => l.debitCents !== 0 || l.creditCents !== 0)
}

/** Accounts the plan names by their PCG root; the chart of a fiscal year may hold them as 445510, 445670... */
export const SETTLEMENT_ROOTS: readonly string[] = ['44551', '44567', '44581', '658', '758']

/**
 * The account of the chart to use for a root: the root itself, else the
 * root padded with zeros to six digits, else the first account below it
 * (shortest code first), as invoices resolve theirs
 * (lib/invoices/ledger-accounts.ts); the root when the chart has none (the
 * service creates it).
 */
export function resolveRootCode(root: string, chart: readonly string[]): string {
  if (chart.includes(root)) return root
  const padded = root.padEnd(6, '0')
  if (chart.includes(padded)) return padded
  const below = chart.filter((code) => code.startsWith(root)).sort((a, b) => a.length - b.length || a.localeCompare(b))
  return below[0] ?? root
}

/** Same lines, whatever their order: a draft that already says this is kept. */
export function sameLines(a: SettlementLine[], b: Array<Pick<SettlementLine, 'code' | 'debitCents' | 'creditCents'>>): boolean {
  const key = (l: Pick<SettlementLine, 'code' | 'debitCents' | 'creditCents'>) => `${l.code}|${l.debitCents}|${l.creditCents}`
  const left = a.map(key).sort()
  const right = b.map(key).sort()
  return left.length === right.length && left.every((k, i) => k === right[i])
}
