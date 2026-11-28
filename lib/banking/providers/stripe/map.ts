/**
 * Stripe balance transactions as the lines of a Stripe account in Kledg,
 * one account per currency of the balance (pure module).
 *
 * Granularity "per payment" (PCG art. 1031-2, "jour par jour, opération
 * par opération"): every balance transaction is a line at its gross amount,
 * on its own day, and its fee is a line of its own. A payment of 100 € with
 * 1,75 € of fees gives a credit of 100 € and a debit of 1,75 €: the
 * account moves by the net 98,25 €, like the Stripe balance, and the sale
 * and the fee are posted each to its account.
 *
 * Every line has an operation type `stripe.<type>` (stripe.charge,
 * stripe.refund, stripe.payout...), fees `stripe.fee` and Stripe's software
 * fees `stripe.service_fee`: the Stripe rules match on it
 * (lib/rules-library/catalog/stripe.ts), never on the label.
 *
 * Status: a Stripe line is booked as soon as it is in the balance, even
 * when its funds are still "pending" at Stripe (not yet available for a
 * payout): the sale happened. The Stripe status stays in providerData.
 *
 * Amounts: Stripe sends integers in the smallest unit of the currency
 * (https://docs.stripe.com/currencies): cents for most currencies, the unit
 * itself for zero-decimal ones (JPY), thousandths for three-decimal ones.
 */

import { lastDayOfMonth, parisDateOnly, parisIsoDay, utcDate } from '@/lib/utils/date'
import type { ProviderTransaction } from '../types'
import type { StripeBalanceTransaction } from './client'

/** Stripe's zero-decimal currencies (ISK and UGX are sent with two decimals, see the Stripe page). */
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'])
const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd'])

function decimalsOf(currency: string): number {
  const code = currency.toLowerCase()
  return ZERO_DECIMAL.has(code) ? 0 : THREE_DECIMAL.has(code) ? 3 : 2
}

/** Amount in units of the currency from Stripe's smallest unit. */
export function stripeAmount(minor: number, currency: string): number {
  return minor / 10 ** decimalsOf(currency)
}

/**
 * Operation type of the fees taken on a payment, a refund or a conversion:
 * commissions on payment services (lib/rules-library/catalog/stripe.ts).
 */
export const STRIPE_FEE_OPERATION = 'stripe.fee'
/** Operation type of Stripe's fees for its software (Billing, Radar, Stripe Tax...), billed as operations of their own. */
export const STRIPE_SERVICE_FEE_OPERATION = 'stripe.service_fee'

/** Operation type of a balance transaction's gross line. */
function operationTypeOf(type: string): string {
  if (type === 'stripe_fx_fee') return STRIPE_FEE_OPERATION
  if (type === 'stripe_fee' || type === 'tax_fee') return STRIPE_SERVICE_FEE_OPERATION
  return `stripe.${type}`
}

/** French label of a balance transaction, from its type (and reporting category for disputes). */
export function stripeTypeLabel(type: string, reportingCategory?: string | null): string {
  if (reportingCategory === 'dispute') return 'Litige'
  if (reportingCategory === 'dispute_reversal') return 'Litige gagné'
  switch (type) {
    case 'charge':
    case 'payment':
      return 'Paiement'
    case 'refund':
    case 'payment_refund':
      return 'Remboursement'
    case 'refund_failure':
    case 'payment_failure_refund':
      return 'Remboursement échoué'
    case 'payment_reversal':
      return 'Paiement annulé'
    case 'adjustment':
      return 'Ajustement Stripe'
    case 'payout':
      return 'Virement vers votre banque'
    case 'payout_cancel':
      return 'Virement vers votre banque annulé'
    case 'payout_failure':
      return 'Virement vers votre banque échoué'
    case 'stripe_fee':
      return 'Frais Stripe'
    case 'stripe_fx_fee':
      return 'Frais de conversion Stripe'
    case 'tax_fee':
      return 'Frais Stripe Tax'
    case 'topup':
      return 'Approvisionnement du solde'
    case 'topup_reversal':
      return 'Approvisionnement du solde annulé'
    case 'contribution':
      return 'Contribution Stripe Climate'
    default:
      return `Opération Stripe (${type.replace(/_/g, ' ')})`
  }
}

function sourceId(source: StripeBalanceTransaction['source']): string | undefined {
  if (!source) return undefined
  return typeof source === 'string' ? source : source.id
}

/**
 * The Kledg lines of one balance transaction: its gross amount, then its
 * fee when it has one. A transaction of zero gross amount (a fee only)
 * gives its fee line alone.
 */
export function mapStripeBalanceTransaction(txn: StripeBalanceTransaction, accountExternalId: string): ProviderTransaction[] {
  const created = new Date(txn.created * 1000)
  const date = parisDateOnly(created)
  const valueDate = txn.available_on ? parisIsoDay(new Date(txn.available_on * 1000)) : null
  const typeLabel = stripeTypeLabel(txn.type, txn.reporting_category)
  const reference = sourceId(txn.source)
  const description = txn.description?.trim() || undefined
  const providerData = txn as unknown as Record<string, unknown>
  const common = {
    accountExternalId,
    date,
    valueDate,
    state: 'booked' as const,
    status: null,
    reference,
    counterpartyName: 'Stripe',
    category: txn.reporting_category ?? undefined,
  }

  const lines: ProviderTransaction[] = []
  if (txn.amount !== 0) {
    lines.push({
      ...common,
      externalId: txn.id,
      amount: Math.abs(stripeAmount(txn.amount, txn.currency)),
      side: txn.amount > 0 ? 'credit' : 'debit',
      label: description ? `${typeLabel} : ${description}` : typeLabel,
      operationType: operationTypeOf(txn.type),
      providerData,
    })
  }
  if (txn.fee !== 0) {
    lines.push({
      ...common,
      externalId: `${txn.id}:fee`,
      amount: Math.abs(stripeAmount(txn.fee, txn.currency)),
      // A fee is taken from the balance; a negative fee is Stripe giving it back
      side: txn.fee > 0 ? 'debit' : 'credit',
      label: `Frais Stripe : ${typeLabel.toLowerCase()}${reference ? ` ${reference}` : ''}`,
      operationType: STRIPE_FEE_OPERATION,
      providerData: { balanceTransaction: txn.id, fee: txn.fee, currency: txn.currency, fee_details: providerData.fee_details ?? [] },
    })
  }
  return lines
}

/**
 * Granularity "per payout": the lines of an automatic payout, from the
 * balance transactions it took (client.listPayoutTransactions).
 *
 * The transactions are mapped as per payment (gross and fee lines), then
 * summed by kind: one line for the payments, one for the refunds, one for
 * the fees..., plus the payout itself. A summary is at most a monthly recap
 * (PCG art. 1031-2: "par récapitulation au moins mensuelle des totaux des
 * opérations, à la condition de conserver tous les documents permettant de
 * vérifier ces opérations jour par jour, opération par opération"): it
 * never spans two months. Transactions of a month before the payout's are summed apart and
 * dated the last day of their month, so a sale of 30 December paid out on
 * 2 January stays in its fiscal year.
 *
 * The detail (each transaction's id, amount, fee and day) is kept in
 * providerData, and in Stripe's payout reconciliation report.
 */
export function mapStripePayout(
  payout: StripeBalanceTransaction,
  taken: StripeBalanceTransaction[],
  accountExternalId: string,
): ProviderTransaction[] {
  const payoutLines = mapStripeBalanceTransaction(payout, accountExternalId)
  const payoutDay = parisIsoDay(new Date(payout.created * 1000))
  const payoutMonth = payoutDay.slice(0, 7)
  const payoutId = sourceId(payout.source) ?? payout.id
  const scale = 10 ** decimalsOf(payout.currency)

  type Group = { month: string; kind: string; label: string; line: ProviderTransaction; minor: number; items: Record<string, unknown>[] }
  const groups = new Map<string, Group>()
  for (const txn of taken) {
    if (txn.id === payout.id) continue
    const month = parisIsoDay(new Date(txn.created * 1000)).slice(0, 7)
    for (const line of mapStripeBalanceTransaction(txn, accountExternalId)) {
      const fee = line.externalId.endsWith(':fee')
      const kind = fee ? 'fee' : (txn.reporting_category ?? txn.type)
      const key = `${month}|${line.operationType}|${line.side}|${kind}`
      const group = groups.get(key) ?? { month, kind, label: fee ? 'Frais Stripe' : stripeTypeLabel(txn.type, txn.reporting_category), line, minor: 0, items: [] }
      group.minor += Math.round(line.amount * scale)
      group.items.push({ id: txn.id, amount: fee ? txn.fee : txn.amount, day: parisIsoDay(new Date(txn.created * 1000)), source: sourceId(txn.source) ?? null })
      groups.set(key, group)
    }
  }

  const summaries = [...groups.values()].map(({ month, kind, label, line, minor, items }): ProviderTransaction => {
    const [year, monthNumber] = month.split('-').map(Number)
    // A month before the payout's: its last day; the payout's month: the payout's day
    const date = month < payoutMonth ? utcDate(year, monthNumber, lastDayOfMonth(year, monthNumber)) : parisDateOnly(new Date(payout.created * 1000))
    const count = items.length
    return {
      ...line,
      externalId: `${payout.id}:${month}:${line.operationType}:${line.side}:${kind}`,
      category: kind === 'fee' ? 'fee' : line.category,
      date,
      valueDate: payoutLines[0]?.valueDate ?? null,
      amount: minor / scale,
      label: `${label} : virement ${payoutId}${month < payoutMonth ? ` (${month.slice(5)}/${month.slice(0, 4)})` : ''}, ${count} opération${count > 1 ? 's' : ''}`,
      reference: payoutId,
      providerData: { payout: payoutId, payoutBalanceTransaction: payout.id, month, currency: payout.currency, transactions: items },
    }
  })
  return [...summaries.filter((line) => line.amount !== 0), ...payoutLines]
}
