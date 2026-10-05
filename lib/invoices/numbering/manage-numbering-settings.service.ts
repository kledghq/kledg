/**
 * The invoice numbering configuration of a company (Informations,
 * "Numérotation des factures"): read with the next numbers it would give,
 * saved by an administrator (settings:update) with an audit log entry.
 * The rules are in format.ts, the series in series.ts. A company that
 * existed before automatic numbering was set to typed numbers by migration
 * 20261115090000 ("legacy"): it is invited to configure the numbering until
 * it saves it; a new company numbers automatically (null: the defaults).
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { toIsoDateUtc } from '@/lib/utils/date'
import { qontoInvoicingCapability, type QontoInvoicingCapability } from '../create-in-qonto.service'
import { formatOf, patternOf, type InvoiceNumberingSettings } from './format'
import { loadNumberingSettings, peekNextNumber, raiseNextNumbers } from './series'
import { isLegacyNumbering, type InvoiceNumberingBody } from './settings'

export interface InvoiceNumberingView {
  settings: InvoiceNumberingSettings
  /** Templates of the series, F{YYYY}-{SEQ:4}. */
  patterns: { invoice: string; creditNote: string }
  /** What the next invoice and credit note dated today would get (null: numbers are typed, or no fiscal year for a fiscal year reset). */
  next: { invoice: string | null; creditNote: string | null }
  qonto: QontoInvoicingCapability & { active: boolean }
  /** The company existed before automatic numbering and still types its numbers: invite it to configure the numbering. */
  suggestAutomatic: boolean
}

export async function getInvoiceNumbering(companyId: string, now = new Date()): Promise<InvoiceNumberingView> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, invoiceNumbering: true } })
  if (!company) throw new NotFoundError('Société introuvable')
  const settings = await loadNumberingSettings(prisma, companyId)
  const today = toIsoDateUtc(now)
  const [invoice, creditNote, capability] = await Promise.all([
    peekNextNumber(prisma, companyId, '380', today, settings),
    peekNextNumber(prisma, companyId, '381', today, settings),
    qontoInvoicingCapability(companyId),
  ])
  return {
    settings,
    patterns: { invoice: patternOf(formatOf(settings, 'INVOICE')), creditNote: patternOf(formatOf(settings, 'CREDIT_NOTE')) },
    next: { invoice, creditNote },
    qonto: { ...capability, active: (settings.qontoFirst ?? true) && capability.canCreate },
    suggestAutomatic: settings.mode === 'MANUAL' && isLegacyNumbering(company.invoiceNumbering),
  }
}

/** Saves the configuration (clearing a recorded refusal of Qonto) and raises the next numbers asked for, in one transaction. */
export async function updateInvoiceNumbering(companyId: string, body: InvoiceNumberingBody, options: { source?: string; now?: Date } = {}): Promise<InvoiceNumberingView> {
  const before = await loadNumberingSettings(prisma, companyId)
  await prisma.$transaction(async (tx) => {
    await tx.company.update({ where: { id: companyId }, data: { invoiceNumbering: { ...body.settings }, qontoInvoicingRefusal: null } })
    if (body.nextNumbers) await raiseNextNumbers(tx, companyId, body.settings, body.nextNumbers, toIsoDateUtc(options.now ?? new Date()))
  })
  await writeAuditLog('info', 'Invoice numbering updated', {
    action: 'UPDATE_INVOICE_NUMBERING',
    companyId,
    metadata: { before: { ...before }, after: { ...body.settings }, nextNumbers: body.nextNumbers ?? null, source: options.source ?? 'web' },
  })
  return getInvoiceNumbering(companyId, options.now)
}
