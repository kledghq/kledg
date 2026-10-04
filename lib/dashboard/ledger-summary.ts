/**
 * Indicators of the dashboard computed from the account totals of a fiscal
 * year, in cents. Pure: the same totals feed the income statement and the
 * balance sheet (lib/reports/statements/load.ts, closing entries excluded),
 * so the indicators match them to the cent.
 *
 * Accounts are matched by the prefix of their number (PCG, art. 932-1: the
 * first digit is the class, the following digits subdivide it).
 */

import type { AccountTotals } from '@/lib/reports/statements/allocation'

/** Debit minus credit of the accounts whose number starts with one of `prefixes`. */
function debitBalance(accounts: readonly AccountTotals[], prefixes: readonly string[]): number {
  let cents = 0
  for (const a of accounts) {
    if (prefixes.some((p) => a.code.startsWith(p))) cents += a.debitCents - a.creditCents
  }
  return cents
}

const creditBalance = (accounts: readonly AccountTotals[], prefixes: readonly string[]) => -debitBalance(accounts, prefixes)

function hasMovement(accounts: readonly AccountTotals[], prefixes: readonly string[]): boolean {
  return accounts.some((a) => prefixes.some((p) => a.code.startsWith(p)) && (a.debitCents !== 0 || a.creditCents !== 0))
}

/**
 * Charges by post, class 6 subdivisions 60 to 65 (PCG, list of accounts:
 * 60 Achats, 61 Services extérieurs, 62 Autres services extérieurs, 63
 * Impôts, taxes et versements assimilés, 64 Charges de personnel, 65 Autres
 * charges de gestion courante). Labels as in lib/accounting/pcg-data.ts.
 */
export const EXPENSE_POSTS = [
  { code: '60', label: 'Achats' },
  { code: '61', label: 'Services extérieurs' },
  { code: '62', label: 'Autres services extérieurs' },
  { code: '63', label: 'Impôts, taxes et versements assimilés' },
  { code: '64', label: 'Charges de personnel' },
  { code: '65', label: 'Autres charges de gestion courante' },
] as const

/**
 * Marge commerciale as the cerfa 2052 (compte de résultat, régime réel
 * normal) defines it: ventes de marchandises (line FC: 707, less the rebates
 * granted 7097) minus the cost of the goods sold (line FS achats de
 * marchandises: 607 and the related costs 6087, less the rebates obtained
 * 6097; line FT variation de stock de marchandises: 6037).
 */
const MERCHANDISE_SALES = ['707', '7097']
const MERCHANDISE_COST = ['607', '6087', '6097', '6037']

export interface LedgerSummary {
  /** Class 7, credit minus debit (PCG art. 821-1: produits). */
  produitsCents: number
  /** Class 6, debit minus credit (PCG art. 821-1: charges). */
  chargesCents: number
  /** Produits minus charges: the result of the income statement. */
  resultatCents: number
  /** Comptes 70 only (ventes de produits fabriqués, prestations de services, marchandises), credit minus debit. */
  chiffreAffairesCents: number
  /** Null when the fiscal year has no merchandise sale or purchase. */
  marge: { ventesCents: number; coutCents: number; margeCents: number } | null
  /**
   * Comptes 445 (État, taxes sur le chiffre d'affaires, PCG art. 944-44:
   * 4455 à décaisser, 4456 déductible, 4457 collectée), credit minus debit:
   * positive is VAT to pay (TVA collectée above TVA déductible), negative a
   * credit. An estimate: it reads the ledger, not the return. Null without
   * any 445 movement (companies under the franchise en base).
   */
  tvaCents: number | null
  /** Comptes 411 (clients), debit minus credit. */
  creancesClientsCents: number
  /** Comptes 401 (fournisseurs), credit minus debit. */
  dettesFournisseursCents: number
  /** Comptes 512 (banques), debit minus credit. */
  banqueCents: number
  /** Posts 60 to 65 by amount, largest first, and the rest of class 6 (66 to 69). */
  chargesParPoste: Array<{ code: string; label: string; cents: number }>
  autresChargesCents: number
}

export function summarizeLedger(accounts: readonly AccountTotals[]): LedgerSummary {
  const produitsCents = creditBalance(accounts, ['7'])
  const chargesCents = debitBalance(accounts, ['6'])
  const ventesCents = creditBalance(accounts, MERCHANDISE_SALES)
  const coutCents = debitBalance(accounts, MERCHANDISE_COST)
  const hasMerchandise = hasMovement(accounts, [...MERCHANDISE_SALES, ...MERCHANDISE_COST])
  const chargesParPoste = EXPENSE_POSTS.map((post) => ({ ...post, cents: debitBalance(accounts, [post.code]) })).sort(
    (a, b) => b.cents - a.cents || a.code.localeCompare(b.code),
  )
  const postsCents = chargesParPoste.reduce((sum, post) => sum + post.cents, 0)
  return {
    produitsCents,
    chargesCents,
    resultatCents: produitsCents - chargesCents,
    chiffreAffairesCents: creditBalance(accounts, ['70']),
    marge: hasMerchandise ? { ventesCents, coutCents, margeCents: ventesCents - coutCents } : null,
    tvaCents: hasMovement(accounts, ['445']) ? creditBalance(accounts, ['445']) : null,
    creancesClientsCents: debitBalance(accounts, ['411']),
    dettesFournisseursCents: creditBalance(accounts, ['401']),
    banqueCents: debitBalance(accounts, ['512']),
    chargesParPoste,
    autresChargesCents: chargesCents - postsCents,
  }
}
