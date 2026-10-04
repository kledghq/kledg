/**
 * Financial indicators of a fiscal year: SIG and CAF (sig.ts), BFR,
 * trésorerie nette and debts (balance-indicators.ts), payment delays and
 * ratios. Pure, amounts in integer cents, ratios as fractions (0.25 is
 * 25 %), delays in days.
 *
 * Payment delays compare amounts of the same kind. Receivables and payables
 * include VAT (a customer owes the TTC amount), while the sales and purchases
 * of classes 6 and 7 are recorded without VAT, so both flows are brought to
 * TTC with the VAT the ledger recorded on them over the year (opening entry
 * excluded, since it carries balances, not flows):
 * - DSO (délai clients) = gross customer receivables (2050 BX, before the
 *   491 depreciation) / (chiffre d'affaires HT + TVA collectée, credit
 *   movements of 4457) x days of the period;
 * - DPO (délai fournisseurs) = dettes fournisseurs (2051 DX) / (achats et
 *   charges externes HT, accounts 60 without the stock variations 603, 61
 *   and 62, + TVA déductible sur biens et services, debit movements of
 *   44566, less the VAT self-assessed on intra-EU purchases, credit
 *   movements of 4452, which no supplier invoices) x days of the period.
 * A company without VAT (franchise en base, CGI art. 293 B) has no 445
 * movement: TTC equals HT. Credit notes (avoirs) are posted to the debit of
 * 4457 like the monthly VAT settlement and cannot be told apart from it, so
 * they are not deducted from the VAT collected: the delay is slightly
 * understated when they are large. A partial year counts the days from its
 * first day to the reference day, so the delay is not inflated by the days
 * still to come.
 */

import type { AccountTotals } from '@/lib/reports/statements/allocation'
import { computeCaf, computeSig, type Caf, type Sig } from './sig'
import { computeBalanceIndicators, type BalanceIndicators } from './balance-indicators'

export interface VatFlows {
  /** Credit movements of 4457 (TVA collectée) over the period, opening entry excluded. */
  collecteeCents: number
  /** Debit movements of 44566 (TVA déductible sur ABS) less credit movements of 4452 (TVA due intracommunautaire). */
  deductibleCents: number
}

export interface Delays {
  /** Days of the period the flows cover. */
  days: number
  chiffreAffairesTtcCents: number
  achatsHtCents: number
  achatsTtcCents: number
  /** Délai de paiement des clients in days, null without sales. */
  dsoDays: number | null
  /** Délai de paiement des fournisseurs in days, null without purchases. */
  dpoDays: number | null
}

export interface Ratios {
  /** Taux de marge: marge commerciale / coût d'achat des marchandises vendues. */
  tauxMarge: number | null
  /** Taux de marque: marge commerciale / ventes de marchandises HT. */
  tauxMarque: number | null
  /** EBE / chiffre d'affaires HT. */
  margeEbe: number | null
  /** Résultat de l'exercice / chiffre d'affaires HT. */
  margeNette: number | null
  /** Ratio d'endettement (gearing): dettes financières / capitaux propres, null when the equity is not positive. */
  endettement: number | null
}

export interface FinancialIndicators {
  sig: Sig
  caf: Caf
  bilan: BalanceIndicators
  delais: Delays
  ratios: Ratios
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null

const delay = (balanceCents: number, flowCents: number, days: number): number | null =>
  flowCents > 0 ? Math.round((balanceCents / flowCents) * days) : null

/** Debit minus credit of the accounts starting with one of `prefixes`, minus those starting with one of `excluded`. */
function debitBalance(accounts: readonly AccountTotals[], prefixes: readonly string[], excluded: readonly string[] = []): number {
  let cents = 0
  for (const a of accounts) {
    if (prefixes.some((p) => a.code.startsWith(p)) && !excluded.some((x) => a.code.startsWith(x))) cents += a.debitCents - a.creditCents
  }
  return cents
}

export function computeFinancialIndicators(input: {
  accounts: readonly AccountTotals[]
  vat: VatFlows
  /** Days covered by the flows (the fiscal year, or its elapsed part). */
  days: number
}): FinancialIndicators {
  const sig = computeSig(input.accounts)
  const caf = computeCaf(input.accounts, sig)
  const bilan = computeBalanceIndicators(input.accounts)

  const chiffreAffairesTtcCents = sig.chiffreAffairesCents + input.vat.collecteeCents
  // Achats consommés from third parties, without the stock variations (603): what suppliers invoiced.
  const achatsHtCents = debitBalance(input.accounts, ['60', '61', '62'], ['603'])
  const achatsTtcCents = achatsHtCents + input.vat.deductibleCents

  return {
    sig,
    caf,
    bilan,
    delais: {
      days: input.days,
      chiffreAffairesTtcCents,
      achatsHtCents,
      achatsTtcCents,
      dsoDays: delay(bilan.creancesClientsBrutesCents, chiffreAffairesTtcCents, input.days),
      dpoDays: delay(bilan.dettesFournisseursCents, achatsTtcCents, input.days),
    },
    ratios: {
      tauxMarge: sig.hasMarchandises ? ratio(sig.margeCommercialeCents, sig.coutMarchandisesCents) : null,
      tauxMarque: sig.hasMarchandises ? ratio(sig.margeCommercialeCents, sig.ventesMarchandisesCents) : null,
      margeEbe: ratio(sig.ebeCents, sig.chiffreAffairesCents),
      margeNette: ratio(sig.resultatExerciceCents, sig.chiffreAffairesCents),
      endettement: ratio(bilan.dettesFinancieresCents, bilan.capitauxPropresCents),
    },
  }
}

/** VAT flows of the year from the movements of its accounts (opening entry excluded). */
export function vatFlowsOf(movements: ReadonlyArray<{ code: string; debitCents: number; creditCents: number }>): VatFlows {
  let collecteeCents = 0
  let deductibleCents = 0
  for (const m of movements) {
    if (m.code.startsWith('4457')) collecteeCents += m.creditCents
    if (m.code.startsWith('44566')) deductibleCents += m.debitCents
    if (m.code.startsWith('4452')) deductibleCents -= m.creditCents
  }
  return { collecteeCents, deductibleCents: Math.max(0, deductibleCents) }
}
