/**
 * The entry an invoice posts, on plain values (accounts already resolved in
 * the fiscal year of the invoice). Separate from the service so the
 * accounting rules are tested without a database.
 *
 * Purchase (journal AC), PCG art. 932-1 list of accounts:
 * - 401 Fournisseurs, credit of the total including tax, with the tiers'
 *   auxiliary account (FEC CompAuxNum);
 * - expense accounts (class 6) or fixed asset accounts (class 2), debit of
 *   each line's total excluding tax;
 * - deductible VAT, debit per rate: 44566 "TVA sur autres biens et
 *   services", or 44562 "TVA sur immobilisations" for fixed asset lines.
 *   A company under the VAT franchise (CGI art. 293 B) deducts nothing: the
 *   VAT is part of the cost of each line. A partly exempt company deducts
 *   the share of its coefficient de déduction (CGI ann. II art. 205), the
 *   rest is part of the cost of each line, in proportion to the bases.
 *
 * Sale (journal VE):
 * - 411 Clients, debit of the total including tax, with the auxiliary account;
 * - revenue accounts (class 7), credit of each line's total excluding tax;
 * - collected VAT, credit per rate: 44571 "TVA collectée". For services, VAT
 *   is due when the price is received (CGI art. 269, 2, c) unless the
 *   company opted to pay it on debits: until then it waits in 44574 "TVA
 *   collectée en attente d'encaissement" (subdivision of 4457), moved to
 *   44571 when the payment is recorded (invoice-payments.service.ts).
 *
 * A credit note (type 381) posts the same lines on the opposite sides.
 *
 * VAT of a rate split between two VAT accounts (a rate holding both fixed
 * asset and other lines, or goods and services on a sale) is allocated in
 * proportion to the bases, the remainder to the largest (allocateCents), so
 * the VAT lines always sum to the VAT of the document.
 */

import { ValidationError } from '@/lib/accounting/errors'
import { allocateCents, formatVatRate, type VatBreakdownRow } from './amounts'

export type VatAccountKey = 'deductible' | 'deductibleFixedAssets' | 'collected' | 'collectedPending'

export interface PlanLine {
  label: string
  totalExclTaxCents: number
  vatRateBp: number
  /** Expense, fixed asset or revenue account (resolved). */
  accountId: string
  nature: 'GOODS' | 'SERVICES'
  fixedAsset: boolean
}

export interface PlanInput {
  direction: 'SALE' | 'PURCHASE'
  typeCode: string
  description: string
  lines: PlanLine[]
  breakdown: VatBreakdownRow[]
  totalInclTaxCents: number
  tiers: { accountId: string; auxiliaryAccountNumber: string; name: string }
  /** VAT accounts the plan needs (resolve them with vatAccountsNeeded first). */
  vatAccounts: Partial<Record<VatAccountKey, string>>
  /** The company opted to pay VAT on services on debits (CGI art. 269, 2, c). */
  servicesVatOnDebits: boolean
  /** VAT franchise (CGI art. 293 B): no VAT deducted on purchases. */
  vatExempt: boolean
  /**
   * Purchases of a partly exempt company: the whole percent of the VAT it
   * deducts, its provisional coefficient de déduction (CGI ann. II art. 205
   * and 206, lib/vat-deduction/coefficient.ts); the rest is a cost of each
   * line. Absent or 100: all of it.
   */
  deductionPercent?: number
}

export interface PlannedLine {
  accountId: string
  debitCents: number
  creditCents: number
  description: string
  auxiliaryAccountNumber?: string
  auxiliaryAccountLabel?: string
  /** Which VAT account a VAT line goes to. */
  vat?: VatAccountKey
}

export interface PostingPlan {
  lines: PlannedLine[]
  /** VAT credited to 44574, waiting for the payment. */
  pendingVatCents: number
}

function vatKeyOf(direction: PlanInput['direction'], line: Pick<PlanLine, 'nature' | 'fixedAsset'>, servicesVatOnDebits: boolean): VatAccountKey {
  if (direction === 'PURCHASE') return line.fixedAsset ? 'deductibleFixedAssets' : 'deductible'
  return line.nature === 'SERVICES' && !servicesVatOnDebits ? 'collectedPending' : 'collected'
}

/** VAT accounts an invoice needs, to resolve before planning. */
export function vatAccountsNeeded(input: Pick<PlanInput, 'direction' | 'lines' | 'breakdown' | 'servicesVatOnDebits' | 'vatExempt' | 'deductionPercent'>): VatAccountKey[] {
  if (input.direction === 'PURCHASE' && (input.vatExempt || input.deductionPercent === 0)) return []
  const keys = new Set<VatAccountKey>()
  for (const row of input.breakdown) {
    if (row.vatCents === 0) continue
    for (const line of input.lines) {
      if (line.vatRateBp === row.vatRateBp) keys.add(vatKeyOf(input.direction, line, input.servicesVatOnDebits))
    }
  }
  return [...keys]
}

const KEY_ORDER: VatAccountKey[] = ['deductible', 'deductibleFixedAssets', 'collected', 'collectedPending']

export function planInvoiceEntry(input: PlanInput): PostingPlan {
  if (input.lines.length === 0) throw new ValidationError('La facture n’a aucune ligne : ajoutez au moins une ligne avant de la comptabiliser.')
  const linesBase = input.lines.reduce((sum, line) => sum + line.totalExclTaxCents, 0)
  const breakdownBase = input.breakdown.reduce((sum, row) => sum + row.baseCents, 0)
  const breakdownVat = input.breakdown.reduce((sum, row) => sum + row.vatCents, 0)
  if (linesBase !== breakdownBase) {
    throw new ValidationError('Le total hors taxe des lignes ne correspond pas au détail de la TVA par taux : corrigez les lignes de la facture.')
  }
  if (breakdownBase + breakdownVat !== input.totalInclTaxCents) {
    throw new ValidationError('Le total TTC ne correspond pas à la somme des bases et de la TVA : corrigez la facture.')
  }
  if (input.totalInclTaxCents <= 0) throw new ValidationError('Le total de la facture doit être positif pour la comptabiliser.')

  const purchase = input.direction === 'PURCHASE'
  const exempt = purchase && input.vatExempt
  // Sides of a purchase invoice; a sale and a credit note swap them.
  const swap = (input.direction === 'SALE') !== (input.typeCode === '381')
  const side = (cents: number, purchaseSide: 'debit' | 'credit'): Pick<PlannedLine, 'debitCents' | 'creditCents'> => {
    const debit = (purchaseSide === 'debit') !== swap
    return debit ? { debitCents: cents, creditCents: 0 } : { debitCents: 0, creditCents: cents }
  }

  // Lines excluding tax; each line also carries its share of the VAT the buyer cannot deduct.
  const extraVat = new Array<number>(input.lines.length).fill(0)
  const vatLines: PlannedLine[] = []
  let pendingVatCents = 0
  for (const row of input.breakdown) {
    if (row.vatCents === 0) continue
    const indexes = input.lines.map((line, i) => (line.vatRateBp === row.vatRateBp ? i : -1)).filter((i) => i >= 0)
    if (indexes.length === 0) {
      throw new ValidationError(`Aucune ligne au taux de ${formatVatRate(row.vatRateBp)} ne porte la TVA de ce taux : corrigez les lignes.`)
    }
    // Deductible part of the VAT of this rate, rounded half up; the rest stays a cost of the lines.
    const percent = purchase && input.deductionPercent !== undefined ? Math.min(Math.max(input.deductionPercent, 0), 100) : 100
    const deductible = exempt ? 0 : percent === 100 ? row.vatCents : Math.floor((row.vatCents * percent * 2 + 100) / 200)
    if (deductible !== row.vatCents) {
      const shares = allocateCents(row.vatCents - deductible, indexes.map((i) => input.lines[i].totalExclTaxCents))
      indexes.forEach((lineIndex, k) => (extraVat[lineIndex] += shares[k]))
    }
    if (deductible === 0) continue
    const groups = new Map<VatAccountKey, number>()
    for (const i of indexes) {
      const key = vatKeyOf(input.direction, input.lines[i], input.servicesVatOnDebits)
      groups.set(key, (groups.get(key) ?? 0) + input.lines[i].totalExclTaxCents)
    }
    const keys = KEY_ORDER.filter((key) => groups.has(key))
    const amounts = allocateCents(deductible, keys.map((key) => groups.get(key) as number))
    keys.forEach((key, k) => {
      if (amounts[k] === 0) return
      const accountId = input.vatAccounts[key]
      if (!accountId) throw new ValidationError('Compte de TVA introuvable pour cette facture.')
      if (key === 'collectedPending') pendingVatCents += amounts[k]
      vatLines.push({
        accountId,
        ...side(amounts[k], 'debit'),
        description: `${input.description}, TVA ${formatVatRate(row.vatRateBp)}${key === 'collectedPending' ? ' en attente d’encaissement' : ''}`,
        vat: key,
      })
    })
  }

  const lines: PlannedLine[] = [
    {
      accountId: input.tiers.accountId,
      ...side(input.totalInclTaxCents, 'credit'),
      description: input.description,
      auxiliaryAccountNumber: input.tiers.auxiliaryAccountNumber,
      auxiliaryAccountLabel: input.tiers.name,
    },
    ...input.lines
      .map((line, i) => ({ line, amount: line.totalExclTaxCents + extraVat[i] }))
      .filter(({ amount }) => amount > 0)
      .map(({ line, amount }) => ({ accountId: line.accountId, ...side(amount, 'debit'), description: line.label })),
    ...vatLines,
  ]

  const debit = lines.reduce((sum, l) => sum + l.debitCents, 0)
  const credit = lines.reduce((sum, l) => sum + l.creditCents, 0)
  if (debit !== credit) throw new ValidationError('L’écriture de la facture ne serait pas équilibrée : corrigez ses montants.')
  return { lines, pendingVatCents }
}
