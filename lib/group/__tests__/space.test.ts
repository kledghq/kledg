/**
 * The pure rules of the group space (docs/vue-groupe.md), with worked
 * examples: the aggregation of the books and its indicators, the direct and
 * indirect holdings, the merge of the transactions of several companies page
 * by page, the tracker summed up by kind, the combined ledger, the treasury
 * helpers. The database tests (app/api/__tests__/group-space-routes.db.test.ts)
 * run the services on real books.
 */

import { describe, expect, it, vi } from 'vitest'

// The services' modules are imported for their pure helpers only.
vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
import { aggregateAccountTotals, sumVatFlows } from '../aggregate'
import { columnOf, summarizeDeadlines } from '../deadline-summary'
import { officersOf } from '../get-group-companies.service'
import { sumMonth } from '../get-group-evolution.service'
import { aggregateIndicators } from '../get-group-indicators.service'
import { combineLedger } from '../get-group-ledger.service'
import { personKey } from '../get-group-persons.service'
import { maskIban, totalsByCurrency } from '../get-group-treasury.service'
import { compareKeys, decodeCursor, encodeCursor, mergePages } from '../merge-pages'
import { companyKey, computeInterests } from '../ownership'

describe('aggregation of the books (agrégation, not consolidation)', () => {
  // Holding H and subsidiary A, in euros:
  //   H: management fees invoiced to A 30 000 (706), salaries 10 000 (641), bank 50 000 (512)
  //   A: sales 200 000 (706), the fees 30 000 (6226), purchases 90 000 (607), bank 20 000 (512),
  //      an overdraft on a second bank account 5 000 (512100 in credit)
  const holding = [
    { code: '706000', label: 'Prestations', debitCents: 0, creditCents: 3_000_000 },
    { code: '641000', label: 'Salaires', debitCents: 1_000_000, creditCents: 0 },
    { code: '512000', label: 'Banque', debitCents: 5_000_000, creditCents: 0 },
  ]
  const subsidiary = [
    { code: '706000', label: 'Ventes', debitCents: 0, creditCents: 20_000_000 },
    { code: '622600', label: 'Honoraires', debitCents: 3_000_000, creditCents: 0 },
    { code: '607000', label: 'Achats', debitCents: 9_000_000, creditCents: 0 },
    { code: '512000', label: 'Banque A', debitCents: 2_000_000, creditCents: 0 },
    { code: '512100', label: 'Banque B', debitCents: 0, creditCents: 500_000 },
  ]

  it('adds the accounts up by number, debits with debits and credits with credits', () => {
    expect(aggregateAccountTotals([holding, subsidiary])).toEqual([
      { code: '512000', label: 'Banque', debitCents: 7_000_000, creditCents: 0 },
      { code: '512100', label: 'Banque B', debitCents: 0, creditCents: 500_000 },
      { code: '607000', label: 'Achats', debitCents: 9_000_000, creditCents: 0 },
      { code: '622600', label: 'Honoraires', debitCents: 3_000_000, creditCents: 0 },
      { code: '641000', label: 'Salaires', debitCents: 1_000_000, creditCents: 0 },
      { code: '706000', label: 'Prestations', debitCents: 0, creditCents: 23_000_000 },
    ])
  })

  it('computes the indicators of the sum, intragroup fees left on both sides', () => {
    const indicators = aggregateIndicators(
      [
        { accounts: holding, vat: { collecteeCents: 600_000, deductibleCents: 0 } },
        { accounts: subsidiary, vat: { collecteeCents: 4_000_000, deductibleCents: 2_400_000 } },
      ],
      365,
    )
    // CA 230 000 (the 30 000 of fees included: not eliminated in the aggregate).
    expect(indicators?.sig.chiffreAffairesCents).toBe(23_000_000)
    // Result 230 000 - 10 000 - 30 000 - 90 000 = 100 000.
    expect(indicators?.sig.resultatExerciceCents).toBe(10_000_000)
    // Net margin of the sum: 100 000 / 230 000 = 43.48 %, not the average of the companies' margins.
    expect(indicators?.ratios.margeNette).toBe(0.4348)
    // The overdraft stays a bank overdraft: net cash = 70 000 - 5 000.
    expect(indicators?.bilan.tresorerieNetteCents).toBe(6_500_000)
    expect(sumVatFlows([{ collecteeCents: 1, deductibleCents: 2 }, { collecteeCents: 3, deductibleCents: 4 }])).toEqual({ collecteeCents: 4, deductibleCents: 6 })
  })

  it('has no aggregate without any company read', () => {
    expect(aggregateIndicators([], 365)).toBeNull()
  })
})

describe('direct and indirect holdings', () => {
  // Claire holds 60 % of the holding H. H holds 80 % of A and 40 % of B; A holds 10 % of B.
  // Marc holds 40 % of H and 5 % of B directly.
  const edges = [
    { holderKey: 'person:claire', companyId: 'H', bp: 6000 },
    { holderKey: 'person:marc', companyId: 'H', bp: 4000 },
    { holderKey: 'person:marc', companyId: 'B', bp: 500 },
    { holderKey: companyKey('H'), companyId: 'A', bp: 8000 },
    { holderKey: companyKey('H'), companyId: 'B', bp: 4000 },
    { holderKey: companyKey('A'), companyId: 'B', bp: 1000 },
  ]
  const interests = computeInterests(edges, ['H', 'A', 'B'])

  it('multiplies the percentages along each chain and adds the chains', () => {
    // Claire in A: 60 % x 80 % = 48 %.
    expect(interests.get('person:claire')?.get('A')).toEqual({ directBp: 0, indirectBp: 4800, totalBp: 4800 })
    // Claire in B: 60 % x (40 % + 80 % x 10 %) = 60 % x 48 % = 28.8 %.
    expect(interests.get('person:claire')?.get('B')).toEqual({ directBp: 0, indirectBp: 2880, totalBp: 2880 })
    expect(interests.get('person:claire')?.get('H')).toEqual({ directBp: 6000, indirectBp: 0, totalBp: 6000 })
  })

  it('adds a direct holding to the indirect one', () => {
    // Marc in B: 5 % direct + 40 % x 48 % = 5 % + 19.2 %.
    expect(interests.get('person:marc')?.get('B')).toEqual({ directBp: 500, indirectBp: 1920, totalBp: 2420 })
  })

  it("gives the holding's own interest through its subsidiaries", () => {
    // H in B: 40 % direct + 80 % x 10 % through A.
    expect(interests.get(companyKey('H'))?.get('B')).toEqual({ directBp: 4000, indirectBp: 800, totalBp: 4800 })
    // A company never holds itself.
    expect(interests.get(companyKey('H'))?.has('H')).toBe(false)
  })

  it('cuts cycles and ignores companies outside the group', () => {
    const cyclic = computeInterests(
      [
        { holderKey: 'person:p', companyId: 'X', bp: 10_000 },
        { holderKey: companyKey('X'), companyId: 'Y', bp: 5000 },
        { holderKey: companyKey('Y'), companyId: 'X', bp: 5000 },
        { holderKey: 'person:p', companyId: 'OUT', bp: 10_000 },
      ],
      ['X', 'Y'],
    )
    expect(cyclic.get('person:p')?.get('Y')).toEqual({ directBp: 0, indirectBp: 5000, totalBp: 5000 })
    expect(cyclic.get('person:p')?.has('OUT')).toBe(false)
  })

  it('merges a person recorded in two companies by email, else by name', () => {
    expect(personKey({ email: 'Claire@Exemple.fr ', firstName: 'Claire', name: 'Vasseur', usualName: null })).toBe('person:claire@exemple.fr')
    expect(personKey({ email: null, firstName: 'Hélène', name: 'GARNIER', usualName: null })).toBe(personKey({ email: null, firstName: 'helene', name: 'Garnier', usualName: null }))
  })
})

describe('transactions of several companies, page by page', () => {
  type Tx = { id: string; at: string }
  const key = (t: Tx) => ({ date: t.at, id: t.id })
  const a: Tx[] = [
    { id: 'a3', at: '2026-03-10T00:00:00.000Z' },
    { id: 'a2', at: '2026-03-05T00:00:00.000Z' },
    { id: 'a1', at: '2026-03-01T00:00:00.000Z' },
  ]
  const b: Tx[] = [
    { id: 'b2', at: '2026-03-05T00:00:00.000Z' },
    { id: 'b1', at: '2026-03-02T00:00:00.000Z' },
  ]
  /** What each company answers after a cursor: its rows after the key, `limit + 1` at most. */
  const after = (rows: Tx[], cursor: string | null, limit: number) => {
    const from = decodeCursor(cursor)
    return rows.filter((r) => !from || compareKeys(key(r), from) > 0).slice(0, limit + 1)
  }

  it('merges newest first, ties broken by id, and pages without loss nor repeat', () => {
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page: { items: Tx[]; nextCursor: string | null } = mergePages([after(a, cursor, 2), after(b, cursor, 2)], 2, key)
      seen.push(...page.items.map((t) => t.id))
      cursor = page.nextCursor
      pages += 1
    } while (cursor && pages < 10)
    expect(seen).toEqual(['a3', 'b2', 'a2', 'b1', 'a1'])
    expect(pages).toBe(3)
  })

  it('reads back only its own cursors', () => {
    expect(decodeCursor(encodeCursor({ date: '2026-03-05T00:00:00.000Z', id: 'x' }))).toEqual({ date: '2026-03-05T00:00:00.000Z', id: 'x' })
    expect(decodeCursor('not-a-cursor')).toBeNull()
    expect(decodeCursor(Buffer.from('["nope","x"]').toString('base64url'))).toBeNull()
  })
})

describe('the tracker of the group, by kind', () => {
  const d = (ruleId: string, category: 'tva' | 'is' | 'liasse' | 'cfe' | 'cvae' | 'juridique', status: 'todo' | 'filed' | 'paid' | 'overdue' | 'not-due', settled: boolean) => ({
    ruleId,
    category,
    status: { status, settled },
  })

  it('puts each deadline in its column', () => {
    expect(columnOf({ ruleId: 'tva-ca3', category: 'tva' })).toBe('tva')
    expect(columnOf({ ruleId: 'liasse', category: 'liasse' })).toBe('is')
    expect(columnOf({ ruleId: 'das2', category: 'liasse' })).toBe('other')
    expect(columnOf({ ruleId: 'cvae', category: 'cvae' })).toBe('cfe')
    expect(columnOf({ ruleId: 'approbation', category: 'juridique' })).toBe('approval')
    expect(columnOf({ ruleId: 'depot-comptes', category: 'juridique' })).toBe('approval')
  })

  it('counts settled, overdue and pending deadlines, the worst status first', () => {
    const summary = summarizeDeadlines([
      d('tva-ca3', 'tva', 'paid', true),
      d('tva-ca3', 'tva', 'overdue', false),
      d('tva-ca3', 'tva', 'todo', false),
      d('is-acompte', 'is', 'not-due', true),
      d('is-solde', 'is', 'filed', false),
      d('approbation', 'juridique', 'filed', true),
    ])
    expect(summary.tva).toEqual({ total: 3, settled: 1, overdue: 1, pending: 1, status: 'overdue' })
    expect(summary.is).toEqual({ total: 2, settled: 1, overdue: 0, pending: 1, status: 'pending' })
    expect(summary.approval).toEqual({ total: 1, settled: 1, overdue: 0, pending: 0, status: 'settled' })
    expect(summary.cfe.status).toBeNull()
  })
})

describe('combined ledger, evolution and treasury', () => {
  it('lists each account number with each company and the sum', () => {
    const rows = combineLedger([
      { companyId: 'h', accounts: [{ code: '512000', label: 'Banque', debitCents: 1000, creditCents: 300 }, { code: '401000', label: 'Fournisseurs', debitCents: 0, creditCents: 0 }] },
      { companyId: 's', accounts: [{ code: '512000', label: 'Banque S', debitCents: 50, creditCents: 0 }] },
    ])
    expect(rows).toEqual([
      {
        code: '512000',
        label: 'Banque',
        byCompany: { h: { debitCents: 1000, creditCents: 300, balanceCents: 700 }, s: { debitCents: 50, creditCents: 0, balanceCents: 50 } },
        total: { debitCents: 1050, creditCents: 300, balanceCents: 750 },
      },
    ])
  })

  it('sums a month, the cash of the companies that have a fiscal year only', () => {
    expect(
      sumMonth([
        { produitsCents: 100, chargesCents: 40, resultatCents: 60, tresorerieCents: 500 },
        { produitsCents: 10, chargesCents: 20, resultatCents: -10, tresorerieCents: null },
      ]),
    ).toEqual({ produitsCents: 110, chargesCents: 60, resultatCents: 50, tresorerieCents: 500 })
    expect(sumMonth([{ produitsCents: 0, chargesCents: 0, resultatCents: 0, tresorerieCents: null }]).tresorerieCents).toBeNull()
  })

  it('masks the IBAN and adds the balances up by currency, euros first', () => {
    expect(maskIban('FR76 3000 6000 0112 3456 7890 189')).toBe('FR76 •••• 0189')
    expect(maskIban(null)).toBeNull()
    expect(totalsByCurrency([{ currency: 'USD', balanceCents: 5 }, { currency: 'EUR', balanceCents: 10 }, { currency: 'EUR', balanceCents: -3 }])).toEqual([
      { currency: 'EUR', balanceCents: 7 },
      { currency: 'USD', balanceCents: 5 },
    ])
  })

  it('reads the officers of an approval, leaving the malformed ones out', () => {
    expect(officersOf({ officers: [{ name: ' Claire Vasseur ', title: 'Présidente' }, { name: '' }, { title: 'x' }, 'bad'] })).toEqual([{ name: 'Claire Vasseur', title: 'Présidente' }])
    expect(officersOf(null)).toEqual([])
  })
})
