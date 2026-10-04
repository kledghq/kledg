/**
 * Indicators read on the balance sheet of a fiscal year: besoin en fonds de
 * roulement (BFR), trésorerie nette, financial debts and equity. Pure,
 * amounts in integer cents.
 *
 * The accounts are placed on the lines of the default PCG balance sheet
 * (cerfa 2050-SD and 2051-SD, lib/reports/balance-sheet/config/
 * default-pcg-config-complete-2026.ts) by the allocation engine of the
 * statements (lib/reports/statements/allocation.ts): an account goes to a
 * line of the sign of its balance, so a supplier in debit is an "Autres
 * créances" and a bank account in credit a bank overdraft, exactly as on the
 * balance sheet. Every component below is therefore a balance sheet line (or
 * the named part of one), which the tests check against buildBalanceSheet.
 *
 * Definitions:
 * - BFR = stocks et en-cours (BL to BT, net of 39) + créances clients (BX,
 *   net of 491) + autres créances d'exploitation (BV, avances et acomptes
 *   versés, and the part of BZ on accounts 40, 42, 43 and 44: suppliers in
 *   debit, personnel, social bodies, State including deductible VAT) -
 *   dettes fournisseurs (DX) - dettes fiscales et sociales (DY).
 * - Trésorerie nette = valeurs mobilières de placement (CD, net of 59) +
 *   disponibilités (CF) - concours bancaires courants (accounts 51 in
 *   credit, inside DU).
 * - Dettes financières = emprunts obligataires (DS, DT) + emprunts auprès
 *   des établissements de crédit (DU) without the bank overdrafts + emprunts
 *   et dettes financières divers (DV). Partners' current accounts (455)
 *   stay in Autres dettes (EA) as on Kledg's balance sheet.
 * - Capitaux propres = the DL total, result of the year included.
 *
 * The closing entries of the year (journal CL) must be excluded from the
 * totals, like for the statements.
 */

import { allocateAccounts, sectionOf, contribution, type AccountTotals } from '@/lib/reports/statements/allocation'
import { flattenRules, resultCents, type BalanceSheetRule } from '@/lib/reports/statements/balance-sheet'
import { defaultBalanceSheetRules } from '@/lib/reports/statements/default-rules'

/** Lines of the 2050 (actif) read for the BFR. */
const STOCK_LINES = ['BL', 'BN', 'BP', 'BR', 'BT']
/** Accounts of "Autres créances" (BZ) that belong to the operating cycle. */
const OPERATING_RECEIVABLE_PREFIXES = ['40', '42', '43', '44']

export interface BalanceIndicators {
  stocksCents: number
  /** Net of the 491 depreciation. */
  creancesClientsCents: number
  /** Gross receivables (before 491), including VAT: the numerator of the DSO. */
  creancesClientsBrutesCents: number
  autresCreancesExploitationCents: number
  dettesFournisseursCents: number
  dettesFiscalesSocialesCents: number
  bfrCents: number
  valeursMobilieresCents: number
  disponibilitesCents: number
  concoursBancairesCents: number
  tresorerieNetteCents: number
  dettesFinancieresCents: number
  capitauxPropresCents: number
}

let cachedRules: { rules: BalanceSheetRule[]; formCodeOf: Map<string, string>; underEquity: Set<string> } | null = null

/** The default rules, the form code of each line and the lines under the capitaux propres (DL). */
function rules() {
  if (cachedRules) return cachedRules
  const rules = flattenRules(defaultBalanceSheetRules('complete'))
  const byId = new Map(rules.map((r) => [r.id, r]))
  const formCodeOf = new Map(rules.filter((r) => r.formCode).map((r) => [r.id, r.formCode as string]))
  const underEquity = new Set<string>()
  for (const rule of rules) {
    let current: BalanceSheetRule | undefined = rule
    while (current) {
      if (current.formCode === 'DL') {
        underEquity.add(rule.id)
        break
      }
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
  }
  cachedRules = { rules, formCodeOf, underEquity }
  return cachedRules
}

export function computeBalanceIndicators(accounts: readonly AccountTotals[]): BalanceIndicators {
  const { rules: all, formCodeOf, underEquity } = rules()
  const byId = new Map(all.map((r) => [r.id, r]))
  const bsAccounts = accounts.filter((a) => '12345'.includes(a.code.charAt(0)) && a.code !== '')
  const allocation = allocateAccounts(all, bsAccounts, 'balance-sheet')

  const net = new Map<string, number>()
  let creancesClientsBrutesCents = 0
  let autresCreancesExploitationCents = 0
  let concoursBancairesCents = 0
  let capitauxPropresCents = resultCents([...accounts])
  for (const a of allocation.allocations) {
    const rule = byId.get(a.lineId)!
    const value = contribution(a, sectionOf(rule, byId, 'balance-sheet'))
    const signed = a.slot === 'amortissement' ? -value : value
    const code = formCodeOf.get(a.lineId)
    if (code) net.set(code, (net.get(code) ?? 0) + signed)
    if (underEquity.has(a.lineId)) capitauxPropresCents += signed
    if (code === 'BX' && a.slot === 'main') creancesClientsBrutesCents += value
    if (code === 'BZ' && a.slot === 'main' && OPERATING_RECEIVABLE_PREFIXES.some((p) => a.account.code.startsWith(p))) {
      autresCreancesExploitationCents += value
    }
    if (code === 'DU' && a.account.code.startsWith('51')) concoursBancairesCents += value
  }
  const line = (code: string) => net.get(code) ?? 0

  const stocksCents = STOCK_LINES.reduce((sum, code) => sum + line(code), 0)
  const creancesClientsCents = line('BX')
  autresCreancesExploitationCents += line('BV')
  const dettesFournisseursCents = line('DX')
  const dettesFiscalesSocialesCents = line('DY')
  const valeursMobilieresCents = line('CD')
  const disponibilitesCents = line('CF')

  return {
    stocksCents,
    creancesClientsCents,
    creancesClientsBrutesCents,
    autresCreancesExploitationCents,
    dettesFournisseursCents,
    dettesFiscalesSocialesCents,
    bfrCents: stocksCents + creancesClientsCents + autresCreancesExploitationCents - dettesFournisseursCents - dettesFiscalesSocialesCents,
    valeursMobilieresCents,
    disponibilitesCents,
    concoursBancairesCents,
    tresorerieNetteCents: valeursMobilieresCents + disponibilitesCents - concoursBancairesCents,
    dettesFinancieresCents: line('DS') + line('DT') + line('DU') - concoursBancairesCents + line('DV'),
    capitauxPropresCents,
  }
}
