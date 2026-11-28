/**
 * A receipt email received (docs/justificatifs-email.md): the email sent to
 * a company's receipt address (inbox.service.ts) becomes staged receipts,
 * as if a member had dropped its attachments on the Justificatifs page.
 *
 * The email is untrusted, whoever sent it:
 * - the company comes from the token of the address only, found with a
 *   system context, then everything runs in that company's context;
 * - only the attachments are read, never the body nor its links; an inline
 *   image (a logo of a signature) is no receipt; at most MAX_ATTACHMENTS per
 *   email, each checked from its bytes like any upload (JPEG, PNG or PDF,
 *   5 MB at most), staged once per content (SHA-256);
 * - the company receives at most the 'receipt-email' limit per day;
 * - each receipt is read (an e-invoice's data, a PDF's text) and its
 *   transaction searched (suggest-receipts.service.ts): found, it waits for
 *   a member's click like any suggestion; nothing is ever attached here.
 * Staged receipts of an email have no uploader: the members who file
 * everyone's receipts (banking:reconcile, expenses:validate) see them.
 */

import { RateLimitError, ValidationError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { withSystemContext } from '@/lib/rls/context'
import { guessReceiptFields, prefillStagedReceipt } from '../read/guess-receipt.service'
import { EMAIL_ACTOR, stageReceipt } from '../stage-receipt.service'
import { suggestReceiptMatches } from '../suggest-receipts.service'
import type { InboundEmail } from './adapters'
import { receiptEmailDomain, type InboundProvider } from './config'
import { inboxTokenOf } from './address'

/** Receipts read from one email at most: an invoice email carries one or two. */
export const MAX_ATTACHMENTS = 10

export type ReceiveOutcome =
  | { outcome: 'no-company' }
  | { outcome: 'received'; companyId: string; staged: number; duplicates: number; skipped: number; limited: boolean }

/** The company of the first recipient that is a receipt address of this instance. */
async function companyOf(email: InboundEmail): Promise<string | null> {
  const domain = receiptEmailDomain()
  if (!domain) return null
  for (const recipient of email.recipients) {
    const token = inboxTokenOf(recipient, domain)
    if (!token) continue
    const company = await withSystemContext('receipt-email', () => prisma.company.findUnique({ where: { receiptInboxToken: token }, select: { id: true } }))
    if (company) return company.id
  }
  return null
}

export async function receiveInboundEmail(email: InboundEmail, provider: InboundProvider): Promise<ReceiveOutcome> {
  const companyId = await companyOf(email)
  if (!companyId) {
    logger.info('[Receipts] Email to no receipt address', { provider, recipients: email.recipients.length })
    return { outcome: 'no-company' }
  }
  return withSystemContext('receipt-email', () => receiveForCompany(companyId, email, provider), { companyIds: [companyId] })
}

async function receiveForCompany(companyId: string, email: InboundEmail, provider: InboundProvider): Promise<ReceiveOutcome> {
  const result = { outcome: 'received' as const, companyId, staged: 0, duplicates: 0, skipped: 0, limited: false }
  const candidates = email.attachments.filter((a) => !a.inline)
  result.skipped += email.attachments.length - candidates.length + Math.max(0, candidates.length - MAX_ATTACHMENTS)

  for (const attachment of candidates.slice(0, MAX_ATTACHMENTS)) {
    let bytes: Uint8Array
    try {
      bytes = await attachment.load()
    } catch (error) {
      result.skipped++
      logger.warn('[Receipts] Email attachment not read', { companyId, provider, reason: (error as Error).message })
      continue
    }
    try {
      const staged = await stageReceipt(companyId, EMAIL_ACTOR, { bytes, fileName: attachment.fileName, source: 'email' })
      if (staged.duplicate) {
        result.duplicates++
        continue
      }
      result.staged++
      const guess = await guessReceiptFields(companyId, { bytes, contentType: staged.receipt.contentType, fileName: attachment.fileName })
      await prefillStagedReceipt(companyId, staged.receipt.id, guess)
    } catch (error) {
      if (error instanceof RateLimitError) {
        result.limited = true
        break
      }
      // Not a JPEG, PNG or PDF (a .docx, a calendar invitation), too large: not a receipt
      if (error instanceof ValidationError) {
        result.skipped++
        continue
      }
      throw error
    }
  }

  if (result.staged > 0) {
    await suggestReceiptMatches(companyId).catch((error: unknown) =>
      logger.warn('[Receipts] Matching emailed receipts failed', { companyId, reason: (error as Error).message }),
    )
  }
  await writeAuditLog(result.limited ? 'warn' : 'info', 'Receipt email received', {
    action: 'RECEIPT_EMAIL_RECEIVED',
    companyId,
    metadata: { provider, messageId: email.messageId, staged: result.staged, duplicates: result.duplicates, skipped: result.skipped, limited: result.limited },
    context: { userId: null },
  })
  return result
}
