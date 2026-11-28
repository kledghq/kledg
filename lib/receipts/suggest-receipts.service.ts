/**
 * Receipts that find their transaction later (docs/justificatifs-photo.md):
 * a receipt dropped before its bank line exists (a card payment debited
 * days later, a bank synchronized once a day) is matched again after each
 * bank sync, with the fields recorded on it (read by Kledg or confirmed by
 * the user).
 *
 * Kledg never attaches on its own: a transaction the fields designate alone
 * (outcome matched, lib/receipts/match-receipt.ts) is recorded as the
 * receipt's suggestion, and the Justificatifs page offers it to attach in
 * one click. Attaching to a Qonto transaction sends the file to Qonto, which
 * Kledg cannot take back: the click stays the user's.
 *
 * A suggestion that no longer holds (the transaction got a receipt
 * elsewhere, the fields changed) is cleared at the next pass. Expired
 * receipts are purged on the way (purgeExpiredReceipts), so an unclaimed
 * receipt does not wait for the next upload to go.
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { fieldsOf, matchedTransactionId } from './file-receipt.service'
import { STAGED_SELECT, purgeExpiredReceipts } from './stage-receipt.service'

/** Receipts matched again per pass, oldest first: a bound on one sync's work. */
const MAX_RECEIPTS = 50

export interface SuggestOutcome {
  checked: number
  suggested: number
  cleared: number
}

export async function suggestReceiptMatches(companyId: string, now: Date = new Date()): Promise<SuggestOutcome> {
  await purgeExpiredReceipts(companyId, now)
  const rows = await prisma.stagedReceipt.findMany({
    where: { companyId, status: 'staged', expiresAt: { gt: now }, amount: { not: null }, receiptDate: { not: null } },
    select: STAGED_SELECT,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_RECEIPTS,
  })
  const outcome: SuggestOutcome = { checked: 0, suggested: 0, cleared: 0 }
  for (const row of rows) {
    const fields = fieldsOf(row)
    if (!fields) continue
    outcome.checked++
    const transactionId = await matchedTransactionId(companyId, fields)
    if (transactionId === row.suggestedTransactionId) continue
    // Conditional: a receipt filed or changed meanwhile keeps what the user did
    const { count } = await prisma.stagedReceipt.updateMany({
      where: { id: row.id, status: 'staged', suggestedTransactionId: row.suggestedTransactionId },
      data: { suggestedTransactionId: transactionId, suggestedAt: transactionId ? now : null },
    })
    if (count === 0) continue
    if (transactionId) outcome.suggested++
    else outcome.cleared++
  }
  if (outcome.suggested > 0) logger.info('[Receipts] Transactions found for staged receipts', { companyId, ...outcome })
  return outcome
}
