/**
 * Receipts of expense lines. A line refers to a receipt already known to
 * Kledg: a Qonto attachment synchronized with the bank transactions
 * (attachments table), or a photo filed from an assistant or the
 * Justificatifs page whose file Kledg keeps (receiptFileId, lib/receipts,
 * docs/justificatifs-photo.md); or it carries the reference of a receipt the
 * company keeps (paper or email). The file is shown through the receipt proxy of
 * the bank transactions (GET /api/banking/attachments/[id]/proxy,
 * readQontoReceipt: the company's own Qonto key, Qonto file hosts only,
 * public addresses, no redirect, timeout, byte budget); the line keeps the
 * attachment id, checked against the company when the report is saved.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { calendarDayOf } from '@/lib/utils/date'
import { parseCents } from '@/lib/utils/money'

/** ?companyId=&search= */
export const ReceiptOptionsQuerySchema = z.object({ search: z.string().trim().max(100).optional() })

/** Receipts of the company the line editor offers: the latest Qonto attachments, with their transaction. */
export async function listReceiptOptions(companyId: string, search?: string) {
  const term = search?.trim()
  const rows = await prisma.attachment.findMany({
    where: {
      companyId,
      ...(term
        ? {
            OR: [
              { fileName: { contains: term, mode: 'insensitive' } },
              { bankTransaction: { label: { contains: term, mode: 'insensitive' } } },
              { bankTransaction: { counterpartyName: { contains: term, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      fileName: true,
      fileContentType: true,
      createdAt: true,
      bankTransaction: { select: { date: true, label: true, counterpartyName: true, amount: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return {
    receipts: rows.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      contentType: r.fileContentType,
      transaction: r.bankTransaction
        ? {
            date: calendarDayOf(r.bankTransaction.date) as string,
            label: r.bankTransaction.counterpartyName || r.bankTransaction.label || '',
            amountCents: parseCents(r.bankTransaction.amount) ?? 0,
          }
        : null,
    })),
  }
}
