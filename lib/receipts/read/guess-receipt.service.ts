/**
 * The prefill of a staged receipt's form (guess.ts): what Kledg reads in
 * its file (read-receipt.ts), the company's suppliers to name the merchant,
 * then its file name. Reading never fails the upload: an unreadable file
 * gives the file name's fields alone.
 */

import { prisma } from '@/lib/prisma'
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
