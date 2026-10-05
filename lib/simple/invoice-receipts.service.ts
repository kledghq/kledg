/**
 * Customer payments confirmed in simple mode ("Recettes à vérifier",
 * docs/categories-simples.md#recettes-à-vérifier): a bank credit that pays an
 * open sales invoice. No accounting rule of its own: the entry is the usual
 * payment of a receivable (bank 512 debit, the invoice's customer account
 * 411 credit with the customer's auxiliary account, PCG art. 932-1), and the
 * payment is recorded on the invoice by the invoices module
 * (recordInvoicePayment, lib/invoices/invoice-payments.service.ts), which
 * letters the invoice once its payments cover it.
 *
 * The invoices module records a payment only from a validated entry. When
 * the company asks the accountant to validate simple mode entries, the entry
 * stays a draft and the invoice it pays is kept on its simple_mode_entries
 * row (invoiceId): the payment is recorded when the entry is validated
 * (recordValidatedInvoicePayments, called by validateEntries and
 * updateDraftEntry). Until then the amount counts as pending, so the same
 * invoice is not proposed twice.
 */

import { prisma } from '@/lib/prisma'
import { AccountingError, ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { logger } from '@/lib/logger'
import { recordInvoicePayment, type SettlementResult } from '@/lib/invoices/invoice-payments.service'
import { calendarDayOf } from '@/lib/utils/date'
import { formatCentsFr, parseCents } from '@/lib/utils/money'
import type { OpenInvoice } from './match-invoice'

/** Open invoices read for the suggestions, the oldest due first. */
export const MAX_OPEN_INVOICES = 500

const cents = (value: { toString(): string }) => parseCents(value) ?? 0

/** The customer line of an invoice entry or of a payment entry: a 41 account. */
const CUSTOMER_LINE = { account: { code: { startsWith: '41' } } } as const

export const INVOICE_MESSAGES = {
  notFound: 'Facture introuvable',
  notASale: 'Seule une facture de vente peut être réglée par une entrée d’argent.',
  creditNote: 'Un avoir se rembourse par une sortie d’argent : choisissez une autre catégorie.',
  notPosted: (number: string | null) => `${number ? `La facture n° ${number}` : 'Cette facture'} n’est pas encore comptabilisée : demandez à votre comptable de la comptabiliser.`,
  paid: (number: string) => `La facture n° ${number} est déjà payée.`,
  moneyOut: 'Un paiement de client est une entrée d’argent : choisissez une catégorie de dépense.',
} as const

/** Amounts of simple mode payments confirmed on these invoices and not yet recorded on them (drafts waiting for validation). */
async function pendingByInvoice(companyId: string, invoiceIds: string[]): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) return new Map()
  const rows = await prisma.simpleModeEntry.findMany({
    where: {
      companyId,
      invoiceId: { in: invoiceIds },
      entry: { lines: { none: { invoicePayments: { some: {} } } } },
    },
    select: { invoiceId: true, entry: { select: { lines: { where: { ...CUSTOMER_LINE, credit: { gt: 0 } }, select: { credit: true } } } } },
  })
  const pending = new Map<string, number>()
  for (const row of rows) {
    const amount = row.entry.lines.reduce((sum, l) => sum + cents(l.credit), 0)
    pending.set(row.invoiceId!, (pending.get(row.invoiceId!) ?? 0) + amount)
  }
  return pending
}

/**
 * Posted sales invoices (not credit notes) not lettered, with what is left
 * to pay: total minus the payments recorded minus the simple mode payments
 * waiting for validation. Two queries, bounded.
 */
export async function loadOpenSalesInvoices(companyId: string): Promise<OpenInvoice[]> {
  const rows = await prisma.invoice.findMany({
    where: {
      companyId,
      direction: 'SALE',
      typeCode: { not: '381' },
      entryId: { not: null },
      entry: { lines: { none: { ...CUSTOMER_LINE, letteringCode: { not: null } } } },
    },
    select: {
      id: true,
      number: true,
      dueDate: true,
      totalInclTax: true,
      buyerSiren: true,
      tiers: { select: { name: true, siren: true } },
      payments: { select: { amount: true } },
    },
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    take: MAX_OPEN_INVOICES,
  })
  const pending = await pendingByInvoice(companyId, rows.map((r) => r.id))
  return rows
    .map((row) => ({
      id: row.id,
      // Posted invoices only: the series gave their number when they were posted.
      number: row.number ?? '',
      customerName: row.tiers.name,
      customerSiren: row.tiers.siren ?? row.buyerSiren,
      remainingCents: cents(row.totalInclTax) - row.payments.reduce((sum, p) => sum + cents(p.amount), 0) - (pending.get(row.id) ?? 0),
      dueDate: calendarDayOf(row.dueDate) as string,
    }))
    .filter((invoice) => invoice.remainingCents > 0)
}

export interface InvoiceToPay {
  id: string
  number: string
  customerName: string
  /** Code of the customer account of the invoice entry (411, 411000...), looked up in the payment's fiscal year. */
  customerAccountCode: string
  auxiliaryAccountNumber: string
  /** Left to pay before this payment. */
  remainingCents: number
}

/**
 * The sales invoice of the company a credit of `amountCents` pays, checked
 * as the invoices module will check it: posted, not lettered, the payment at
 * most what is left to pay (payments waiting for validation included).
 */
export async function invoiceToPay(companyId: string, invoiceId: string, amountCents: number): Promise<InvoiceToPay> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId },
    select: {
      id: true,
      number: true,
      direction: true,
      typeCode: true,
      totalInclTax: true,
      tiers: { select: { name: true, auxiliaryAccountNumber: true } },
      entry: { select: { lines: { where: CUSTOMER_LINE, select: { auxiliaryAccountNumber: true, letteringCode: true, account: { select: { code: true } } } } } },
      payments: { select: { amount: true } },
    },
  })
  if (!invoice) throw new NotFoundError(INVOICE_MESSAGES.notFound)
  if (invoice.direction !== 'SALE') throw new ValidationError(INVOICE_MESSAGES.notASale)
  if (invoice.typeCode === '381') throw new ValidationError(INVOICE_MESSAGES.creditNote)
  if (!invoice.entry) throw new ConflictError(INVOICE_MESSAGES.notPosted(invoice.number))
  const line = invoice.entry.lines.find((l) => l.auxiliaryAccountNumber === invoice.tiers.auxiliaryAccountNumber)
  if (!line) throw new ConflictError('L’écriture de cette facture n’a plus de ligne client : demandez à votre comptable de la vérifier.')
  if (line.letteringCode) throw new ConflictError(INVOICE_MESSAGES.paid(invoice.number ?? ''))
  const pending = (await pendingByInvoice(companyId, [invoice.id])).get(invoice.id) ?? 0
  const remainingCents = cents(invoice.totalInclTax) - invoice.payments.reduce((sum, p) => sum + cents(p.amount), 0) - pending
  if (remainingCents <= 0) throw new ConflictError(INVOICE_MESSAGES.paid(invoice.number ?? ''))
  if (amountCents > remainingCents) {
    throw new ValidationError(
      `Ce paiement de ${formatCentsFr(amountCents)} dépasse ce qui reste à payer sur la facture n° ${invoice.number ?? ''} (${formatCentsFr(remainingCents)}) : s’il règle plusieurs factures, votre comptable le répartira.`,
    )
  }
  return {
    id: invoice.id,
    number: invoice.number ?? '',
    customerName: invoice.tiers.name,
    customerAccountCode: line.account.code,
    auxiliaryAccountNumber: invoice.tiers.auxiliaryAccountNumber,
    remainingCents,
  }
}

export interface RecordedInvoicePayment {
  entryId: string
  invoiceId: string
  /** The payment is recorded on the invoice. */
  recorded: boolean
  lettered: boolean
  /** What is left to pay on the invoice. */
  remainingCents: number | null
  /** Why it is not recorded or not lettered yet, in French. */
  pending: string | null
}

function fromSettlement(entryId: string, invoiceId: string, settlement: SettlementResult): RecordedInvoicePayment {
  return { entryId, invoiceId, recorded: true, lettered: settlement.lettered, remainingCents: settlement.remainingCents, pending: settlement.letteringPending }
}

/**
 * Records on their invoice the simple mode payments whose entry is
 * validated and not recorded yet, among `entryIds` (all of the company when
 * omitted). Each one through recordInvoicePayment, in its own transaction; a
 * refusal (the invoice was paid meanwhile, a closed year) is returned and
 * logged, never thrown: the entry stays validated and the payment can be
 * recorded from the invoice page.
 */
export async function recordValidatedInvoicePayments(companyId: string, entryIds?: readonly string[], options: { now?: Date } = {}): Promise<RecordedInvoicePayment[]> {
  if (entryIds && entryIds.length === 0) return []
  const rows = await prisma.simpleModeEntry.findMany({
    where: {
      companyId,
      invoiceId: { not: null },
      ...(entryIds ? { entryId: { in: [...entryIds] } } : {}),
      entry: { status: 'validated', lines: { none: { invoicePayments: { some: {} } } } },
    },
    select: { entryId: true, invoiceId: true, entry: { select: { lines: { where: { ...CUSTOMER_LINE, credit: { gt: 0 } }, select: { id: true } } } } },
    orderBy: { createdAt: 'asc' },
  })
  const results: RecordedInvoicePayment[] = []
  for (const row of rows) {
    const invoiceId = row.invoiceId!
    const line = row.entry.lines[0]
    if (!line) continue
    try {
      results.push(fromSettlement(row.entryId, invoiceId, await recordInvoicePayment(companyId, invoiceId, line.id, { now: options.now, source: 'simple-mode' })))
    } catch (error) {
      if (!(error instanceof AccountingError)) throw error
      logger.warn('Simple mode could not record an invoice payment', { companyId, entryId: row.entryId, invoiceId, error })
      results.push({ entryId: row.entryId, invoiceId, recorded: false, lettered: false, remainingCents: null, pending: error.message })
    }
  }
  return results
}
