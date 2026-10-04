/**
 * Payments of invoices, from the bank.
 *
 * A payment is the line of a validated entry reconciled with a bank
 * transaction (the reconciliation entry, or an entry linked to a
 * transaction) that settles the invoice's tiers line: same account number
 * (401..., 411...), opposite side, same auxiliary account or none (a
 * reconciliation line often has none), not lettered, not recorded on
 * another invoice.
 *
 * Invariants owned here:
 * - a line pays one invoice (unique entryLineId), for its whole amount, and
 *   never more than what is left to pay;
 * - Kledg has no partial lettering (docs/lettrage-et-tiers.md): a part
 *   payment is recorded without lettering and the invoice shows "payée
 *   partiellement"; once the payments cover the invoice, its tiers line and
 *   the payment lines are lettered together through the lettering service
 *   (lib/lettering/lettering.service.ts: validated entries, same fiscal year,
 *   balanced group, lock per account). When that is not possible yet (the
 *   invoice entry still a draft, a payment in the next fiscal year), the
 *   invoice is paid and the reason is returned; settleInvoice letters it later;
 * - a sale whose services VAT waits in 44574 (CGI art. 269, 2, c: VAT due
 *   when the price is received) gets, with each payment, a draft entry
 *   moving the VAT of that payment to 44571, dated on the payment, in the
 *   payment's fiscal year: pending VAT x payment / total, the payment that
 *   completes the invoice taking the rest, so the moves sum to the pending VAT;
 * - recording and removing run under a lock per invoice.
 */

import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { AccountingError, ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { assertEntryWritableInFiscalYear, GUARDED_FISCAL_YEAR_SELECT } from '@/lib/accounting/entry-guards'
import { createEntryInTx, deleteDraftEntryInTx } from '@/lib/accounting/services/entry-lifecycle.service'
import { writeAuditLog } from '@/lib/audit'
import { letterLines } from '@/lib/lettering/lettering.service'
import { calendarDayOf } from '@/lib/utils/date'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import { accountByRoot } from './ledger-accounts'
import { INVOICE_NOT_FOUND, lockInvoice } from './manage-invoices.service'
import { VAT_ACCOUNT_ROOTS } from './post-invoice.service'

type Db = Prisma.TransactionClient | typeof prisma

/** Body of POST /api/invoices/[id]/payments. */
export const RecordPaymentBodySchema = z.object({
  entryLineId: z.string({ error: 'Choisissez le règlement' }).min(1, 'Choisissez le règlement').max(64),
})

const cents = (value: { toString(): string }) => parseCents(value) ?? 0

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const

async function lockPayments(tx: Prisma.TransactionClient, invoiceId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:invoice-payments:${invoiceId}`}))`
}

/** The invoice with its entry's tiers line, as the payment rules need it. */
async function loadSettlement(db: Db, companyId: string, invoiceId: string) {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, companyId },
    select: {
      id: true,
      number: true,
      direction: true,
      typeCode: true,
      totalInclTax: true,
      tiers: { select: { auxiliaryAccountNumber: true } },
      entry: {
        select: {
          id: true,
          status: true,
          lines: {
            select: {
              id: true,
              debit: true,
              credit: true,
              letteringCode: true,
              auxiliaryAccountNumber: true,
              accountId: true,
              account: { select: { code: true } },
            },
          },
        },
      },
      payments: { select: { id: true, amount: true, entryLineId: true, vatTransferEntryId: true } },
    },
  })
  if (!invoice) throw new NotFoundError(INVOICE_NOT_FOUND)
  if (!invoice.entry) throw new ConflictError(`La facture n° ${invoice.number} n’est pas comptabilisée : comptabilisez-la avant d’enregistrer un règlement.`)
  const tiersLine = invoice.entry.lines.find(
    (l) => (l.account.code.startsWith('40') || l.account.code.startsWith('41')) && l.auxiliaryAccountNumber === invoice.tiers.auxiliaryAccountNumber,
  )
  if (!tiersLine) throw new ConflictError('L’écriture de cette facture n’a plus de ligne de tiers : vérifiez-la dans Écritures.')
  const pendingVatCents = invoice.entry.lines
    .filter((l) => l.account.code.startsWith('44574'))
    .reduce((sum, l) => sum + cents(l.credit) - cents(l.debit), 0)
  const totalCents = cents(invoice.totalInclTax)
  const paidCents = invoice.payments.reduce((sum, p) => sum + cents(p.amount), 0)
  // The invoice line is a debit (sale, purchase credit note) or a credit; a payment sits on the other side.
  const invoiceOnDebit = cents(tiersLine.debit) > 0
  return { invoice, tiersLine, pendingVatCents, totalCents, paidCents, invoiceOnDebit }
}

/** Entries of the company reconciled with a bank transaction, among `entryIds`. */
async function reconciledEntries(db: Db, companyId: string, entryIds: string[]): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set()
  const [linked, created] = await Promise.all([
    db.bankTransaction.findMany({ where: { reconciledWith: { in: entryIds }, bankAccount: { bankConnection: { companyId } } }, select: { reconciledWith: true } }),
    db.accountingEntry.findMany({ where: { id: { in: entryIds }, companyId, sourceBankTransactionId: { not: null } }, select: { id: true } }),
  ])
  return new Set([...linked.map((t) => t.reconciledWith as string), ...created.map((e) => e.id)])
}

export interface PaymentCandidate {
  entryLineId: string
  entryId: string
  entryNumber: string
  date: string
  description: string
  amountCents: number
  auxiliaryAccountNumber: string | null
  /** Same amount as what is left to pay. */
  exact: boolean
}

/** Bank payments that may settle the invoice, exact amounts first, then by date. */
export async function listPaymentCandidates(companyId: string, invoiceId: string): Promise<{ remainingCents: number; candidates: PaymentCandidate[] }> {
  const { invoice, tiersLine, totalCents, paidCents, invoiceOnDebit } = await loadSettlement(prisma, companyId, invoiceId)
  const remaining = tiersLine.letteringCode ? 0 : totalCents - paidCents
  if (remaining <= 0) return { remainingCents: 0, candidates: [] }
  const rows = await prisma.entryLine.findMany({
    where: {
      account: { companyId, code: tiersLine.account.code },
      letteringCode: null,
      invoicePayments: { none: {} },
      accountingEntry: { companyId, status: 'validated', id: { not: invoice.entry!.id } },
      OR: [{ auxiliaryAccountNumber: null }, { auxiliaryAccountNumber: '' }, { auxiliaryAccountNumber: invoice.tiers.auxiliaryAccountNumber }],
      ...(invoiceOnDebit ? { credit: { gt: 0 } } : { debit: { gt: 0 } }),
    },
    select: {
      id: true,
      debit: true,
      credit: true,
      description: true,
      auxiliaryAccountNumber: true,
      accountingEntry: { select: { id: true, entryNumber: true, date: true, description: true } },
    },
    orderBy: [{ accountingEntry: { date: 'asc' } }, { id: 'asc' }],
    take: 500,
  })
  const reconciled = await reconciledEntries(prisma, companyId, [...new Set(rows.map((r) => r.accountingEntry.id))])
  const candidates = rows
    .filter((r) => reconciled.has(r.accountingEntry.id))
    .map((r) => {
      const amountCents = invoiceOnDebit ? cents(r.credit) : cents(r.debit)
      return {
        entryLineId: r.id,
        entryId: r.accountingEntry.id,
        entryNumber: r.accountingEntry.entryNumber,
        date: calendarDayOf(r.accountingEntry.date) as string,
        description: r.description || r.accountingEntry.description || '',
        amountCents,
        auxiliaryAccountNumber: r.auxiliaryAccountNumber,
        exact: amountCents === remaining,
      }
    })
    .filter((c) => c.amountCents <= remaining)
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.date.localeCompare(b.date))
    .slice(0, 50)
  return { remainingCents: remaining, candidates }
}

export interface SettlementResult {
  paidCents: number
  remainingCents: number
  lettered: boolean
  letteringCode: string | null
  /** Why the invoice is paid but not lettered yet (French), when it is not. */
  letteringPending: string | null
}

/** Letters the invoice with its payments when they cover it; never throws for a lettering refusal. */
async function letterIfCovered(companyId: string, invoiceId: string, now?: Date): Promise<SettlementResult> {
  const { invoice, tiersLine, totalCents, paidCents } = await loadSettlement(prisma, companyId, invoiceId)
  const remainingCents = Math.max(0, totalCents - paidCents)
  if (tiersLine.letteringCode) return { paidCents, remainingCents: 0, lettered: true, letteringCode: tiersLine.letteringCode, letteringPending: null }
  if (paidCents < totalCents) return { paidCents, remainingCents, lettered: false, letteringCode: null, letteringPending: null }
  const paymentLines = await prisma.entryLine.findMany({
    where: { id: { in: invoice.payments.map((p) => p.entryLineId) } },
    select: { id: true, accountId: true },
  })
  if (invoice.entry!.status !== 'validated') {
    return { paidCents, remainingCents: 0, lettered: false, letteringCode: null, letteringPending: 'Validez l’écriture de la facture pour la lettrer avec ses règlements.' }
  }
  if (paymentLines.some((l) => l.accountId !== tiersLine.accountId)) {
    return {
      paidCents,
      remainingCents: 0,
      lettered: false,
      letteringCode: null,
      letteringPending: 'Un règlement est sur un autre exercice que la facture : lettrez-le avec les à-nouveaux dans Lettrage.',
    }
  }
  try {
    const group = await letterLines(companyId, { accountId: tiersLine.accountId, lineIds: [tiersLine.id, ...paymentLines.map((l) => l.id)] }, { now, source: 'invoice' })
    return { paidCents, remainingCents: 0, lettered: true, letteringCode: group.code, letteringPending: null }
  } catch (error) {
    if (error instanceof AccountingError) return { paidCents, remainingCents: 0, lettered: false, letteringCode: null, letteringPending: error.message }
    throw error
  }
}

export async function recordInvoicePayment(
  companyId: string,
  invoiceId: string,
  entryLineId: string,
  options: { now?: Date; source?: string } = {},
): Promise<SettlementResult & { paymentId: string; vatTransferEntryId: string | null }> {
  const recorded = await prisma.$transaction(async (tx) => {
    await lockInvoice(tx, companyId, invoiceId)
    await lockPayments(tx, invoiceId)
    const { invoice, tiersLine, pendingVatCents, totalCents, paidCents, invoiceOnDebit } = await loadSettlement(tx, companyId, invoiceId)
    if (tiersLine.letteringCode) throw new ConflictError(`La facture n° ${invoice.number} est déjà lettrée (${tiersLine.letteringCode}) : elle est payée.`)

    const line = await tx.entryLine.findFirst({
      where: { id: entryLineId, accountingEntry: { companyId } },
      select: {
        id: true,
        debit: true,
        credit: true,
        letteringCode: true,
        auxiliaryAccountNumber: true,
        account: { select: { code: true } },
        accountingEntry: { select: { id: true, status: true, date: true, fiscalYearId: true, entryNumber: true } },
        invoicePayments: { select: { invoiceId: true } },
      },
    })
    if (!line) throw new NotFoundError('Règlement introuvable')
    if (line.accountingEntry.id === invoice.entry!.id) throw new ValidationError('Cette ligne est celle de la facture elle-même.')
    if (line.accountingEntry.status !== 'validated') {
      throw new ConflictError(`L’écriture n° ${line.accountingEntry.entryNumber} du règlement est en brouillon : validez-la d’abord.`)
    }
    if (line.account.code !== tiersLine.account.code) {
      throw new ValidationError(`Ce règlement est sur le compte ${line.account.code}, la facture sur le compte ${tiersLine.account.code}.`)
    }
    const aux = line.auxiliaryAccountNumber?.trim()
    if (aux && aux !== invoice.tiers.auxiliaryAccountNumber) throw new ValidationError(`Ce règlement appartient à un autre tiers (${aux}).`)
    if (line.letteringCode) throw new ConflictError(`Ce règlement est déjà lettré (${line.letteringCode}).`)
    if (line.invoicePayments.length > 0) throw new ConflictError('Ce règlement est déjà enregistré sur une facture.')
    const amountCents = invoiceOnDebit ? cents(line.credit) : cents(line.debit)
    if (amountCents <= 0) throw new ValidationError('Ce mouvement est du même côté que la facture : ce n’est pas un règlement.')
    const remaining = totalCents - paidCents
    if (amountCents > remaining) {
      throw new ValidationError('Ce règlement dépasse le reste à payer de la facture : lettrez-le à la main dans Lettrage s’il règle plusieurs factures.')
    }
    const reconciled = await reconciledEntries(tx, companyId, [line.accountingEntry.id])
    if (!reconciled.has(line.accountingEntry.id)) {
      throw new ValidationError('Ce mouvement n’est pas rapproché avec une transaction bancaire : rapprochez d’abord la transaction du règlement.')
    }

    // VAT on receipts: move the VAT of this payment from 44574 to 44571, in the payment's fiscal year.
    let vatTransferEntryId: string | null = null
    if (invoice.direction === 'SALE' && pendingVatCents !== 0) {
      const moved = await tx.entryLine.findMany({
        where: { accountingEntry: { vatTransfers: { some: { invoiceId } } }, account: { code: { startsWith: '44574' } } },
        select: { debit: true, credit: true },
      })
      const movedCents = moved.reduce((sum, l) => sum + cents(l.debit) - cents(l.credit), 0)
      const share =
        amountCents === remaining
          ? pendingVatCents - movedCents
          : Number((BigInt(pendingVatCents) * BigInt(2 * amountCents) + BigInt(totalCents)) / BigInt(2 * totalCents))
      if (share !== 0) vatTransferEntryId = await createVatTransfer(tx, companyId, line.accountingEntry, invoice.number, share)
    }

    const payment = await tx.invoicePayment.create({
      data: { invoiceId, entryLineId: line.id, amount: centsToDecimal(amountCents), vatTransferEntryId },
      select: { id: true },
    })
    return { paymentId: payment.id, vatTransferEntryId, number: invoice.number, amountCents }
  }, TX_OPTIONS)

  await writeAuditLog('info', `Payment recorded on invoice ${recorded.number}`, {
    action: 'RECORD_INVOICE_PAYMENT',
    companyId,
    metadata: { invoiceId, entryLineId, paymentId: recorded.paymentId, vatTransferEntryId: recorded.vatTransferEntryId, source: options.source ?? 'web' },
  })
  const settlement = await letterIfCovered(companyId, invoiceId, options.now)
  return { ...settlement, paymentId: recorded.paymentId, vatTransferEntryId: recorded.vatTransferEntryId }
}

/** Draft OD entry: debit 44574, credit 44571 (a negative share swaps them: a credit note). */
async function createVatTransfer(
  tx: Prisma.TransactionClient,
  companyId: string,
  paymentEntry: { date: Date; fiscalYearId: string },
  invoiceNumber: string,
  shareCents: number,
): Promise<string> {
  const fiscalYear = await tx.fiscalYear.findFirst({ where: { id: paymentEntry.fiscalYearId, companyId }, select: GUARDED_FISCAL_YEAR_SELECT })
  assertEntryWritableInFiscalYear(fiscalYear, paymentEntry.date, 'create')
  const journal = await tx.journal.findFirst({ where: { companyId, code: 'OD' }, select: { id: true } })
  if (!journal) throw new ValidationError('Le journal OD n’existe pas : créez-le pour constater la TVA exigible à l’encaissement.')
  const pending = await accountByRoot(tx, companyId, fiscalYear!, VAT_ACCOUNT_ROOTS.collectedPending.root, VAT_ACCOUNT_ROOTS.collectedPending.label)
  const collected = await accountByRoot(tx, companyId, fiscalYear!, VAT_ACCOUNT_ROOTS.collected.root, VAT_ACCOUNT_ROOTS.collected.label)
  const amount = centsToDecimal(Math.abs(shareCents))
  const description = `TVA exigible à l’encaissement, facture ${invoiceNumber}`.slice(0, 250)
  const [from, to] = shareCents > 0 ? [pending, collected] : [collected, pending]
  const entry = await createEntryInTx(tx, {
    companyId,
    journalId: journal.id,
    fiscalYearId: fiscalYear!.id,
    date: paymentEntry.date,
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

/** Removes a payment recorded on an invoice (and its draft VAT move); refused once the invoice is lettered. */
export async function removeInvoicePayment(companyId: string, invoiceId: string, paymentId: string): Promise<{ id: string }> {
  const removed = await prisma.$transaction(async (tx) => {
    await lockInvoice(tx, companyId, invoiceId)
    await lockPayments(tx, invoiceId)
    const { invoice, tiersLine } = await loadSettlement(tx, companyId, invoiceId)
    if (tiersLine.letteringCode) {
      throw new ConflictError(`La facture est lettrée (${tiersLine.letteringCode}) : délettrez-la dans Lettrage avant de retirer un règlement.`)
    }
    const payment = invoice.payments.find((p) => p.id === paymentId)
    if (!payment) throw new NotFoundError('Règlement introuvable sur cette facture')
    if (payment.vatTransferEntryId) {
      const transfer = await tx.accountingEntry.findFirst({ where: { id: payment.vatTransferEntryId, companyId }, select: { status: true, entryNumber: true } })
      if (transfer?.status === 'validated') {
        throw new ConflictError(
          `L’écriture n° ${transfer.entryNumber} de TVA exigible est validée : contre-passez-la avant de retirer ce règlement.`,
        )
      }
    }
    await tx.invoicePayment.delete({ where: { id: paymentId } })
    if (payment.vatTransferEntryId) await deleteDraftEntryInTx(tx, companyId, payment.vatTransferEntryId)
    return invoice.number
  }, TX_OPTIONS)
  await writeAuditLog('info', `Payment removed from invoice ${removed}`, { action: 'REMOVE_INVOICE_PAYMENT', companyId, metadata: { invoiceId, paymentId } })
  return { id: paymentId }
}

/** Letters an invoice whose payments cover it (after its entry was validated, for example). */
export async function settleInvoice(companyId: string, invoiceId: string, options: { now?: Date } = {}): Promise<SettlementResult> {
  return letterIfCovered(companyId, invoiceId, options.now)
}
