/**
 * VAT waiting for the payment of an invoice of services:
 * - a sale: the VAT is due on receipt of the price (CGI art. 269, 2, c),
 *   it waits in 44574 and moves to 44571 when paid, declared on the return
 *   of the month of the payment;
 * - a purchase: the VAT is deductible once paid (CGI art. 271, I-2; the
 *   right to deduct arises when the tax is due at the supplier), it waits
 *   in 44588 and moves to 44566 when paid (#120). A supplier that opted for
 *   debits is deducted on the invoice (posting-plan.ts).
 *
 * The move is a draft OD entry dated on the payment (createVatTransfer),
 * created with each payment recorded on the invoice
 * (invoice-payments.service.ts) and, for an invoice settled by lettering in
 * Lettrage (by hand or automatic), when the lettering covers it
 * (transferVatOfLetteredInvoicesInTx, #121): the VAT not moved yet moves on
 * the day of the latest payment of the group, through a payment recorded on
 * a payment line of the group. A day in a closed period moves to the first
 * open day, the payment day kept as the date of document (PCG art. 1031-4).
 */

import type { Prisma } from '@prisma/client'
import { ensureJournal } from '@/lib/accounting/fiscal-year-closure/ledger'
import { assertEntryWritableInFiscalYear, GUARDED_FISCAL_YEAR_SELECT } from '@/lib/accounting/entry-guards'
import { createEntryInTx } from '@/lib/accounting/services/entry-lifecycle.service'
import { bookingDayInTx } from '@/lib/accounting/period-lock/booking-day'
import { calendarDayOf } from '@/lib/utils/date'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import { accountByRoot } from './ledger-accounts'
import { pendingDeductibleAccountId, VAT_ACCOUNT_ROOTS } from './post-invoice.service'

type Direction = 'SALE' | 'PURCHASE'
type AmountLine = { debit: { toString(): string }; credit: { toString(): string } }

const cents = (value: { toString(): string }) => parseCents(value) ?? 0

/** Root of the account the VAT of an invoice waits on: 44574 (sale) or 44588 (purchase). */
export function pendingVatRoot(direction: Direction): string {
  return direction === 'SALE' ? VAT_ACCOUNT_ROOTS.collectedPending.root : VAT_ACCOUNT_ROOTS.deductiblePending.root
}

/** VAT waiting on the pending account, from lines of that account: credit of 44574, debit of 44588. */
export function pendingVatOf(direction: Direction, lines: readonly AmountLine[]): number {
  return lines.reduce((sum, l) => sum + (direction === 'SALE' ? cents(l.credit) - cents(l.debit) : cents(l.debit) - cents(l.credit)), 0)
}

/**
 * Draft OD entry moving `shareCents` of waiting VAT: debit 44574, credit
 * 44571 for a sale; debit 44566, credit 44588 for a purchase. A negative
 * share (a credit note) swaps the sides.
 */
export async function createVatTransfer(
  tx: Prisma.TransactionClient,
  companyId: string,
  paymentEntry: { date: Date; fiscalYearId: string },
  invoice: { number: string; direction: Direction },
  shareCents: number,
): Promise<string> {
  const fiscalYear = await tx.fiscalYear.findFirst({ where: { id: paymentEntry.fiscalYearId, companyId }, select: GUARDED_FISCAL_YEAR_SELECT })
  const booking = await bookingDayInTx(tx, paymentEntry.fiscalYearId, calendarDayOf(paymentEntry.date)!)
  assertEntryWritableInFiscalYear(fiscalYear, booking.date, 'create')
  const journal = await ensureJournal(tx, companyId, { code: 'OD', label: 'Opérations diverses' })
  const sale = invoice.direction === 'SALE'
  // Debit then credit of a positive share
  const [first, second] = sale
    ? [
        (await accountByRoot(tx, companyId, fiscalYear!, VAT_ACCOUNT_ROOTS.collectedPending.root, VAT_ACCOUNT_ROOTS.collectedPending.label)).id,
        (await accountByRoot(tx, companyId, fiscalYear!, VAT_ACCOUNT_ROOTS.collected.root, VAT_ACCOUNT_ROOTS.collected.label)).id,
      ]
    : [
        (await accountByRoot(tx, companyId, fiscalYear!, VAT_ACCOUNT_ROOTS.deductible.root, VAT_ACCOUNT_ROOTS.deductible.label)).id,
        await pendingDeductibleAccountId(tx, companyId, fiscalYear!),
      ]
  const amount = centsToDecimal(Math.abs(shareCents))
  const description = (sale ? `TVA exigible à l’encaissement, facture ${invoice.number}` : `TVA déductible au paiement, facture ${invoice.number}`).slice(0, 250)
  const [debitAccount, creditAccount] = shareCents > 0 ? [first, second] : [second, first]
  const entry = await createEntryInTx(tx, {
    companyId,
    journalId: journal.id,
    fiscalYearId: fiscalYear!.id,
    date: booking.date,
    pieceDate: booking.pieceDate,
    description,
    reference: invoice.number.slice(0, 200),
    status: 'draft',
    lines: [
      { accountId: debitAccount, debit: amount, credit: '0', description },
      { accountId: creditAccount, debit: '0', credit: amount, description },
    ],
  })
  return entry.id
}

/** VAT of an invoice already moved by the transfers of its payments (lines of the pending account). */
export async function movedVatCents(tx: Prisma.TransactionClient, direction: Direction, transferEntryIds: readonly string[]): Promise<number> {
  if (transferEntryIds.length === 0) return 0
  const lines = await tx.entryLine.findMany({
    where: { accountingEntryId: { in: [...transferEntryIds] }, account: { code: { startsWith: pendingVatRoot(direction) } } },
    select: { debit: true, credit: true },
  })
  return -pendingVatOf(direction, lines)
}

/**
 * After a lettering group is written: each invoice whose tiers line is in
 * the group and whose VAT still waits gets the rest of it moved, with a
 * payment recorded on the latest payment line of the group not recorded on
 * an invoice yet. A group without such a line (an invoice lettered with its
 * credit note, a payment already recorded on another invoice) moves
 * nothing: the VAT return flags paid invoices whose VAT still waits.
 */
export async function transferVatOfLetteredInvoicesInTx(tx: Prisma.TransactionClient, companyId: string, lineIds: readonly string[]): Promise<void> {
  const invoices = await tx.invoice.findMany({
    where: { companyId, entry: { lines: { some: { id: { in: [...lineIds] } } } } },
    select: {
      id: true,
      number: true,
      direction: true,
      totalInclTax: true,
      entryId: true,
      entry: { select: { lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } } },
      payments: { select: { amount: true, vatTransferEntryId: true } },
    },
  })
  if (invoices.length === 0) return
  const invoiceEntryIds = new Set(invoices.map((i) => i.entryId).filter((id): id is string => !!id))

  for (const invoice of invoices) {
    const root = pendingVatRoot(invoice.direction)
    const pendingCents = pendingVatOf(invoice.direction, (invoice.entry?.lines ?? []).filter((l) => l.account.code.startsWith(root)))
    if (pendingCents === 0) continue
    const transferIds = invoice.payments.map((p) => p.vatTransferEntryId).filter((id): id is string => !!id)
    const restCents = pendingCents - (await movedVatCents(tx, invoice.direction, transferIds))
    if (restCents === 0) continue

    // The latest payment of the group not recorded on an invoice: the day the price was paid
    const [payment] = await tx.entryLine.findMany({
      where: { id: { in: [...lineIds] }, accountingEntryId: { notIn: [...invoiceEntryIds] }, invoicePayments: { none: {} } },
      select: { id: true, accountingEntry: { select: { date: true, fiscalYearId: true } } },
      orderBy: [{ accountingEntry: { date: 'desc' } }, { id: 'asc' }],
      take: 1,
    })
    if (!payment) continue
    const paidCents = invoice.payments.reduce((sum, p) => sum + cents(p.amount), 0)
    const vatTransferEntryId = await createVatTransfer(tx, companyId, payment.accountingEntry, { number: invoice.number ?? '', direction: invoice.direction }, restCents)
    await tx.invoicePayment.create({
      data: {
        invoiceId: invoice.id,
        entryLineId: payment.id,
        amount: centsToDecimal(Math.max(0, cents(invoice.totalInclTax) - paidCents)),
        vatTransferEntryId,
      },
    })
  }
}
