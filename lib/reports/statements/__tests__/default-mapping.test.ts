/**
 * The default statement configurations map every account of the chart of
 * accounts (lib/accounting/pcg-data.ts) to exactly one line, with the sign
 * rules of the official models, and the statements they produce are
 * consistent: Actif = Passif, and the result of the income statement is the
 * result of the balance sheet.
 *
 * Sources: PCG art. 821-1 (balance sheet model, soldes débiteurs à l'actif,
 * créditeurs au passif, "(D)" / "(C)" accounts), art. 821-3 (income
 * statement model), notices of forms 2033-A, 2033-B, 2050 to 2053.
 * Class 8 (comptes spéciaux: engagements, bilan d'ouverture et de clôture)
 * is outside both statements.
 */

import { describe, expect, it } from 'vitest'
import { PCG_ACCOUNTS } from '@/lib/accounting/pcg-data'
import { allocateAccounts, type AccountTotals } from '../allocation'
import { buildBalanceSheet } from '../balance-sheet'
import { buildIncomeStatement } from '../income-statement'
import { defaultBalanceSheetRules, defaultIncomeStatementRules } from '../default-rules'

const VARIANTS = ['complete', 'simplified'] as const
/** Every account that can carry a balance: all codes but the class headers (1 to 8). */
const CODES = PCG_ACCOUNTS.map((a) => a.code).filter((code) => code.length >= 2)
const BALANCE_SHEET_CODES = CODES.filter((c) => /^[1-5]/.test(c))
const INCOME_STATEMENT_CODES = CODES.filter((c) => /^[67]/.test(c))

const account = (code: string, debitCents: number, creditCents = 0): AccountTotals => ({
  accountId: `id-${code}`,
  code,
  label: code,
  debitCents,
  creditCents,
})

describe.each(VARIANTS)('default balance sheet mapping (%s)', (variant) => {
  const rules = defaultBalanceSheetRules(variant)
  const labelOf = (id: string) => rules.find((r) => r.id === id)!.lineLabel
  const place = (code: string, side: 'debit' | 'credit') => {
    const result = allocateAccounts(
      rules,
      [account(code, side === 'debit' ? 100 : 0, side === 'credit' ? 100 : 0)],
      'balance-sheet'
    )
    return { ...result, allocation: result.allocations[0], label: result.allocations[0] && labelOf(result.allocations[0].lineId) }
  }

  it('maps every class 1 to 5 account, in debit and in credit, to exactly one line', () => {
    const problems: string[] = []
    for (const code of BALANCE_SHEET_CODES) {
      for (const side of ['debit', 'credit'] as const) {
        const { allocations, unmapped, ambiguous } = place(code, side)
        if (unmapped.length > 0) problems.push(`${code} ${side}: unmapped`)
        if (ambiguous.length > 0) problems.push(`${code} ${side}: ambiguous ${ambiguous[0].lineIds.join(' / ')}`)
        if (allocations.length !== 1) problems.push(`${code} ${side}: ${allocations.length} lines`)
      }
    }
    expect(problems).toEqual([])
  })

  it('applies the (D) / (C) rules of the official model', () => {
    expect(place('512', 'debit').label).toBe('Disponibilités')
    expect(place('512', 'credit').label).toMatch(/^Emprunts et dettes/)
    expect(place('5191', 'credit').label).toMatch(/^Emprunts et dettes/)
    expect(place('411', 'debit').label).toBe('Clients et comptes rattachés')
    expect(place('411', 'credit').label).toBe('Autres dettes')
    expect(place('401', 'credit').label).toMatch(/[Ff]ournisseurs et comptes rattachés$/)
    expect(place('401', 'debit').label).toMatch(/^Autres/)
    expect(place('4091', 'debit').label).toBe('Avances et acomptes versés sur commandes')
    expect(place('4191', 'credit').label).toBe('Avances et acomptes reçus sur commandes en cours')
    expect(place('44566', 'debit').label).toMatch(/^Autres/)
    expect(place('44551', 'credit').label).toBe('Dettes fiscales et sociales')
    expect(place('421', 'credit').label).toBe('Dettes fiscales et sociales')
    expect(place('404', 'credit').label).toMatch(/^(Autres dettes|Dettes sur immobilisations)/)
    expect(place('486', 'debit').label).toMatch(/^Charges constatées d'avance/)
    expect(place('487', 'credit').label).toBe("Produits constatés d'avance")
    expect(place('101', 'credit').label).toBe('Capital social ou individuel')
    // 2050 AA; the 2033-A has no such line: with the other receivables (072)
    expect(place('109', 'debit').label).toBe(variant === 'complete' ? 'Capital souscrit non appelé' : 'Autres')
  })

  it('keeps capitaux propres accounts on their line whatever their sign', () => {
    const debitRan = place('119', 'debit')
    expect(debitRan.label).toBe('Report à nouveau')
    expect(debitRan.allocation.againstSign).toBe(true)
    expect(place('110', 'credit').label).toBe('Report à nouveau')
    expect(place('129', 'debit').label).toBe("Résultat de l'exercice")
    expect(place('120', 'credit').label).toBe("Résultat de l'exercice")
    expect(place('139', 'debit').label).toBe("Subventions d'investissement")
  })

  it('deducts depreciation from its asset line', () => {
    for (const [code, asset] of [
      ['28183', '2183'],
      ['2813', '2131'],
      ['2807', '207'],
      ['2961', '2611'],
      ['397', '37'],
      ['491', '411'],
      ['590', '503'],
    ]) {
      const amort = place(code, 'credit')
      expect(amort.allocation.slot, code).toBe('amortissement')
      expect(amort.allocation.lineId, code).toBe(place(asset, 'debit').allocation.lineId)
    }
  })

  it('has one "Résultat de l\'exercice" line', () => {
    const results = rules.filter((r) => r.formCode === 'DI' || r.formCode === '136')
    expect(results).toHaveLength(1)
  })
})

describe.each(VARIANTS)('default income statement mapping (%s)', (variant) => {
  const rules = defaultIncomeStatementRules(variant)
  const labelOf = (code: string) => {
    const result = allocateAccounts(rules, [account(code, 100)], 'income-statement')
    return rules.find((r) => r.id === result.allocations[0]?.lineId)?.lineLabel
  }

  it('maps every class 6 and 7 account to exactly one line', () => {
    const problems: string[] = []
    for (const code of INCOME_STATEMENT_CODES) {
      const { allocations, unmapped, ambiguous } = allocateAccounts(rules, [account(code, 100)], 'income-statement')
      if (unmapped.length > 0) problems.push(`${code}: unmapped`)
      if (ambiguous.length > 0) problems.push(`${code}: ambiguous ${ambiguous[0].lineIds.join(' / ')}`)
      if (allocations.length !== 1) problems.push(`${code}: ${allocations.length} lines`)
    }
    expect(problems).toEqual([])
  })

  it("maps the operator's own pay and contributions (644, 646)", () => {
    expect(labelOf('646')).toBe('Cotisations sociales')
    expect(labelOf('645')).toBe('Cotisations sociales')
    expect(labelOf('644')).toMatch(/^(Salaires|Rémunérations du personnel)/)
    expect(labelOf('641')).toMatch(/^(Salaires|Rémunérations du personnel)/)
  })

  it('maps rebates, taxes and depreciation to their lines', () => {
    expect(labelOf('6811')).toMatch(/dotations aux amortissements/i)
    expect(labelOf('6815')).toMatch(/provisions/i)
    expect(labelOf('695')).toMatch(/^Impôt/)
    // 2052 GH and GI; no such line on the 2033-B (autres produits, autres charges)
    expect(labelOf('755')).toBe(variant === 'complete' ? 'Bénéfice attribué ou perte transférée' : 'Autres produits')
    expect(labelOf('655')).toBe(variant === 'complete' ? 'Perte supportée ou bénéfice transféré' : 'Autres charges')
    expect(labelOf('786')).toMatch(/^Reprises sur dépréciations et provisions/)
    expect(labelOf('787')).toMatch(/^Produits exceptionnels/)
    expect(labelOf('687')).toMatch(/^Charges exceptionnelles/)
  })

  if (variant === 'complete') {
    it('follows the 2052 lines for goods and stock variations', () => {
      expect(labelOf('707')).toBe('Ventes de marchandises')
      expect(labelOf('7097')).toBe('Ventes de marchandises')
      expect(labelOf('706')).toBe('Production vendue - Services')
      expect(labelOf('701')).toBe('Production vendue - Biens')
      expect(labelOf('607')).toBe('Achats de marchandises (y compris droits de douane)')
      expect(labelOf('6037')).toBe('Variation de stocks (marchandises)')
      expect(labelOf('6031')).toBe('Variation de stocks (matières premières et approvisionnements)')
      expect(labelOf('757')).toBe("Produits des cessions d'immobilisations incorporelles et corporelles")
      expect(labelOf('657')).toBe('Valeurs comptables des immobilisations incorporelles et corporelles cédées')
    })
  }
})

// ── Consistency on random balanced ledgers (property test) ──────────────────

/** Deterministic PRNG (mulberry32). */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomLedger(seed: number): AccountTotals[] {
  const rnd = prng(seed)
  const codes = [...BALANCE_SHEET_CODES, ...INCOME_STATEMENT_CODES]
  // Depreciation and impairment accounts (28, 29, 39, 49, 59) one pick in four.
  const deductions = BALANCE_SHEET_CODES.filter((c) => /^(28|29|39|49|59)/.test(c))
  const pick = () =>
    rnd() < 0.25
      ? deductions[Math.floor(rnd() * deductions.length)]
      : codes[Math.floor(rnd() * codes.length)]
  const totals = new Map<string, AccountTotals>()
  const post = (code: string, debit: number, credit: number) => {
    const t = totals.get(code) ?? account(code, 0)
    t.debitCents += debit
    t.creditCents += credit
    totals.set(code, t)
  }
  const entries = 5 + Math.floor(rnd() * 60)
  for (let e = 0; e < entries; e++) {
    const lines = 2 + Math.floor(rnd() * 4)
    let net = 0
    for (let l = 0; l < lines - 1; l++) {
      const amount = 1 + Math.floor(rnd() * 5_000_000)
      if (rnd() < 0.5) {
        post(pick(), amount, 0)
        net += amount
      } else {
        post(pick(), 0, amount)
        net -= amount
      }
    }
    if (net > 0) post(pick(), 0, net)
    else if (net < 0) post(pick(), -net, 0)
  }
  return [...totals.values()]
}

describe.each(VARIANTS)('statements of random balanced ledgers (%s)', (variant) => {
  const bsRules = defaultBalanceSheetRules(variant)
  const isRules = defaultIncomeStatementRules(variant)

  it('balance (Actif = Passif) and carry the income statement result, for 300 ledgers', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const accounts = randomLedger(seed)
      const input = { companyId: 'c', fiscalYearId: 'fy', reportVariant: variant, accounts }
      const sheet = buildBalanceSheet({ ...input, rules: bsRules })
      const statement = buildIncomeStatement({ ...input, rules: isRules })
      expect(sheet.imbalance, `seed ${seed}`).toBeUndefined()
      expect(Math.round(sheet.actifTotal * 100), `seed ${seed}`).toBe(Math.round(sheet.passifTotal * 100))
      expect(statement.netResult, `seed ${seed}`).toBe(sheet.netResult)
      expect(statement.unmappedAccounts, `seed ${seed}`).toEqual([])
      expect(sheet.warnings, `seed ${seed}`).toEqual([])
      expect(statement.warnings, `seed ${seed}`).toEqual([])
      assertNetTotals(sheet, `seed ${seed}`)
      // Income statement: the totals are the sums of the leaf lines of each side.
      expect(Math.round((statement.totalProduits - statement.totalCharges) * 100), `seed ${seed}`).toBe(
        Math.round(statement.netResult * 100)
      )
    }
  })
})

type Sheet = ReturnType<typeof buildBalanceSheet>
type Line = Sheet['actif']['lines'][number]

/**
 * The actif total is the net total: gross minus depreciation, on every line
 * and for the side (PCG art. 821-1). It equals the sum of the lines' net.
 */
function assertNetTotals(sheet: Sheet, context: string) {
  const cents = (n: number | undefined) => Math.round((n ?? 0) * 100)
  const visit = (line: Line) => {
    if (line.brut !== undefined) {
      expect(cents(line.brut) - cents(line.amortissements), `${context}: ${line.lineLabel}`).toBe(cents(line.net))
    }
    for (const child of line.children ?? []) visit(child)
  }
  sheet.actif.lines.forEach(visit)
  expect(cents(sheet.actif.brutTotal) - cents(sheet.actif.amortissementsTotal), context).toBe(cents(sheet.actifTotal))
  expect(sheet.actif.lines.reduce((s, l) => s + cents(l.net), 0), context).toBe(cents(sheet.actifTotal))
  expect(sheet.passif.lines.reduce((s, l) => s + cents(l.net), 0), context).toBe(cents(sheet.passifTotal))
}

describe.each(VARIANTS)('fixed assets depreciated over two years (%s)', (variant) => {
  // 2025: computer 2 400 in service 01/03/2025, 646,58 depreciated (28183
  // credit brought forward by the AN entry). 2026: 800 more. Plus a
  // building with an impairment (2913), impaired stock (391), a doubtful
  // customer (491) and securities written down (590).
  const accounts: AccountTotals[] = [
    account('2183', 240_000),
    account('28183', 0, 64_658 + 80_000),
    account('6811', 80_000),
    account('213', 10_000_000),
    account('2813', 0, 1_500_000),
    account('2913', 0, 200_000),
    account('31', 500_000),
    account('391', 0, 50_000),
    account('411', 300_000),
    account('491', 0, 100_000),
    account('503', 200_000),
    account('590', 0, 20_000),
    account('512', 2_000_000),
    account('101', 0, 10_000_000),
    account('164', 0, 1_000_000),
    account('110', 0, 225_342),
    account('706', 0, 300_000),
    account('606', 220_000),
  ]
  const sheet = buildBalanceSheet({
    companyId: 'c',
    fiscalYearId: 'fy',
    reportVariant: variant,
    rules: defaultBalanceSheetRules(variant),
    accounts,
  })

  it('totals the actif on the net column', () => {
    expect(sheet.actif.brutTotal).toBe(2400 + 100000 + 5000 + 3000 + 2000 + 20000)
    expect(sheet.actif.amortissementsTotal).toBe(646.58 + 800 + 15000 + 2000 + 500 + 1000 + 200)
    expect(sheet.actifTotal).toBe(112253.42)
    expect(sheet.passifTotal).toBe(sheet.actifTotal)
    expect(sheet.imbalance).toBeUndefined()
    assertNetTotals(sheet, variant)
  })

  it('shows brut, amortissements and net on the asset lines', () => {
    const lines: Line[] = []
    const collect = (l: Line) => {
      lines.push(l)
      ;(l.children ?? []).forEach(collect)
    }
    sheet.actif.lines.forEach(collect)
    const computer = lines.find((l) => l.accounts.some((a) => a.code === '2183') && (l.children?.length ?? 0) === 0)!
    expect(computer.brut).toBe(variant === 'complete' ? 2400 : 102400)
    expect(computer.amortissements).toBe(variant === 'complete' ? 1446.58 : 1446.58 + 17000)
    expect(Math.round(computer.net * 100)).toBe(Math.round(computer.brut! * 100) - Math.round(computer.amortissements! * 100))
  })
})
