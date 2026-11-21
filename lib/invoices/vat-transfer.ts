/**
 * VAT due on receipt (CGI art. 269, 2, c): the VAT of a sale of services
 * waits in 44574 until the price is received, then moves to 44571 and is
 * declared on the return of the month of the payment. The move is a draft
 * OD entry dated on the payment (createVatTransfer).
 *
 * It is created with each payment recorded on the invoice
 * (invoice-payments.service.ts) and, for an invoice settled by lettering in
 * Lettrage (by hand or automatic), when the lettering covers it
 * (transferVatOfLetteredInvoicesInTx, #121): the VAT not moved yet goes to
 * 44571 on the day of the latest payment of the group, through a payment
 * recorded on a payment line of the group. A day in a closed period moves
 * to the first open day, the payment day kept as the date of document
 * (PCG art. 1031-4).
 */

import type { Prisma } from '@prisma/client'
import { ensureJournal } from '@/lib/accounting/fiscal-year-closure/ledger'
import { assertEntryWritableInFiscalYear, GUARDED_FISCAL_YEAR_SELECT } from '@/lib/accounting/entry-guards'
import { createEntryInTx } from '@/lib/accounting/services/entry-lifecycle.service'
import { bookingDayInTx } from '@/lib/accounting/period-lock/booking-day'
import { calendarDayOf } from '@/lib/utils/date'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import { accountByRoot } from './ledger-accounts'
import { VAT_ACCOUNT_ROOTS } from './post-invoice.service'

const cents = (value: { toString(): string }) => parseCents(value) ?? 0

/** Draft OD entry: debit 44574, credit 44571 (a negative share swaps them: a credit note). */
export async function createVatTransfer(
  tx: Prisma.TransactionClient,
  companyId: string,
  paymentEntry: { date: Date; fiscalYearId: string },
  invoiceNumber: string,
  shareCents: number,
): Promise<string> {
  const fiscalYear = await tx.fiscalYear.findFirst({ where: { id: paymentEntry.fiscalYearId, companyId }, select: GUARDED_FISCAL_YEAR_SELECT })
  const booking = await bookingDayInTx(tx, paymentEntry.fiscalYearId, calendarDayOf(paymentEntry.date)!)
  assertEntryWritableInFiscalYear(fiscalYear, booking.date, 'create')
  const journal = await ensureJournal(tx, companyId, { code: 'OD', label: 'Opérations diverses' })
  const pending = await accountByRoot(tx, companyId, fiscalYear!, VAT_ACCOUNT_ROOTS.collectedPending.root, VAT_ACCOUNT_ROOTS.collectedPending.label)
  const collected = await accountByRoot(tx, companyId, fiscalYear!, VAT_ACCOUNT_ROOTS.collected.root, VAT_ACCOUNT_ROOTS.collected.label)
  const amount = centsToDecimal(Math.abs(shareCents))
  const description = `TVA exigible à l’encaissement, facture ${invoiceNumber}`.slice(0, 250)
  const [from, to] = shareCents > 0 ? [pending, collected] : [collected, pending]
  const entry = await createEntryInTx(tx, {
    companyId,
    journalId: journal.id,
    fiscalYearId: fiscalYear!.id,
    date: booking.date,
    pieceDate: booking.pieceDate,
    description,
    reference: invoiceNumber.slice(0, 200),
    status: 'draft',
    lines: [
      { accountId: from.id, debit: amount, credit: '0', description },
      { accountId: to.id, debit: '0', credit: amount, description },
    ],
  })
  return entry.id
}

/**
 * After a lettering group is written: each sale whose tiers line is in the
 * group and whose VAT still waits in 44574 gets the rest of it moved, with
 * a payment recorded on the latest payment line of the group not recorded
 * on an invoice yet. A group without such a line (an invoice lettered with
 * its credit note, a payment already recorded on another invoice) moves
 * nothing: the VAT return flags paid invoices whose VAT still waits.
 */
export async function transferVatOfLetteredInvoicesInTx(tx: Prisma.TransactionClient, companyId: string, lineIds: readonly string[]): Promise<void> {
  const invoices = await tx.invoice.findMany({
    where: { companyId, direction: 'SALE', entry: { lines: { some: { id: { in: [...lineIds] } } } } },
    select: {
      id: true,
      number: true,
      totalInclTax: true,
      entryId: true,
      entry: { select: { lines: { where: { account: { code: { startsWith: '44574' } } }, select: { debit: true, credit: true } } } },
      payments: { select: { amount: true, vatTransferEntryId: true } },
    },
  })
  if (invoices.length === 0) return
  const invoiceEntryIds = new Set(invoices.map((i) => i.entryId).filter((id): id is string => !!id))

  for (const invoice of invoices) {
    const pendingCents = (invoice.entry?.lines ?? []).reduce((sum, l) => sum + cents(l.credit) - cents(l.debit), 0)
    if (pendingCents === 0) continue
    const transferIds = invoice.payments.map((p) => p.vatTransferEntryId).filter((id): id is string => !!id)
    const moved = transferIds.length
      ? await tx.entryLine.findMany({ where: { accountingEntryId: { in: transferIds }, account: { code: { startsWith: '44574' } } }, select: { debit: true, credit: true } })
      : []
    const restCents = pendingCents - moved.reduce((sum, l) => sum + cents(l.debit) - cents(l.credit), 0)
    if (restCents === 0) continue

    // The latest payment of the group not recorded on an invoice: the day the price was received
    const [payment] = await tx.entryLine.findMany({
      where: { id: { in: [...lineIds] }, accountingEntryId: { notIn: [...invoiceEntryIds] }, invoicePayments: { none: {} } },
      select: { id: true, accountingEntry: { select: { date: true, fiscalYearId: true } } },
      orderBy: [{ accountingEntry: { date: 'desc' } }, { id: 'asc' }],
      take: 1,
    })
    if (!payment) continue
    const paidCents = invoice.payments.reduce((sum, p) => sum + cents(p.amount), 0)
    const vatTransferEntryId = await createVatTransfer(tx, companyId, payment.accountingEntry, invoice.number ?? '', restCents)
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
