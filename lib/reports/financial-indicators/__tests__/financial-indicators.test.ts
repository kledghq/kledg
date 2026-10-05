/**
 * Financial indicators on the worked example of worked-example.ts (every
 * figure computed by hand there), and their consistency with the statements:
 * the SIG end on the result of the income statement and on its intermediate
 * results (cerfa 2052-SD GG, GW and 2053-SD HI, HN), the BFR components are
 * lines of the balance sheet (cerfa 2050-SD and 2051-SD), and the CAF is the
 * same by the additive and the subtractive methods.
 *
 * Sources: PCG (règlement ANC 2014-03 as amended by ANC 2022-06), art. 821-1
 * (products minus charges is the result); tableau des soldes intermédiaires
 * de gestion and tableau de financement of the PCG 1982 système développé;
 * notices of cerfa 2033-SD and 2050-SD to 2053-SD.
 */

import { describe, expect, it } from 'vitest'
import { buildIncomeStatement } from '@/lib/reports/statements/income-statement'
import { buildBalanceSheet } from '@/lib/reports/statements/balance-sheet'
import { defaultBalanceSheetRules, defaultIncomeStatementRules } from '@/lib/reports/statements/default-rules'
import type { AccountTotals } from '@/lib/reports/statements/allocation'
import type { BalanceSheetLine } from '@/lib/reports/balance-sheet/types'
import { computeCaf, computeSig, sigBucketOf } from '../sig'
import { computeBalanceIndicators } from '../balance-indicators'
import { computeFinancialIndicators, vatFlowsOf } from '../indicators'
import { INDICATOR_SECTIONS } from '../rows'
import { WORKED_EXAMPLE_ACCOUNTS, WORKED_EXAMPLE_VAT } from './worked-example'

const euros = (value: number) => Math.round(value * 100)

describe('soldes intermédiaires de gestion (worked example)', () => {
  const sig = computeSig(WORKED_EXAMPLE_ACCOUNTS)

  it('computes every balance of the cascade', () => {
    expect(sig).toMatchObject({
      chiffreAffairesCents: euros(299_000),
      ventesMarchandisesCents: euros(198_000),
      coutMarchandisesCents: euros(124_000),
      margeCommercialeCents: euros(74_000),
      hasMarchandises: true,
      productionVendueCents: euros(101_000),
      productionStockeeCents: euros(3_000),
      productionImmobiliseeCents: euros(5_000),
      productionExerciceCents: euros(109_000),
      consommationsTiersCents: euros(38_000),
      valeurAjouteeCents: euros(145_000),
      subventionsExploitationCents: euros(4_000),
      impotsTaxesCents: euros(2_500),
      chargesPersonnelCents: euros(85_000),
      ebeCents: euros(61_500),
      reprisesTransfertsCents: euros(2_000),
      autresProduitsCents: euros(10_000),
      dotationsExploitationCents: euros(10_000),
      autresChargesCents: euros(7_500),
      resultatExploitationCents: euros(56_000),
      quotesPartsCommunesCents: euros(500),
      produitsFinanciersCents: euros(1_900),
      chargesFinancieresCents: euros(3_900),
      resultatCourantCents: euros(54_500),
      produitsExceptionnelsCents: euros(1_300),
      chargesExceptionnellesCents: euros(1_800),
      resultatExceptionnelCents: euros(-500),
      participationCents: euros(1_000),
      impotsBeneficesCents: euros(9_000),
      resultatExerciceCents: euros(44_000),
      produitsCessionsCents: euros(9_000),
      valeurComptableCessionsCents: euros(7_200),
      plusValuesCessionCents: euros(1_800),
    })
  })

  it('keeps the investment subsidies released (747) and the disposals (657, 757) out of the EBE', () => {
    const without = computeSig(WORKED_EXAMPLE_ACCOUNTS.filter((a) => !['747000', '657000', '757000'].includes(a.code)))
    expect(without.ebeCents).toBe(sig.ebeCents)
    expect(without.resultatExploitationCents).toBe(sig.resultatExploitationCents - euros(1_500) - euros(8_000) + euros(6_000))
  })

  it('computes the CAF by the additive method, equal to the subtractive method', () => {
    const caf = computeCaf(WORKED_EXAMPLE_ACCOUNTS)
    expect(caf).toEqual({
      resultatExerciceCents: euros(44_000),
      dotationsCents: euros(11_200),
      reprisesCents: euros(1_900),
      valeurComptableCessionsCents: euros(7_200),
      produitsCessionsCents: euros(9_000),
      quotePartSubventionsCents: euros(1_500),
      cafCents: euros(50_000),
      cafFromEbeCents: euros(50_000),
    })
  })
})

describe('balance sheet indicators (worked example)', () => {
  const bilan = computeBalanceIndicators(WORKED_EXAMPLE_ACCOUNTS)

  it('computes the BFR, the net cash and the debts', () => {
    expect(bilan).toEqual({
      stocksCents: euros(39_000),
      creancesClientsCents: euros(58_000),
      creancesClientsBrutesCents: euros(59_800),
      autresCreancesExploitationCents: euros(3_400),
      dettesFournisseursCents: euros(21_600),
      dettesFiscalesSocialesCents: euros(18_000),
      bfrCents: euros(60_800),
      valeursMobilieresCents: euros(4_000),
      disponibilitesCents: euros(31_000),
      concoursBancairesCents: euros(2_500),
      tresorerieNetteCents: euros(32_500),
      dettesFinancieresCents: euros(30_000),
      capitauxPropresCents: euros(114_000),
    })
  })
})

describe('delays and ratios (worked example)', () => {
  const indicators = computeFinancialIndicators({ accounts: WORKED_EXAMPLE_ACCOUNTS, vat: WORKED_EXAMPLE_VAT, days: 365 })

  it('brings sales and purchases to TTC before comparing them with receivables and payables', () => {
    expect(indicators.delais).toEqual({
      days: 365,
      chiffreAffairesTtcCents: euros(358_800),
      achatsHtCents: euros(159_000),
      achatsTtcCents: euros(189_000),
      dsoDays: 61,
      dpoDays: 42,
    })
  })

  it('computes the margin rates and the gearing', () => {
    expect(indicators.ratios).toEqual({ tauxMarge: 0.5968, tauxMarque: 0.3737, margeEbe: 0.2057, margeNette: 0.1472, endettement: 0.2632 })
  })

  it('counts only the days elapsed in a partial year', () => {
    const half = computeFinancialIndicators({ accounts: WORKED_EXAMPLE_ACCOUNTS, vat: WORKED_EXAMPLE_VAT, days: 182 })
    expect(half.delais.dsoDays).toBe(Math.round((59_800 / 358_800) * 182))
  })

  it('answers null instead of dividing by zero, and TTC equals HT without VAT', () => {
    const services = computeFinancialIndicators({
      accounts: [
        { code: '706000', debitCents: 0, creditCents: euros(1_000) },
        { code: '411000', debitCents: euros(100), creditCents: 0 },
        { code: '119000', debitCents: euros(1_500), creditCents: 0 }, // report à nouveau débiteur: negative equity
      ],
      vat: { collecteeCents: 0, deductibleCents: 0 },
      days: 365,
    })
    expect(services.sig.hasMarchandises).toBe(false)
    expect(services.ratios).toMatchObject({ tauxMarge: null, tauxMarque: null, endettement: null })
    expect(services.delais).toMatchObject({ chiffreAffairesTtcCents: euros(1_000), dsoDays: 37, dpoDays: null })
  })

  it('reads the VAT flows from the movements of 4457, 44566 and 4452', () => {
    expect(
      vatFlowsOf([
        { code: '445710', debitCents: euros(40_000), creditCents: euros(59_800) },
        { code: '445660', debitCents: euros(31_000), creditCents: euros(30_000) },
        { code: '445200', debitCents: 0, creditCents: euros(1_000) },
        { code: '445510', debitCents: 0, creditCents: euros(8_000) },
      ]),
    ).toEqual({ collecteeCents: euros(59_800), deductibleCents: euros(30_000) })
  })
})

describe('consistency with the income statement', () => {
  const sig = computeSig(WORKED_EXAMPLE_ACCOUNTS)

  it.each(['complete', 'simplified'] as const)('ends on the result of the %s income statement', (variant) => {
    const statement = buildIncomeStatement({
      companyId: 'c',
      fiscalYearId: 'fy',
      reportVariant: variant,
      rules: defaultIncomeStatementRules(variant),
      accounts: WORKED_EXAMPLE_ACCOUNTS,
    })
    expect(statement.unmappedAccounts).toEqual([])
    expect(euros(statement.netResult)).toBe(sig.resultatExerciceCents)
    // The 2033-B has no line for the opérations faites en commun: its résultat d'exploitation (270) includes 755 - 655
    const quotesParts = variant === 'simplified'
      ? WORKED_EXAMPLE_ACCOUNTS.filter((a) => /^(655|755)/.test(a.code)).reduce((s, a) => s + a.creditCents - a.debitCents, 0)
      : 0
    expect(euros(statement.intermediateResults!.resultatExploitation!)).toBe(sig.resultatExploitationCents + quotesParts)
    expect(euros(statement.intermediateResults!.resultatExceptionnel!)).toBe(sig.resultatExceptionnelCents)
  })

  it('matches the résultat courant avant impôts of the complete model (2052 GW)', () => {
    const statement = buildIncomeStatement({
      companyId: 'c',
      fiscalYearId: 'fy',
      reportVariant: 'complete',
      rules: defaultIncomeStatementRules('complete'),
      accounts: WORKED_EXAMPLE_ACCOUNTS,
    })
    expect(euros(statement.intermediateResults!.resultatCourant!)).toBe(sig.resultatCourantCents)
  })

  it('ends on produits minus charges for any ledger, and both CAF methods agree', () => {
    // Deterministic pseudo-random ledgers over every class 6 and 7 subdivision, odd codes included.
    let seed = 7
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648)
    const codes = ['6', '7', '73', '609', '6037', '6087', '6097', '655', '657', '6671', '675', '686', '687', '691', '695', '699', '7097', '747', '755', '757', '7671', '775', '777', '786', '787', '791', '796', '797']
    for (let n = 0; n < 50; n++) {
      const accounts: AccountTotals[] = []
      for (let i = 0; i < 40; i++) {
        const code = i < codes.length ? `${codes[i]}000`.slice(0, 6) : `${6 + (next() % 2)}${next() % 10}${next() % 10}000`
        accounts.push({ code, debitCents: next() % 1_000_000, creditCents: next() % 1_000_000 })
      }
      const produits = accounts.filter((a) => a.code.startsWith('7')).reduce((s, a) => s + a.creditCents - a.debitCents, 0)
      const charges = accounts.filter((a) => a.code.startsWith('6')).reduce((s, a) => s + a.debitCents - a.creditCents, 0)
      const sig = computeSig(accounts)
      expect(sig.resultatExerciceCents).toBe(produits - charges)
      const caf = computeCaf(accounts, sig)
      expect(caf.cafCents).toBe(caf.cafFromEbeCents)
    }
  })

  it('puts every account of class 6 and 7 in one bucket, and no other class', () => {
    expect(sigBucketOf('707100')).toBe('ventesMarchandises')
    expect(sigBucketOf('709700')).toBe('ventesMarchandises')
    expect(sigBucketOf('709600')).toBe('productionVendue')
    expect(sigBucketOf('603700')).toBe('coutMarchandises')
    expect(sigBucketOf('603100')).toBe('consommationsTiers')
    expect(sigBucketOf('747000')).toBe('quotePartSubventionsInvestissement')
    expect(sigBucketOf('796000')).toBe('transfertsFinanciers')
    expect(sigBucketOf('6')).toBe('autresCharges')
    expect(sigBucketOf('411000')).toBeNull()
  })
})

describe('consistency with the balance sheet', () => {
  const sheet = buildBalanceSheet({
    companyId: 'c',
    fiscalYearId: 'fy',
    reportVariant: 'complete',
    rules: defaultBalanceSheetRules('complete'),
    accounts: WORKED_EXAMPLE_ACCOUNTS,
  })
  const lines = new Map<string, BalanceSheetLine>()
  const visit = (line: BalanceSheetLine) => {
    if (line.formCode && !lines.has(line.formCode)) lines.set(line.formCode, line)
    line.children?.forEach(visit)
  }
  ;[...sheet.actif.lines, ...sheet.passif.lines].forEach(visit)
  const net = (code: string) => euros(lines.get(code)?.net ?? 0)
  const bilan = computeBalanceIndicators(WORKED_EXAMPLE_ACCOUNTS)
  const partnersCents = euros(5_000) // 455000 in credit (worked example)

  it('reads a balanced balance sheet', () => {
    expect(sheet.actifTotal).toBe(191_100)
    expect(sheet.passifTotal).toBe(191_100)
  })

  it('takes each BFR component from its balance sheet line', () => {
    expect(bilan.stocksCents).toBe(['BL', 'BN', 'BP', 'BR', 'BT'].reduce((s, c) => s + net(c), 0))
    expect(bilan.creancesClientsCents).toBe(net('BX'))
    expect(bilan.dettesFournisseursCents).toBe(net('DX'))
    expect(bilan.dettesFiscalesSocialesCents).toBe(net('DY'))
    // BV plus the operating part of BZ: BZ without the 700 of débiteurs divers (467).
    expect(bilan.autresCreancesExploitationCents).toBe(net('BV') + net('BZ') - euros(700))
    expect(bilan.valeursMobilieresCents).toBe(net('CD'))
    expect(bilan.disponibilitesCents).toBe(net('CF'))
    // DV holds the partners' current accounts (45 in credit) the indicators keep out of the financial debts
    expect(bilan.dettesFinancieresCents + bilan.concoursBancairesCents).toBe(net('DS') + net('DT') + net('DU') + net('DV') - partnersCents)
    expect(bilan.capitauxPropresCents).toBe(net('DL'))
  })

  it('equals BV + BZ when every other receivable is an operating one', () => {
    const operating = WORKED_EXAMPLE_ACCOUNTS.filter((a) => a.code !== '467000')
    const other = buildBalanceSheet({ companyId: 'c', fiscalYearId: 'fy', reportVariant: 'complete', rules: defaultBalanceSheetRules('complete'), accounts: operating })
    const bz = other.actif.lines.flatMap(function all(l): BalanceSheetLine[] { return [l, ...(l.children ?? []).flatMap(all)] }).filter((l) => l.formCode === 'BV' || l.formCode === 'BZ')
    expect(computeBalanceIndicators(operating).autresCreancesExploitationCents).toBe(bz.reduce((s, l) => s + euros(l.net ?? 0), 0))
  })
})

describe('rows of the page and the exports', () => {
  const indicators = computeFinancialIndicators({ accounts: WORKED_EXAMPLE_ACCOUNTS, vat: WORKED_EXAMPLE_VAT, days: 365 })
  const value = (id: string) => INDICATOR_SECTIONS.flatMap((s) => s.rows).find((r) => r.id === id)!.value(indicators)

  it('read the computed indicators, with unique ids and a source on every row', () => {
    const rows = INDICATOR_SECTIONS.flatMap((s) => s.rows)
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
    expect(rows.every((r) => r.source.length > 0)).toBe(true)
    expect(value('ebe')).toBe(euros(61_500))
    expect(value('caf')).toBe(euros(50_000))
    expect(value('bfr')).toBe(euros(60_800))
    expect(value('dso')).toBe(61)
    expect(value('endettement')).toBe(0.2632)
  })
})
