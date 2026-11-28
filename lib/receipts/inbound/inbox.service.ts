/**
 * The receipt email address of a company: <token>@KLEDG_RECEIPTS_EMAIL_DOMAIN
 * (config.ts). Whoever knows the address can send receipts to the company
 * (that is the point: a supplier sends its invoices there), so the token is
 * random, 16 characters from 36 (about 82 bits), and an administrator can
 * change it: the former address stops working at once.
 */

import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/audit'
import { newInboxToken } from './address'
import { receiptEmailDomain, receiptEmailEnabled } from './config'

export interface ReceiptInboxView {
  /** The instance receives receipt emails (a domain and a provider are configured). */
  available: boolean
  /** The company's address; null until created. */
  address: string | null
  changedAt: string | null
}

export async function receiptInboxOf(companyId: string): Promise<ReceiptInboxView> {
  const domain = receiptEmailDomain()
  if (!domain || !receiptEmailEnabled()) return { available: false, address: null, changedAt: null }
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { receiptInboxToken: true, receiptInboxChangedAt: true } })
  return {
    available: true,
    address: company.receiptInboxToken ? `${company.receiptInboxToken}@${domain}` : null,
    changedAt: company.receiptInboxChangedAt?.toISOString() ?? null,
  }
}

/** Creates the company's address, or replaces it with a new one (the former one stops working). */
export async function renewReceiptInbox(companyId: string, userId: string): Promise<ReceiptInboxView> {
  if (!receiptEmailEnabled()) return receiptInboxOf(companyId)
  const before = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { receiptInboxToken: true } })
  await prisma.company.update({ where: { id: companyId }, data: { receiptInboxToken: newInboxToken(), receiptInboxChangedAt: new Date() } })
  await writeAuditLog('info', before.receiptInboxToken ? 'Receipt email address changed' : 'Receipt email address created', {
    action: 'RECEIPT_INBOX_RENEWED',
    companyId,
    metadata: { replaced: Boolean(before.receiptInboxToken) },
    context: { userId },
  })
  return receiptInboxOf(companyId)
}
