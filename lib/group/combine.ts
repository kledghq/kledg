/**
 * The combined view of a group (vue combinée) and its intragroup
 * eliminations. Pure, amounts in integer cents.
 *
 * What this is: the key figures of each company of the group, read in its
 * own books, added up at 100 % (agrégation), then the flows between two
 * companies of the combined perimeter removed once:
 * - operations: the revenue a company recorded on another company of the
 *   group (management fees, invoices) is removed from the produits, and the
 *   charge the other one recorded is removed from the charges. When both
 *   books agree, the combined result does not change and the chiffre
 *   d'affaires and the charges lose the flow; when they disagree, the
 *   difference is shown as an écart to justify (one side not booked, booked
 *   on another period or another amount);
 * - dividends a company received from another company of the group (761):
 *   removed from the combined result, since the payer's result is already
 *   in it;
 * - reciprocal balances: a receivable of one company on another (411, 451,
 *   455, 267...) against the payable the other one records (401, 451,
 *   455...): the smaller of the two is removed from the combined balance
 *   sheet total, on both sides; the difference is an écart.
 *
 * What this is not: consolidated accounts. Legal consolidation follows
 * règlement ANC 2020-01 (full integration, proportional integration or the
 * equity method by the kind of control, elimination of the titres against
 * the equity of the subsidiaries, intérêts minoritaires, écarts
 * d'acquisition) and is required above the thresholds of the Code de
 * commerce, art. L233-16 and L233-17. None of that is done here: the titres
 * de participation stay in the combined assets, the minority interests are
 * not separated, indirect holdings are not followed. Multiplying each
 * company by its ownership percentage would not be a consolidation either:
 * the percentage is shown here, never applied.
 *
 * A flow with a company outside the combined perimeter (a subsidiary the
 * user cannot read, a company outside the group) is not eliminated: its
 * other side is not in the totals.
 */

import { sigBucketOf, type SigBucket } from '@/lib/reports/financial-indicators/sig'

export interface KeyFigures {
  /** Comptes 70, credit minus debit (SIG). */
  chiffreAffairesCents: number
  /** Excédent brut d'exploitation (SIG). */
  ebeCents: number
  /** Résultat de l'exercice. */
  resultatCents: number
  /** Balance of the bank accounts (512) at the end of the period. */
  tresorerieCents: number
  /** Capitaux propres, result of the year included (bilan, total DL). */
  capitauxPropresCents: number
  /** Dettes financières: emprunts and dettes financières diverses, without bank overdrafts. */
  endettementCents: number
  /** Total of the balance sheet (actif net = passif). */
  totalBilanCents: number
}

export const ZERO_FIGURES: KeyFigures = Object.freeze({
  chiffreAffairesCents: 0,
  ebeCents: 0,
  resultatCents: 0,
  tresorerieCents: 0,
  capitauxPropresCents: 0,
  endettementCents: 0,
  totalBilanCents: 0,
})

const KEYS = Object.keys(ZERO_FIGURES) as Array<keyof KeyFigures>

/** Sum of the figures, field by field (agrégation at 100 %). */
export function sumFigures(list: ReadonlyArray<KeyFigures>): KeyFigures {
  const total = { ...ZERO_FIGURES }
  for (const figures of list) for (const key of KEYS) total[key] += figures[key]
  return total
}

export type FlowCategory = 'management_fee' | 'invoice' | 'dividend' | 'current_account' | 'trade' | 'loan'

/**
 * A line of one company's books about another company of the group.
 * Operations: an account of class 6 or 7 and its amount over the period
 * (charges debit minus credit, produits credit minus debit). Balances: an
 * account of class 1 to 5 and its balance at the end of the period, debit
 * minus credit (positive: a receivable, negative: a payable).
 */
export interface IntragroupObservation {
  /** Whose books. */
  companyId: string
  /** The other company of the group. */
  counterpartyId: string
  category: FlowCategory
  accountCode: string
  cents: number
  /** How the counterparty was recognised: tiers SIREN, account label or entry description, invoice. */
  source: 'tiers' | 'label' | 'invoice'
  /** What the user can look up: invoice number, account and label. */
  reference: string
  /**
   * Whether the amount is in the validated books the figures come from. A
   * management fee billing whose invoice is still a draft is shown, never
   * eliminated.
   */
  inBooks: boolean
}

export interface OperationPair {
  sellerId: string
  buyerId: string
  categories: FlowCategory[]
  /** Produits recorded by the seller on the buyer. */
  revenueCents: number
  /** Charges recorded by the buyer on the seller. */
  chargeCents: number
  /** revenue - charge: zero when both books agree. */
  gapCents: number
}

export interface DividendFlow {
  receiverId: string
  payerId: string
  cents: number
}

export interface BalancePair {
  creditorId: string
  debtorId: string
  categories: FlowCategory[]
  /** Receivable the creditor records on the debtor. */
  receivableCents: number
  /** Payable the debtor records to the creditor. */
  payableCents: number
  /** The smaller of the two, removed from both sides of the combined balance sheet. */
  eliminatedCents: number
  /** receivable - payable. */
  gapCents: number
}

export interface Eliminations {
  operations: OperationPair[]
  dividends: DividendFlow[]
  balances: BalancePair[]
  /** What the eliminations add to the combined figures (negative or zero, except an écart). */
  effect: KeyFigures
}

/** SIG buckets that make up the excédent brut d'exploitation (sig.ts, computeSig). */
const EBE_BUCKETS = new Set<SigBucket>([
  'ventesMarchandises',
  'coutMarchandises',
  'productionVendue',
  'productionStockee',
  'productionImmobilisee',
  'consommationsTiers',
  'subventionsExploitation',
  'impotsTaxes',
  'chargesPersonnel',
])

const isOperation = (code: string) => code.startsWith('6') || code.startsWith('7')
const pairKey = (a: string, b: string) => `${a}\u0000${b}`

function pushCategory(list: FlowCategory[], category: FlowCategory) {
  if (!list.includes(category)) list.push(category)
}

/**
 * The eliminations of the observations whose two companies are both in
 * `perimeter` (the companies whose figures are combined).
 */
export function computeEliminations(observations: ReadonlyArray<IntragroupObservation>, perimeter: ReadonlySet<string>): Eliminations {
  const effect = { ...ZERO_FIGURES }
  const operations = new Map<string, OperationPair>()
  const dividends = new Map<string, DividendFlow>()
  const receivables = new Map<string, { cents: number; categories: FlowCategory[] }>()
  // debtCents: the part of a payable on dettes financières (16), which the endettement figure counts.
  const payables = new Map<string, { cents: number; debtCents: number; categories: FlowCategory[] }>()

  for (const o of observations) {
    if (!o.inBooks || o.companyId === o.counterpartyId) continue
    if (!perimeter.has(o.companyId) || !perimeter.has(o.counterpartyId)) continue

    if (isOperation(o.accountCode)) {
      const product = o.accountCode.startsWith('7')
      const ebe = EBE_BUCKETS.has(sigBucketOf(o.accountCode) as SigBucket)
      if (product) {
        // A produit leaves the combined figures: chiffre d'affaires (70), EBE (operating products), result.
        if (o.accountCode.startsWith('70')) effect.chiffreAffairesCents -= o.cents
        if (ebe) effect.ebeCents -= o.cents
        effect.resultatCents -= o.cents
      } else {
        if (ebe) effect.ebeCents += o.cents
        effect.resultatCents += o.cents
      }
      if (o.category === 'dividend') {
        const key = pairKey(o.companyId, o.counterpartyId)
        const flow = dividends.get(key) ?? { receiverId: o.companyId, payerId: o.counterpartyId, cents: 0 }
        flow.cents += product ? o.cents : -o.cents
        dividends.set(key, flow)
        continue
      }
      const [sellerId, buyerId] = product ? [o.companyId, o.counterpartyId] : [o.counterpartyId, o.companyId]
      const key = pairKey(sellerId, buyerId)
      const pair = operations.get(key) ?? { sellerId, buyerId, categories: [], revenueCents: 0, chargeCents: 0, gapCents: 0 }
      if (product) pair.revenueCents += o.cents
      else pair.chargeCents += o.cents
      pushCategory(pair.categories, o.category)
      operations.set(key, pair)
      continue
    }

    // Balances: a debit balance is a receivable on the counterparty, a credit balance a payable to it.
    if (o.cents > 0) {
      const key = pairKey(o.companyId, o.counterpartyId)
      const entry = receivables.get(key) ?? { cents: 0, categories: [] }
      entry.cents += o.cents
      pushCategory(entry.categories, o.category)
      receivables.set(key, entry)
    } else if (o.cents < 0) {
      const key = pairKey(o.counterpartyId, o.companyId)
      const entry = payables.get(key) ?? { cents: 0, debtCents: 0, categories: [] }
      entry.cents -= o.cents
      if (o.accountCode.startsWith('16')) entry.debtCents -= o.cents
      pushCategory(entry.categories, o.category)
      payables.set(key, entry)
    }
  }

  const balances: BalancePair[] = []
  for (const key of new Set([...receivables.keys(), ...payables.keys()])) {
    const [creditorId, debtorId] = key.split('\u0000')
    const receivable = receivables.get(key)
    const payable = payables.get(key)
    const receivableCents = receivable?.cents ?? 0
    const payableCents = payable?.cents ?? 0
    const eliminatedCents = Math.min(receivableCents, payableCents)
    const categories: FlowCategory[] = []
    for (const c of [...(receivable?.categories ?? []), ...(payable?.categories ?? [])]) pushCategory(categories, c)
    balances.push({ creditorId, debtorId, categories, receivableCents, payableCents, eliminatedCents, gapCents: receivableCents - payableCents })
    effect.totalBilanCents -= eliminatedCents
    effect.endettementCents -= Math.min(eliminatedCents, payable?.debtCents ?? 0)
  }

  const pairs = [...operations.values()].map((p) => ({ ...p, gapCents: p.revenueCents - p.chargeCents }))
  const byIds = <T>(ids: (x: T) => string) => (a: T, b: T) => ids(a).localeCompare(ids(b))
  return {
    operations: pairs.sort(byIds((p) => p.sellerId + p.buyerId)),
    dividends: [...dividends.values()].sort(byIds((d) => d.receiverId + d.payerId)),
    balances: balances.sort(byIds((b) => b.creditorId + b.debtorId)),
    effect,
  }
}

/** The combined figures after the eliminations. */
export function applyEliminations(combined: KeyFigures, effect: KeyFigures): KeyFigures {
  const after = { ...combined }
  for (const key of KEYS) after[key] += effect[key]
  return after
}
