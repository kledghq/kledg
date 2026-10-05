/**
 * Missing supporting documents (justificatifs manquants): bank transactions
 * of a period at or above a threshold that carry no attachment.
 *
 * Every accounting entry rests on a supporting document, and "les documents
 * comptables et les pièces justificatives sont conservés pendant dix ans"
 * (Code de commerce art. L123-22, al. 2). Receipts
 * reach Kledg from the bank (Qonto attachments, POST
 * /api/banking/attachments/sync); this list says which operations still
 * lack one, so the user attaches it at the bank, then syncs.
 *
 * Declined operations (provider status "declined") never moved money and
 * need no receipt. Amounts are stored positive with a side; the threshold
 * applies to the amount. The list is bounded (MAX_ROWS) and its count and
 * total cover every matching transaction.
 *
 * Each transaction carries the supplier read from its label
 * (lib/receipts/detect-supplier.ts): a known vendor with the page of its
 * invoices when verified, or a tiers of the company. Kledg never looks for
 * the receipt itself (no mail, no drive): it says where to find it.
 */

import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { transactionOfCompany } from '@/lib/api/resources'
import { calendarDay } from '@/lib/api/zod-fields'
import { detectSupplier, indexTiers, type DetectedSupplier } from '@/lib/receipts/detect-supplier'
import { calendarDayOf, endOfDay, isoDateToUtc } from '@/lib/utils/date'
import { centsToDecimal, parseCents, toCents } from '@/lib/utils/money'

export const MAX_ROWS = 500
/** Tiers compared to the labels: enough for a small company, bounded for the others. */
const MAX_TIERS = 5000

/** ?companyId=&fiscalYearId=&startDate=&endDate=&bankAccountId=&minAmount=&side=&limit= */
export const MissingReceiptsQuerySchema = z.object({
  fiscalYearId: z.string().max(64).optional(),
  startDate: calendarDay('Date de début invalide').optional(),
  endDate: calendarDay('Date de fin invalide').optional(),
  bankAccountId: z.string().max(64).optional(),
  /** Threshold in euros ("50", "49.90"): transactions of at least this amount. */
  minAmount: z
    .string()
    .regex(/^\d{1,12}([.,]\d{1,2})?$/, 'Seuil invalide\u00a0: un montant en euros, deux décimales au plus')
    .optional()
    .transform((value) => (value === undefined ? 0 : (toCents(value.replace(',', '.')) ?? 0))),
  side: z.enum(['debit', 'credit', 'all'], { error: 'Sens inconnu\u00a0: debit, credit ou all' }).default('all'),
  limit: z.coerce.number().int().min(1).max(MAX_ROWS).default(200),
})
export type MissingReceiptsQuery = z.input<typeof MissingReceiptsQuerySchema>
type ParsedQuery = z.output<typeof MissingReceiptsQuerySchema>

export interface MissingReceipt {
  id: string
  /** yyyy-mm-dd */
  date: string
  label: string | null
  counterpartyName: string | null
  reference: string | null
  /** Signed: negative for money going out. */
  amountCents: number
  reconciled: boolean
  /** The entry linked by reconciliation, if any. */
  entryId: string | null
  bankAccount: { id: string; name: string; displayName: string | null }
  /** Banking provider of the account (QONTO, PONTO...): receipts are sent to Qonto only. */
  bankProvider: string
  /** The supplier read from the label, null when nothing is recognised. */
  supplier: DetectedSupplier | null
}

export interface MissingReceipts {
  period: { startDate: string | null; endDate: string | null }
  thresholdCents: number
  transactions: MissingReceipt[]
  /** Every matching transaction, beyond the rows returned. */
  count: number
  /** Sum of the amounts of every matching transaction (absolute values). */
  totalCents: number
  truncated: boolean
}

/** The bank transactions of the company that still lack their supporting document. */
export async function listMissingReceipts(companyId: string, query: ParsedQuery): Promise<MissingReceipts> {
  let startDate = query.startDate ?? null
  let endDate = query.endDate ?? null
  if (query.fiscalYearId) {
    const fiscalYear = await prisma.fiscalYear.findFirst({ where: { id: query.fiscalYearId, companyId }, select: { startDate: true, endDate: true } })
    if (!fiscalYear) throw new NotFoundError('Exercice introuvable pour cette société.')
    const fyStart = calendarDayOf(fiscalYear.startDate) as string
    const fyEnd = calendarDayOf(fiscalYear.endDate) as string
    startDate = startDate && startDate > fyStart ? startDate : fyStart
    endDate = endDate && endDate < fyEnd ? endDate : fyEnd
  }
  if (startDate && endDate && endDate < startDate) throw new ValidationError('La date de fin précède la date de début.')
  if (query.bankAccountId) {
    const owned = await prisma.bankAccount.count({ where: { id: query.bankAccountId, bankConnection: { companyId } } })
    if (owned === 0) throw new NotFoundError('Compte bancaire introuvable')
  }

  const where: Prisma.BankTransactionWhereInput = {
    ...transactionOfCompany(companyId),
    attachments: { none: {} },
    OR: [{ status: null }, { status: { not: 'declined' } }],
    ...(query.bankAccountId && { bankAccountId: query.bankAccountId }),
    ...(query.side !== 'all' && { side: query.side }),
    ...(query.minAmount > 0 && { amount: { gte: new Prisma.Decimal(centsToDecimal(query.minAmount)) } }),
    ...((startDate || endDate) && {
      date: {
        ...(startDate && { gte: isoDateToUtc(startDate) }),
        ...(endDate && { lte: endOfDay(isoDateToUtc(endDate)) }),
      },
    }),
  }

  const [rows, count, sum] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: query.limit,
      select: {
        id: true,
        date: true,
        label: true,
        counterpartyName: true,
        reference: true,
        amount: true,
        side: true,
        reconciled: true,
        reconciledWith: true,
        bankAccount: { select: { id: true, name: true, displayName: true, bankConnection: { select: { provider: true } } } },
      },
    }),
    prisma.bankTransaction.count({ where }),
    prisma.bankTransaction.aggregate({ where, _sum: { amount: true } }),
  ])

  const tiers = indexTiers(
    rows.length === 0
      ? []
      : await prisma.tiers.findMany({ where: { companyId }, select: { id: true, name: true, kind: true, auxiliaryAccountNumber: true }, orderBy: { id: 'asc' }, take: MAX_TIERS }),
  )

  return {
    period: { startDate, endDate },
    thresholdCents: query.minAmount,
    transactions: rows.map((t) => {
      const cents = Math.abs(parseCents(t.amount) ?? 0)
      const side = /^d/i.test(t.side) ? 'debit' : 'credit'
      return {
        id: t.id,
        date: calendarDayOf(t.date) as string,
        label: t.label,
        counterpartyName: t.counterpartyName,
        reference: t.reference,
        amountCents: side === 'debit' ? -cents : cents,
        reconciled: t.reconciled,
        entryId: t.reconciledWith,
        bankAccount: { id: t.bankAccount.id, name: t.bankAccount.name, displayName: t.bankAccount.displayName },
        bankProvider: t.bankAccount.bankConnection.provider,
        supplier: detectSupplier({ label: t.label, counterpartyName: t.counterpartyName, side }, tiers),
      }
    }),
    count,
    totalCents: Math.abs(toCents(sum._sum.amount ?? 0) ?? 0),
    truncated: count > rows.length,
  }
}
