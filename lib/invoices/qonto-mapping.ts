/**
 * Qonto invoices mapped to Kledg invoices, on plain values (the payloads of
 * lib/integrations/providers/qonto/invoicing.ts). The import keeps the
 * document's amounts and refuses an invoice whose amounts do not add up,
 * with a French reason, rather than guessing.
 *
 * Client invoices (sales): one Kledg line per Qonto item (quantity,
 * unit_price, vat_rate given as a fraction, "0.2" for 20 %). The VAT per rate
 * is the sum of the items' total_vat when Qonto gives it, else rate x base
 * (amounts.ts). The result must equal the document's total_amount to the
 * cent; items with a discount are refused (Qonto does not document how the
 * discount enters the item total).
 *
 * Supplier invoices (purchases): Qonto gives no lines, only the totals and a
 * "taxes" array (tax_rate as a percentage, "20", tax_amount). Kledg records
 * one line per rate whose base is derived from the tax (tax / rate, rounded),
 * the rest of the total excluding tax going to the 0 % rate when there is one,
 * else to the largest base; each derived base must give back its tax within
 * one cent, else the invoice is refused. The VAT kept is the document's.
 */

import { computeInvoiceTotals, formatVatRate, lineTotalCents, parseQuantity, rateToBasisPoints, totalsOfBreakdown, vatOnBaseCents, withinCents, type InvoiceTotals, type VatBreakdownRow } from './amounts'
import type { QontoClientInvoice, QontoMoney, QontoSupplierInvoice } from '@/lib/integrations/providers/qonto/invoicing'
import { fitsAmountColumn, toCents } from '@/lib/utils/money'

export interface MappedLine {
  label: string
  quantityThousandths: number
  unitPriceCents: number
  vatRateBp: number
  totalExclTaxCents: number
}

export interface MappedInvoice {
  externalId: string
  number: string
  issueDate: string
  dueDate: string | null
  status: string | null
  attachmentId: string | null
  attachmentFileName: string | null
  lines: MappedLine[]
  totals: InvoiceTotals
}

export type MapResult = { kind: 'ok'; invoice: MappedInvoice } | { kind: 'ignored' } | { kind: 'refused'; reason: string }

/** Client invoices not imported: drafts (not issued) and canceled ones. */
const IGNORED_CLIENT_STATUSES = new Set(['draft', 'canceled'])
/** Supplier invoices not imported: rejected or discarded documents. */
const IGNORED_SUPPLIER_STATUSES = new Set(['rejected', 'discarded'])

const day = (value: string | null | undefined): string | null => {
  const match = value ? /^(\d{4}-\d{2}-\d{2})/.exec(value) : null
  return match ? match[1] : null
}

function euroCents(money: QontoMoney | null | undefined): number | null {
  if (!money) return null
  if (money.currency && money.currency.toUpperCase() !== 'EUR') return null
  return toCents(money.value)
}

const refuse = (reason: string): MapResult => ({ kind: 'refused', reason })

/** A mapped invoice, refused when an amount would not fit its Decimal(15, 2) column. */
function accept(invoice: MappedInvoice): MapResult {
  const { totals } = invoice
  const amounts = [
    ...invoice.lines.flatMap((line) => [line.unitPriceCents, line.totalExclTaxCents]),
    ...totals.breakdown.flatMap((row) => [row.baseCents, row.vatCents]),
    totals.totalExclTaxCents,
    totals.totalVatCents,
    totals.totalInclTaxCents,
  ]
  return amounts.every(fitsAmountColumn) ? { kind: 'ok', invoice } : refuse('montant trop élevé')
}

export function mapClientInvoice(invoice: QontoClientInvoice): MapResult {
  if (invoice.status && IGNORED_CLIENT_STATUSES.has(invoice.status)) return { kind: 'ignored' }
  const number = invoice.number?.trim()
  if (!number) return refuse('numéro de facture absent')
  const issueDate = day(invoice.issue_date)
  if (!issueDate) return refuse('date de facture absente')
  const total = euroCents(invoice.total_amount)
  if (total === null) return refuse('montant total absent ou dans une autre devise que l’euro')
  const items = invoice.items ?? []
  if (items.length === 0) return refuse('aucune ligne')
  const lines: MappedLine[] = []
  const documentVat = new Map<number, number>()
  let everyItemHasVat = true
  for (const [index, item] of items.entries()) {
    if (item.discount) return refuse(`ligne ${index + 1} : remise non reprise`)
    const quantity = parseQuantity(item.quantity ?? null)
    const unitPrice = euroCents(item.unit_price)
    const rate = rateToBasisPoints(item.vat_rate ?? null, 'fraction')
    if (quantity === null || quantity <= 0 || unitPrice === null || unitPrice < 0 || rate === null) {
      return refuse(`ligne ${index + 1} : quantité, prix ou taux de TVA illisible`)
    }
    const label = (item.title ?? item.description ?? '').trim() || `Ligne ${index + 1}`
    lines.push({ label: label.slice(0, 500), quantityThousandths: quantity, unitPriceCents: unitPrice, vatRateBp: rate, totalExclTaxCents: lineTotalCents(quantity, unitPrice) })
    const vat = euroCents(item.total_vat)
    if (vat === null) everyItemHasVat = false
    else documentVat.set(rate, (documentVat.get(rate) ?? 0) + vat)
  }
  const computed = computeInvoiceTotals(lines)
  const totals = everyItemHasVat
    ? totalsOfBreakdown(
        computed.lineTotalsCents,
        computed.breakdown.map((row) => ({ ...row, vatCents: documentVat.get(row.vatRateBp) ?? 0 })),
      )
    : computed
  if (totals.totalInclTaxCents !== total) return refuse('le total des lignes ne correspond pas au total de la facture')
  return accept({
    externalId: invoice.id,
    number,
    issueDate,
    dueDate: day(invoice.due_date),
    status: invoice.status ?? null,
    attachmentId: invoice.attachment_id ?? null,
    attachmentFileName: null,
    lines,
    totals,
  })
}

/** Bases per rate of a supplier invoice from its taxes (see the module header); null when they do not add up. */
export function basesFromTaxes(totalExclTaxCents: number, taxes: Array<{ vatRateBp: number; vatCents: number }>): VatBreakdownRow[] | null {
  const rows = [...taxes].sort((a, b) => b.vatRateBp - a.vatRateBp).map((t) => ({ ...t, baseCents: t.vatRateBp > 0 ? Math.round((t.vatCents * 10000) / t.vatRateBp) : 0 }))
  if (new Set(rows.map((r) => r.vatRateBp)).size !== rows.length) return null
  const remainder = totalExclTaxCents - rows.reduce((sum, r) => sum + r.baseCents, 0)
  const zero = rows.find((r) => r.vatRateBp === 0)
  if (zero) zero.baseCents += remainder
  else if (rows.length > 0) rows.reduce((max, r) => (r.baseCents > max.baseCents ? r : max), rows[0]).baseCents += remainder
  for (const row of rows) {
    if (row.baseCents < 0) return null
    if (row.vatRateBp > 0 && !withinCents(vatOnBaseCents(row.baseCents, row.vatRateBp), row.vatCents, 1)) return null
    if (row.vatRateBp === 0 && row.vatCents !== 0) return null
  }
  return rows.map(({ vatRateBp, baseCents, vatCents }) => ({ vatRateBp, baseCents, vatCents }))
}

export function mapSupplierInvoice(invoice: QontoSupplierInvoice, supplierName: string): MapResult {
  if (invoice.status && IGNORED_SUPPLIER_STATUSES.has(invoice.status)) return { kind: 'ignored' }
  const number = invoice.invoice_number?.trim()
  if (!number) return refuse('numéro de facture absent')
  const issueDate = day(invoice.issue_date)
  if (!issueDate) return refuse('date de facture absente')
  const total = euroCents(invoice.total_amount)
  if (total === null || total <= 0) return refuse('montant total absent ou dans une autre devise que l’euro')
  const taxes: Array<{ vatRateBp: number; vatCents: number }> = []
  for (const tax of invoice.taxes ?? []) {
    const rate = rateToBasisPoints(tax.tax_rate ?? null, 'percent')
    const amount = euroCents(tax.tax_amount)
    if (rate === null || amount === null) return refuse('détail de la TVA illisible')
    taxes.push({ vatRateBp: rate, vatCents: amount })
  }
  const taxTotal = taxes.reduce((sum, t) => sum + t.vatCents, 0)
  const declaredTax = euroCents(invoice.total_tax_amount)
  if (taxes.length === 0) {
    if (declaredTax !== null && declaredTax !== 0) return refuse('TVA sans détail par taux')
    taxes.push({ vatRateBp: 0, vatCents: 0 })
  } else if (declaredTax !== null && declaredTax !== taxTotal) {
    return refuse('le total de TVA ne correspond pas au détail par taux')
  }
  const declaredExcl = euroCents(invoice.total_amount_excluding_taxes)
  const totalExcl = total - taxTotal
  if (declaredExcl !== null && declaredExcl !== totalExcl) return refuse('le total hors taxe ne correspond pas au total moins la TVA')
  const breakdown = basesFromTaxes(totalExcl, taxes)
  if (!breakdown) return refuse('le détail de la TVA par taux ne permet pas de retrouver les bases hors taxe')
  const several = breakdown.length > 1
  const lines = breakdown.map((row) => ({
    label: `Facture ${number} ${supplierName}${several ? `, base au taux de ${formatVatRate(row.vatRateBp)}` : ''}`.slice(0, 500),
    quantityThousandths: 1000,
    unitPriceCents: row.baseCents,
    vatRateBp: row.vatRateBp,
    totalExclTaxCents: row.baseCents,
  }))
  return accept({
    externalId: invoice.id,
    number,
    issueDate,
    dueDate: day(invoice.due_date),
    status: invoice.status ?? null,
    attachmentId: invoice.attachment_id ?? null,
    attachmentFileName: invoice.file_name ?? null,
    lines,
    totals: totalsOfBreakdown(lines.map((l) => l.totalExclTaxCents), breakdown),
  })
}
