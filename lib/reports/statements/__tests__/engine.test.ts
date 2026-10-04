/**
 * Allocation of balances to statement lines and the statements built from it.
 * Sources: PCG art. 821-1 (balance sheet model: soldes débiteurs à l'actif,
 * créditeurs au passif, "(D)" / "(C)" accounts), art. 821-3 (income
 * statement), notices of forms 2033-A/B and 2050 to 2053.
 */

import { describe, expect, it } from 'vitest'
import { allocateAccounts, type AccountTotals, type StatementLineRule } from '../allocation'
import { buildBalanceSheet, type BalanceSheetRule } from '../balance-sheet'
import { buildIncomeStatement, type IncomeStatementRule } from '../income-statement'

const acc = (code: string, debit: number, credit = 0): AccountTotals => ({
  accountId: `id-${code}`,
  code,
  label: code,
  debitCents: Math.round(debit * 100),
  creditCents: Math.round(credit * 100),
})

let order = 0
function bs(
  id: string,
  section: 'actif' | 'passif',
  accountCodes: string[],
  extra: Partial<BalanceSheetRule> = {}
): BalanceSheetRule {
  return {
    id,
    lineLabel: id,
    section,
    lineType: 'line',
    accountCodes,
    excludedAccountCodes: [],
    amortissementAccountCodes: [],
    balanceType: section === 'actif' ? 'debit' : 'credit',
    displayType: 'net',
    order: order++,
    ...extra,
  }
}

const RULES: BalanceSheetRule[] = [
  bs('immo', 'actif', ['21'], { amortissementAccountCodes: ['281'], displayType: 'brut_amort_net' }),
  bs('clients', 'actif', ['41']),
  bs('autres-creances', 'actif', ['40', '44', '45']),
  bs('dispo', 'actif', ['51']),
  bs('capital', 'passif', ['10']),
  bs('ran', 'passif', ['11']),
  bs('resultat', 'passif', ['12'], { formCode: 'DI' }),
  bs('emprunts', 'passif', ['16', '51']),
  bs('fournisseurs', 'passif', ['40']),
  bs('fiscales', 'passif', ['44']),
  bs('autres-dettes', 'passif', ['41', '45']),
  bs('cca', 'passif', ['455']),
]

describe('allocateAccounts (balance sheet)', () => {
  const lineOf = (code: string, debit: number, credit = 0) =>
    allocateAccounts(RULES, [acc(code, debit, credit)], 'balance-sheet').allocations[0]

  it('puts a bank account in credit (overdraft) in Emprunts et dettes, "51 (C)"', () => {
    expect(lineOf('512', 100).lineId).toBe('dispo')
    expect(lineOf('512', 0, 100).lineId).toBe('emprunts')
  })

  it('routes third-party accounts by the sign of their balance', () => {
    expect(lineOf('401', 0, 50).lineId).toBe('fournisseurs')
    expect(lineOf('401', 50).lineId).toBe('autres-creances')
    expect(lineOf('411', 50).lineId).toBe('clients')
    expect(lineOf('411', 0, 50).lineId).toBe('autres-dettes')
    expect(lineOf('44566', 50).lineId).toBe('autres-creances')
    expect(lineOf('44551', 0, 50).lineId).toBe('fiscales')
  })

  it('takes the most specific code among lines of the right sign', () => {
    expect(lineOf('455', 0, 50).lineId).toBe('cca')
    expect(lineOf('4551', 0, 50).lineId).toBe('cca')
    expect(lineOf('455', 50).lineId).toBe('autres-creances')
  })

  it('keeps a debit Report à nouveau (119) on its line, as a negative amount', () => {
    const a = lineOf('119', 300)
    expect(a.lineId).toBe('ran')
    expect(a.againstSign).toBe(true)
  })

  it('sends depreciation to the Amortissements column of the asset line', () => {
    const a = lineOf('2815', 0, 40)
    expect(a.lineId).toBe('immo')
    expect(a.slot).toBe('amortissement')
  })

  it('reports accounts no line takes, and ties between two lines', () => {
    const result = allocateAccounts(
      [...RULES, bs('doublon', 'actif', ['51'])],
      [acc('3700', 10), acc('512', 10)],
      'balance-sheet'
    )
    expect(result.unmapped.map((a) => a.code)).toEqual(['3700'])
    expect(result.ambiguous).toEqual([{ code: '512', lineIds: ['dispo', 'doublon'] }])
    expect(result.allocations).toHaveLength(1)
  })

  it('ignores accounts with a zero balance', () => {
    expect(allocateAccounts(RULES, [acc('512', 10, 10)], 'balance-sheet').allocations).toHaveLength(0)
  })
})

describe('buildBalanceSheet', () => {
  const ledger = [
    acc('101', 0, 10000), // capital
    acc('119', 1000), // report à nouveau débiteur
    acc('2154', 8000), // matériel
    acc('28154', 0, 2000), // amortissements
    acc('512', 0, 500), // découvert
    acc('411', 6000), // clients
    acc('401', 300), // fournisseur débiteur
    acc('401', 0, 0),
    acc('44551', 0, 1200), // TVA à décaisser
    acc('701', 0, 4000),
    acc('6811', 2000),
    acc('606', 400),
  ]

  const sheet = buildBalanceSheet({
    companyId: 'c',
    fiscalYearId: 'fy',
    reportVariant: 'complete',
    rules: RULES,
    accounts: ledger,
  })
  const line = (id: string) =>
    [...sheet.actif.lines, ...sheet.passif.lines].find((l) => l.id === id)!

  it('balances and shows the result of classes 6 and 7 on the result line', () => {
    expect(sheet.netResult).toBe(1600) // 4000 - 2000 - 400
    expect(line('resultat').net).toBe(1600)
    expect(sheet.actifTotal).toBe(sheet.passifTotal)
    expect(sheet.actifTotal).toBe(12300) // 6000 net immo + 6000 clients + 300
    expect(sheet.imbalance).toBeUndefined()
    expect(sheet.diagnostic).toBeUndefined()
  })

  it('shows gross, depreciation and net for assets', () => {
    expect(line('immo').brut).toBe(8000)
    expect(line('immo').amortissements).toBe(2000)
    expect(line('immo').net).toBe(6000)
  })

  it('puts each balance on the side of its sign', () => {
    expect(line('emprunts').net).toBe(500)
    expect(line('autres-creances').net).toBe(300)
    expect(line('fiscales').net).toBe(1200)
    expect(line('ran').net).toBe(-1000)
  })

  it('adds a result left in account 12 (not yet allocated) to the result line', () => {
    const next = buildBalanceSheet({
      companyId: 'c',
      fiscalYearId: 'fy',
      reportVariant: 'complete',
      rules: RULES,
      accounts: [acc('120', 0, 700), acc('512', 700)],
    })
    expect(next.netResult).toBe(0)
    expect(next.passifTotal).toBe(700)
    expect(next.actifTotal).toBe(700)
  })

  it('reports an unmapped account and the difference it causes', () => {
    const broken = buildBalanceSheet({
      companyId: 'c',
      fiscalYearId: 'fy',
      reportVariant: 'complete',
      rules: RULES,
      accounts: [acc('101', 0, 100), acc('3700', 100)],
    })
    expect(broken.imbalance).toBe(-100)
    expect(broken.diagnostic?.causes.unmappedAccounts.map((a) => a.code)).toEqual(['3700'])
    expect(broken.warnings?.[0]).toContain('3700')
  })
})

describe('buildIncomeStatement', () => {
  let n = 0
  const is = (
    id: string,
    section: 'produits' | 'charges',
    accountCodes: string[],
    extra: Partial<IncomeStatementRule> = {}
  ): IncomeStatementRule => ({
    id,
    lineLabel: id,
    section,
    lineType: accountCodes.length ? 'line' : 'sum',
    accountCodes,
    excludedAccountCodes: [],
    balanceType: accountCodes.length ? (section === 'produits' ? 'credit' : 'debit') : 'auto',
    order: n++,
    ...extra,
  })
  const rules: IncomeStatementRule[] = [
    is('pe', 'produits', [], { formCode: 'FR' }),
    is('ventes', 'produits', ['70'], { parentId: 'pe' }),
    is('re', 'produits', [], { formCode: 'GG' }),
    is('pf', 'produits', [], { formCode: 'GP' }),
    is('interets', 'produits', ['76'], { parentId: 'pf' }),
    is('total-p', 'produits', [], { formCode: 'HL' }),
    is('benefice', 'produits', [], { formCode: 'HN' }),
    is('ce', 'charges', [], { formCode: 'GF' }),
    is('achats', 'charges', ['60', '61', '62'], { parentId: 'ce' }),
    is('personnel', 'charges', ['64'], { parentId: 'ce' }),
    is('cf', 'charges', [], { formCode: 'GU' }),
    is('frais-fi', 'charges', ['66'], { parentId: 'cf' }),
    is('impot', 'charges', ['69']),
  ]
  const statement = buildIncomeStatement({
    companyId: 'c',
    fiscalYearId: 'fy',
    reportVariant: 'complete',
    rules,
    accounts: [
      acc('706', 0, 10000),
      acc('709', 500), // rabais accordés: reduce sales
      acc('768', 0, 50),
      acc('606', 2000),
      acc('6098', 0, 100), // rabais obtenus: reduce purchases
      acc('641', 3000),
      acc('646', 1000), // cotisations personnelles de l'exploitant
      acc('661', 150),
      acc('695', 800),
      acc('512', 99999), // not an income statement account
    ],
  })
  const line = (id: string) =>
    [...statement.produits.lines, ...statement.charges.lines]
      .flatMap((l) => [l, ...(l.children ?? [])])
      .find((l) => l.id === id)!

  it('nets rebates within their line', () => {
    expect(line('ventes').value).toBe(9500)
    expect(line('achats').value).toBe(1900)
  })

  it('computes totals and the net result from the leaf lines only', () => {
    expect(statement.totalProduits).toBe(9550)
    expect(statement.totalCharges).toBe(6850)
    expect(statement.netResult).toBe(2700)
  })

  it('computes the intermediate results of the model', () => {
    expect(line('re').value).toBe(9500 - 5900)
    expect(line('total-p').value).toBe(9550)
    expect(line('benefice').value).toBe(2700)
    expect(statement.intermediateResults?.resultatExploitation).toBe(3600)
    expect(statement.intermediateResults?.resultatFinancier).toBe(-100)
  })

  it('has no unmapped account when every class 6 and 7 balance has a line', () => {
    expect(statement.unmappedAccounts).toEqual([])
    expect(statement.warnings).toEqual([])
  })
})

describe('allocateAccounts (income statement)', () => {
  it('uses the most specific code and no sign routing', () => {
    const rules: StatementLineRule[] = [
      { id: 'autres', section: 'produits', accountCodes: ['75'], excludedAccountCodes: ['755'], balanceType: 'credit', order: 1 },
      { id: 'cessions', section: 'produits', accountCodes: ['757'], balanceType: 'credit', order: 2 },
      { id: 'quote-part', section: 'produits', accountCodes: ['755'], balanceType: 'credit', order: 3 },
    ]
    const result = allocateAccounts(
      rules,
      [acc('757', 0, 10), acc('7551', 0, 10), acc('758', 5)],
      'income-statement'
    )
    expect(result.allocations.map((a) => [a.account.code, a.lineId])).toEqual([
      ['757', 'cessions'],
      ['7551', 'quote-part'],
      ['758', 'autres'],
    ])
  })
})
