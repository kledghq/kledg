/**
 * The prefill of a staged receipt's form (guess.ts): what Kledg reads in
 * its file (read-receipt.ts), the company's suppliers to name the merchant,
 * then its file name, recorded on the receipt as read, not confirmed.
 * Reading never fails the upload: an unreadable file gives the file name's
 * fields alone.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isoDateToUtc } from '@/lib/utils/date'
import { centsToDecimal } from '@/lib/utils/money'
import { STAGED_SELECT, type StagedReceiptRow } from '../stage-receipt.service'
import { logger } from '@/lib/logger'
import { indexTiers } from '../detect-supplier'
import { fieldsFromFileName } from '../file-name-fields'
import { mergeGuess, type ReceiptGuess } from './guess'
import { readReceiptFile, type ReceiptReading } from './read-receipt'

/** Suppliers matched against the text of a PDF, at most (the same bound as the matching). */
const MAX_TIERS = 5000

export async function guessReceiptFields(
  companyId: string,
  file: { bytes: Uint8Array; contentType: string; fileName: string },
): Promise<ReceiptGuess> {
  let content: ReceiptReading | null = null
  if (file.contentType === 'application/pdf') {
    try {
      const suppliers = await prisma.tiers.findMany({
        where: { companyId, kind: 'SUPPLIER' },
        select: { id: true, name: true, kind: true, auxiliaryAccountNumber: true },
        orderBy: { id: 'asc' },
        take: MAX_TIERS,
      })
      content = await readReceiptFile(file.bytes, file.contentType, indexTiers(suppliers))
    } catch (error) {
      logger.warn('[Receipts] Reading the receipt failed', { companyId, error: (error as Error).message })
    }
  }
  return mergeGuess(content, fieldsFromFileName(file.fileName))
}

/**
 * Records on a staged receipt without fields what Kledg read in its file,
 * marked as read (fieldsReadFrom), not confirmed: the Justificatifs page
 * searches its transaction at once, and a re-matching after a bank sync
 * can find it (suggest-receipts.service.ts). Needs an amount and a date;
 * a receipt the user or the assistant already filled is left as is.
 */
export async function prefillStagedReceipt(companyId: string, receiptId: string, guess: ReceiptGuess): Promise<StagedReceiptRow | null> {
  if (guess.amountCents === null || guess.date === null || guess.readFrom === null) return null
  const { count } = await prisma.stagedReceipt.updateMany({
    where: { id: receiptId, companyId, status: 'staged', amount: null, receiptDate: null },
    data: {
      amount: centsToDecimal(guess.amountCents),
      currency: guess.currency ?? 'EUR',
      receiptDate: isoDateToUtc(guess.date),
      merchantName: guess.merchant,
      vatLines: guess.vatLines.length > 0 ? (guess.vatLines.slice(0, 5) as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      fieldsReadFrom: guess.readFrom,
    },
  })
  return count === 0 ? null : prisma.stagedReceipt.findUnique({ where: { id: receiptId }, select: STAGED_SELECT })
}
