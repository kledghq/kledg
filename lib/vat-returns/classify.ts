/**
 * Reads the validated entries of a VAT period and sorts their VAT lines
 * into what a return declares. Pure (plain values, cents): the loader
 * (load-vat-return.service.ts) feeds it, the unit tests feed it worked
 * examples.
 *
 * Accounts (PCG art. 944-44, list of accounts art. 932-1; a subdivision
 * counts as its root, 445710 is 44571):
 * - 4457 "Taxes sur le chiffre d'affaires collectées" (44571, except 44574
 *   and 44578): VAT due on sales. 44574 "TVA collectée en attente
 *   d'encaissement" is not due yet (services, CGI art. 269, 2, c): it
 *   becomes due when the invoice payment moves it to 44571
 *   (lib/invoices/invoice-payments.service.ts), so only 44571 is declared;
 * - 4452 "TVA due intracommunautaire": VAT the company self-assesses
 *   (autoliquidation, CGI art. 283, 2: services of a supplier not
 *   established in France; art. 256 bis: intra-Community acquisitions of
 *   goods). The deductible side is on 4456 in the same entry;
 * - 44562 "TVA sur immobilisations", 44566 "TVA sur autres biens et
 *   services": deductible VAT (CA3 lines 19 and 20, CA12 lines 23 and 20);
 * - 44563 "TVA transférée par d'autres entités": other VAT to deduct
 *   (CA3 line 21, CA12 line 25);
 * - 44567 "Crédit de TVA à reporter": the credit carried forward, read from
 *   its balance before the period by the loader, not from the period;
 * - 44581 "Acomptes, régime simplifié d'imposition": acomptes paid (CA12
 *   line 30);
 * - 4455 "Taxes sur le chiffre d'affaires à décaisser": the settlement of a
 *   return and its payment, never an operation of the period;
 * - 44586 and 44587 (VAT on invoices not received or to issue): accruals
 *   of a closing, not due yet, left out;
 * - any other 445 account (44568 and 44578 taxes assimilées, 44583
 *   refund requested, 44584...) is reported as not handled.
 *
 * Signs, as the forms want them (notices 3310-CA3-SD and 3517-S-SD: never a
 * negative amount on a line):
 * - collected VAT of an entry below zero (a sales credit note) is a
 *   regularisation: its base on CA3 line B5, its VAT on CA3 line 21 or
 *   CA12 line 25 ("taxe acquittée sur des opérations pour lesquelles une
 *   réduction de prix a été consentie");
 * - deductible VAT below zero (a supplier credit note) is VAT previously
 *   deducted to pay back: CA3 line 15, CA12 line 18.
 * - the regularisation of the coefficient de déduction (reference
 *   "COEF-TVA-", lib/vat-deduction): a complement of deduction goes to CA3
 *   line 21 (CA12 line 25), a reversement to CA3 line 15 (CA12 line 18)
 *   (notices 2026: "complément de déduction résultant des variations du
 *   pourcentage de déduction").
 *
 * Rates: the ledger holds amounts, not rates. The rate of an entry's
 * collected VAT is, in order:
 * 1. a sales invoice posted by Kledg: its VAT breakdown per rate, and its
 *    lines (goods or services) for the part due now when services wait on
 *    44574, split exactly as the posting plan split it
 *    (lib/invoices/posting-plan.ts);
 * 2. the VAT moved from 44574 to 44571 by an invoice payment: the pending
 *    VAT of that invoice per rate, in proportion;
 * 3. otherwise the ratio of the VAT to the entry's revenue (class 7) or,
 *    for autoliquidation, expense and fixed asset (classes 6 and 2) lines:
 *    the one French rate (20, 10, 5,5 or 2,1 %, CGI art. 278 to 281
 *    nonies) whose VAT on that base matches within one cent per line.
 * When none fits (several rates in one entry without an invoice), the
 * amount stays in an "unidentified" bucket: counted in the total, listed
 * for the user to split by hand, and the checks say so.
 */

import { allocateCents, vatOnBaseCents } from '@/lib/invoices/amounts'
import { REGULARISATION_REFERENCE_PREFIX } from '@/lib/vat-deduction/rules'

/** Rates of the metropolitan lines of the CA3 (08, 9B, 09, T6) and the CA12 (5A, 6C, 06, 09). */
export const DECLARED_RATES_BP = [2000, 1000, 550, 210] as const
export type DeclaredRate = (typeof DECLARED_RATES_BP)[number]

export interface VatEntryLine {
  code: string
  debitCents: number
  creditCents: number
}

/** An invoice line as the posting plan saw it. */
export interface VatInvoiceLine {
  rateBp: number
  baseCents: number
  nature: 'GOODS' | 'SERVICES'
}

export interface VatInvoiceSource {
  lines: VatInvoiceLine[]
  breakdown: Array<{ rateBp: number; baseCents: number; vatCents: number }>
}

export interface VatEntry {
  id: string
  number: string
  date: string
  journalCode: string
  reference: string | null
  lines: VatEntryLine[]
  /** The sales invoice this entry posts. */
  invoice?: VatInvoiceSource | null
  /** The sales invoices whose pending VAT this entry moves from 44574 to 44571 (one per payment). */
  vatTransferOf?: VatInvoiceSource[]
}

export interface RateBucket {
  rateBp: number
  baseCents: number
  vatCents: number
}

export interface UnidentifiedEntry {
  id: string
  number: string
  date: string
  vatCents: number
  baseCents: number
  kind: 'collected' | 'autoliquidation'
}

export interface UnhandledAccount {
  code: string
  /** Debit minus credit over the period. */
  netCents: number
  entries: number
}

export interface VatMovements {
  /** Sales taxed in France, by rate (CA3 A1 and lines 08 to T6; CA12 lines 5A to 09). */
  collected: RateBucket[]
  /** Self-assessed acquisitions of goods (intra-Community, CA3 B2 and line 17). */
  autoliquidationGoods: RateBucket[]
  /** Self-assessed services of a supplier not established in France (CA3 A3, CA12 AC). */
  autoliquidationServices: RateBucket[]
  /** Collected or self-assessed VAT whose rate could not be read. */
  unidentified: UnidentifiedEntry[]
  /** Sales credit notes: base (CA3 B5) and VAT (CA3 21, CA12 25), as positive amounts. */
  salesCreditNotes: { baseCents: number; vatCents: number }
  /** Self-assessed VAT cancelled (credit note of an acquisition): CA3 21, CA12 25. */
  autoliquidationReversalCents: number
  deductibleFixedAssetsCents: number
  deductibleOtherCents: number
  /** 44563 "TVA transférée par d'autres entités": CA3 21, CA12 25. */
  transferredDeductibleCents: number
  /** Supplier credit notes: VAT previously deducted to pay back (CA3 15, CA12 18). */
  deductibleReversalCents: number
  /** Complement of deduction of a coefficient regularisation (CA3 21, CA12 25). */
  coefficientComplementCents: number
  /** Sales (70) without any VAT: exports, intra-Community supplies, exempt sales, to split by hand (CA3 E1, E2, F2; CA12 02, 03, 04). */
  nonTaxedSalesCents: number
  /** VAT credited to 44574 in the period, due when the customers pay (informative). */
  pendingCollectedCents: number
  /** Acomptes of the réel simplifié paid (44581 debits): CA12 line 30. */
  acomptesPaidCents: number
  /** Movements on VAT accounts the return does not read. */
  unhandled: UnhandledAccount[]
  /** Net movements per account group, for the balance checks: collected and 4452 credit minus debit, deductible debit minus credit. */
  groups: { collected: number; autoliquidation: number; deductibleFixedAssets: number; deductibleOther: number }
  /** Entries read (validated, not opening, closing or settlement). */
  entries: number
}

/** Settlement entries prepared by Kledg carry this reference prefix ("TVA-CA3-2026-09"). */
export const SETTLEMENT_REFERENCE_PREFIX = 'TVA-'

const starts = (code: string, ...roots: string[]) => roots.some((root) => code.startsWith(root))

export const isCollectedCode = (code: string) => code.startsWith('4457') && !starts(code, '44574', '44578')
export const isPendingCode = (code: string) => code.startsWith('44574')
export const isAutoliquidationCode = (code: string) => code.startsWith('4452')
export const isDeductibleFixedAssetsCode = (code: string) => code.startsWith('44562')
export const isDeductibleOtherCode = (code: string) => code.startsWith('44566') || code === '4456'
export const isTransferredCode = (code: string) => code.startsWith('44563')
export const isCreditCarriedCode = (code: string) => code.startsWith('44567')
export const isAcompteCode = (code: string) => code.startsWith('44581')
export const isToPayCode = (code: string) => code.startsWith('4455')
const isAccrualCode = (code: string) => starts(code, '44586', '44587')

/** Opening (AN) and closing (CL) entries carry balances, not operations of the period. */
export function isBalanceEntry(entry: Pick<VatEntry, 'journalCode' | 'reference'>): boolean {
  return entry.journalCode === 'AN' || entry.journalCode === 'CL' || (entry.reference?.startsWith('CL-') ?? false)
}

/**
 * A settlement of a return, or its payment: an entry prepared by Kledg, an
 * entry on 4455 (VAT to pay and its payment), or one moving 44567 together
 * with collected or deductible VAT (a settlement ending in a credit).
 */
export function isSettlementEntry(entry: Pick<VatEntry, 'reference' | 'lines'>): boolean {
  if (entry.reference?.startsWith(SETTLEMENT_REFERENCE_PREFIX)) return true
  const codes = entry.lines.map((l) => l.code)
  if (codes.some(isToPayCode)) return true
  return codes.some(isCreditCarriedCode) && codes.some((c) => isCollectedCode(c) || isDeductibleFixedAssetsCode(c) || isDeductibleOtherCode(c))
}

/** Round half up of a x b / c on non-negative integers (BigInt, exact). */
export function mulDiv(a: number, b: number, c: number): number {
  if (c === 0) return 0
  const n = BigInt(a) * BigInt(b) * BigInt(2) + BigInt(c)
  return Number(n / (BigInt(c) * BigInt(2)))
}

/**
 * The one declared rate whose VAT on `baseCents` is `vatCents` within
 * `tolerance` cents; null when none or several fit.
 */
export function inferRate(vatCents: number, baseCents: number, tolerance = 1): DeclaredRate | null {
  if (vatCents <= 0 || baseCents <= 0) return null
  const fits = DECLARED_RATES_BP.filter((rate) => Math.abs(vatOnBaseCents(baseCents, rate) - vatCents) <= tolerance)
  return fits.length === 1 ? fits[0] : null
}

interface InvoiceRateSplit {
  rateBp: number
  /** Due now (44571): base and VAT. */
  dueBaseCents: number
  dueVatCents: number
  /** Waiting on 44574 (services without the option for debits): base and VAT. */
  pendingBaseCents: number
  pendingVatCents: number
}

/**
 * Per rate, the VAT of an invoice split between 44571 and 44574 exactly as
 * planInvoiceEntry split it: the VAT of the rate allocated in proportion to
 * the bases of goods (due now) and services (pending), remainder to the
 * largest (allocateCents). `servicesPending` false: everything due now.
 */
export function splitInvoiceVat(invoice: VatInvoiceSource, servicesPending: boolean): InvoiceRateSplit[] {
  return invoice.breakdown
    .filter((row) => row.vatCents !== 0)
    .map((row) => {
      if (!servicesPending) return { rateBp: row.rateBp, dueBaseCents: row.baseCents, dueVatCents: row.vatCents, pendingBaseCents: 0, pendingVatCents: 0 }
      const at = invoice.lines.filter((l) => l.rateBp === row.rateBp)
      const goods = at.filter((l) => l.nature === 'GOODS').reduce((s, l) => s + l.baseCents, 0)
      const services = at.filter((l) => l.nature === 'SERVICES').reduce((s, l) => s + l.baseCents, 0)
      const [dueVat, pendingVat] = allocateCents(row.vatCents, [goods, services])
      // Lines that do not add up to the breakdown (an imported document): bases in the same proportion.
      const dueBase = goods + services === 0 ? row.baseCents : goods + services === row.baseCents ? goods : mulDiv(row.baseCents, goods, goods + services)
      return { rateBp: row.rateBp, dueBaseCents: dueBase, dueVatCents: dueVat, pendingBaseCents: row.baseCents - dueBase, pendingVatCents: pendingVat }
    })
}

/** Base and VAT per rate of `vatCents` moved from 44574 to 44571 for these invoices, in proportion to their pending VAT. */
export function splitTransferredVat(invoices: VatInvoiceSource[], vatCents: number): RateBucket[] | null {
  const pending = invoices.flatMap((inv) => splitInvoiceVat(inv, true)).filter((r) => r.pendingVatCents > 0)
  const total = pending.reduce((s, r) => s + r.pendingVatCents, 0)
  if (total === 0 || vatCents <= 0 || vatCents > total) return null
  const shares = allocateCents(vatCents, pending.map((r) => r.pendingVatCents))
  return mergeBuckets(
    pending.map((r, i) => ({ rateBp: r.rateBp, vatCents: shares[i], baseCents: mulDiv(r.pendingBaseCents, shares[i], r.pendingVatCents) })),
  )
}

function mergeBuckets(buckets: RateBucket[]): RateBucket[] {
  const byRate = new Map<number, RateBucket>()
  for (const b of buckets) {
    if (b.vatCents === 0 && b.baseCents === 0) continue
    const current = byRate.get(b.rateBp) ?? { rateBp: b.rateBp, baseCents: 0, vatCents: 0 }
    current.baseCents += b.baseCents
    current.vatCents += b.vatCents
    byRate.set(b.rateBp, current)
  }
  return [...byRate.values()].sort((a, b) => b.rateBp - a.rateBp)
}

function addTo(target: RateBucket[], buckets: RateBucket[]) {
  for (const b of buckets) {
    const current = target.find((t) => t.rateBp === b.rateBp)
    if (current) {
      current.baseCents += b.baseCents
      current.vatCents += b.vatCents
    } else {
      target.push({ ...b })
    }
  }
  target.sort((a, b) => b.rateBp - a.rateBp)
}

const net = (lines: VatEntryLine[], test: (code: string) => boolean) =>
  lines.filter((l) => test(l.code)).reduce((s, l) => s + l.debitCents - l.creditCents, 0)

/** Goods for the intra-Community acquisition lines: purchases (60, except 604 "achats d'études et prestations de services") and fixed assets (2). */
const isGoodsPurchase = (code: string) => (code.startsWith('60') && !starts(code, '604')) || code.startsWith('2')

/** The rate split of collected VAT `vatCents` (> 0) due in this entry, or null. */
function collectedSplit(entry: VatEntry, vatCents: number, revenueCents: number): RateBucket[] | null {
  const hasPending = entry.lines.some((l) => isPendingCode(l.code))
  if (entry.invoice) {
    const split = splitInvoiceVat(entry.invoice, hasPending)
      .filter((r) => r.dueVatCents !== 0)
      .map((r) => ({ rateBp: r.rateBp, baseCents: r.dueBaseCents, vatCents: r.dueVatCents }))
    // The entry still says what the invoice planned (a draft corrected by hand would not)
    if (split.reduce((s, r) => s + r.vatCents, 0) === vatCents) return mergeBuckets(split)
  }
  if (entry.vatTransferOf && entry.vatTransferOf.length > 0) {
    const split = splitTransferredVat(entry.vatTransferOf, vatCents)
    if (split) return split
  }
  const lineCount = entry.lines.filter((l) => l.code.startsWith('7') || isCollectedCode(l.code)).length
  const rate = inferRate(vatCents, revenueCents, Math.max(1, lineCount - 1))
  return rate ? [{ rateBp: rate, baseCents: revenueCents, vatCents }] : null
}

/** An empty set of movements. */
export function emptyMovements(): VatMovements {
  return {
    collected: [],
    autoliquidationGoods: [],
    autoliquidationServices: [],
    unidentified: [],
    salesCreditNotes: { baseCents: 0, vatCents: 0 },
    autoliquidationReversalCents: 0,
    deductibleFixedAssetsCents: 0,
    deductibleOtherCents: 0,
    transferredDeductibleCents: 0,
    deductibleReversalCents: 0,
    coefficientComplementCents: 0,
    nonTaxedSalesCents: 0,
    pendingCollectedCents: 0,
    acomptesPaidCents: 0,
    unhandled: [],
    groups: { collected: 0, autoliquidation: 0, deductibleFixedAssets: 0, deductibleOther: 0 },
    entries: 0,
  }
}

/** Sorts the VAT of validated entries dated in the period (balance and settlement entries are skipped). */
export function classifyEntries(entries: VatEntry[]): VatMovements {
  const m = emptyMovements()
  const unhandled = new Map<string, UnhandledAccount>()
  for (const entry of entries) {
    if (isBalanceEntry(entry) || isSettlementEntry(entry)) continue
    m.entries += 1
    const lines = entry.lines

    const collected = -net(lines, isCollectedCode)
    const pending = -net(lines, isPendingCode)
    const autoliquidated = -net(lines, isAutoliquidationCode)
    const revenue = -net(lines, (c) => c.startsWith('7'))
    m.groups.collected += collected
    m.groups.autoliquidation += autoliquidated
    m.pendingCollectedCents += pending

    if (collected > 0) {
      const split = collectedSplit(entry, collected, revenue)
      if (split) addTo(m.collected, split)
      else m.unidentified.push({ id: entry.id, number: entry.number, date: entry.date, vatCents: collected, baseCents: Math.max(revenue, 0), kind: 'collected' })
    } else if (collected < 0) {
      m.salesCreditNotes.baseCents += Math.max(-revenue, 0)
      m.salesCreditNotes.vatCents += -collected
    } else if (pending === 0 && autoliquidated === 0) {
      const sales = -net(lines, (c) => c.startsWith('70'))
      if (sales > 0) m.nonTaxedSalesCents += sales
    }

    if (autoliquidated > 0) {
      const baseLines = lines.filter((l) => l.code.startsWith('6') || l.code.startsWith('2'))
      const goods = baseLines.filter((l) => isGoodsPurchase(l.code)).reduce((s, l) => s + l.debitCents - l.creditCents, 0)
      const services = baseLines.filter((l) => !isGoodsPurchase(l.code)).reduce((s, l) => s + l.debitCents - l.creditCents, 0)
      const rate = inferRate(autoliquidated, goods + services, Math.max(1, baseLines.length))
      if (rate && goods >= 0 && services >= 0) {
        const [goodsVat, servicesVat] = allocateCents(autoliquidated, [goods, services])
        if (goods > 0) addTo(m.autoliquidationGoods, [{ rateBp: rate, baseCents: goods, vatCents: goodsVat }])
        if (services > 0) addTo(m.autoliquidationServices, [{ rateBp: rate, baseCents: services, vatCents: servicesVat }])
      } else {
        m.unidentified.push({ id: entry.id, number: entry.number, date: entry.date, vatCents: autoliquidated, baseCents: Math.max(goods + services, 0), kind: 'autoliquidation' })
      }
    } else if (autoliquidated < 0) {
      m.autoliquidationReversalCents += -autoliquidated
    }

    const coefficientRegularisation = entry.reference?.startsWith(REGULARISATION_REFERENCE_PREFIX) ?? false
    for (const [test, key] of [
      [isDeductibleFixedAssetsCode, 'deductibleFixedAssetsCents'],
      [isDeductibleOtherCode, 'deductibleOtherCents'],
      [isTransferredCode, 'transferredDeductibleCents'],
    ] as const) {
      const deductible = net(lines, test)
      if (deductible > 0) m[coefficientRegularisation ? 'coefficientComplementCents' : key] += deductible
      else m.deductibleReversalCents += -deductible
    }
    m.groups.deductibleFixedAssets += net(lines, isDeductibleFixedAssetsCode)
    m.groups.deductibleOther += net(lines, isDeductibleOtherCode)
    m.acomptesPaidCents += net(lines, isAcompteCode)

    for (const line of lines) {
      const code = line.code
      if (!code.startsWith('445')) continue
      if (
        isCollectedCode(code) ||
        isPendingCode(code) ||
        isAutoliquidationCode(code) ||
        isDeductibleFixedAssetsCode(code) ||
        isDeductibleOtherCode(code) ||
        isTransferredCode(code) ||
        isAcompteCode(code) ||
        isAccrualCode(code)
      ) {
        continue
      }
      const current = unhandled.get(code) ?? { code, netCents: 0, entries: 0 }
      current.netCents += line.debitCents - line.creditCents
      current.entries += 1
      unhandled.set(code, current)
    }
  }
  m.unhandled = [...unhandled.values()].filter((u) => u.netCents !== 0).sort((a, b) => a.code.localeCompare(b.code))
  return m
}
