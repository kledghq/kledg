/**
 * The same supplier invoice received twice (#136): from Qonto and as an
 * electronic invoice file, the supplier named "ACME SAS" here and "ACME"
 * there, so two tiers and two invoices, the charge and the VAT deduction
 * doubled. An invoice number is unique per supplier (CGI ann. II art. 242
 * nonies A, I, 7°): the same number with the same seller SIREN, or with the
 * same day and total when a SIREN is missing, is the same invoice.
 */

import type { Prisma } from '@prisma/client'
import { centsToDecimal } from '@/lib/utils/money'

type Db = Pick<Prisma.TransactionClient, 'invoice'>

export async function findSamePurchaseInvoice(
  db: Db,
  companyId: string,
  doc: { number: string; sellerSiren: string | null; issueDate: Date; totalInclTaxCents: number },
  exceptId?: string,
): Promise<{ id: string; number: string | null } | null> {
  const number = doc.number.trim()
  if (!number) return null
  return db.invoice.findFirst({
    where: {
      companyId,
      direction: 'PURCHASE',
      number: { equals: number, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
      OR: [
        ...(doc.sellerSiren ? [{ sellerSiren: doc.sellerSiren }] : []),
        { issueDate: doc.issueDate, totalInclTax: centsToDecimal(doc.totalInclTaxCents) },
      ],
    },
    select: { id: true, number: true },
  })
}
