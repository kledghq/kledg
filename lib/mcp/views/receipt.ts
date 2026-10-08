/**
 * Data of the receipt capture view (docs/justificatifs-photo.md), built
 * from what capture_receipt, stage_receipt and file_receipt return: the
 * same service results in euros, nothing read again. Pure module.
 *
 * Every step of the view is a call of those tools whose result is this view
 * again (lib/mcp/views/html/receipt.ts): the server checks each call, and an
 * attach follows the approval rules of the connection (define.ts).
 */

import { kledgPageUrl } from '@/lib/mcp/tool-meta'
import { formatIsoDateFr } from '@/lib/utils/date'
import { RECEIPT_ACCEPT, RECEIPT_MAX_BYTES } from '@/lib/receipts/file-type'
import type { ExecutionMode } from '@/lib/ai-access/access'
import type { ReceiptCandidateView, ReceiptCaptureView } from './schemas'

/** A candidate transaction as the tools return it (euros). */
export interface CandidateOut {
  transactionId: string
  date: string
  label: string | null
  counterpartyName: string | null
  amount: number
  bankAccountName: string
  sendsToBank: boolean
  score: number
  reasons: string[]
}

/** A staged receipt as the tools return it (euros). */
export interface ReceiptOut {
  id: string
  fileName: string
  contentType: string
  size: number
  status: 'staged' | 'attached' | 'expense' | 'discarded'
  fields: { amount: number | null; currency: string | null; date: string | null; merchant: string | null; vat: Array<{ rate: number; amount: number }>; paymentMethod: string | null }
}

export interface ProposalOut {
  date: string
  merchant: string | null
  amount: number
  category: string
  categoryLabel: string
  accountCode: string | null
  openDraft: { id: string; number: string } | null
  needsEuroAmount: boolean
}

export interface ViewContext {
  executionMode: ExecutionMode
  canAttach: boolean
  canExpense: boolean
}

export interface CaptureFields {
  amount?: number
  currency?: string
  date?: string
  merchant?: string
  vat?: Array<{ rate: number; amount: number }>
  paymentMethod?: string
}

function candidateOf(c: CandidateOut): ReceiptCandidateView {
  return {
    transactionId: c.transactionId,
    date: c.date,
    label: c.counterpartyName || c.label || 'Opération sans libellé',
    amount: c.amount,
    bankAccount: c.bankAccountName,
    sendsToBank: c.sendsToBank,
    score: Math.min(1, Math.max(0, c.score)),
    reasons: c.reasons.slice(0, 8),
  }
}

function fieldsOf(receipt: ReceiptOut | null, given: CaptureFields = {}): ReceiptCaptureView['fields'] {
  const f = receipt?.fields
  return {
    amount: f?.amount ?? given.amount ?? null,
    currency: (f?.currency ?? given.currency ?? 'EUR').toUpperCase(),
    date: f?.date ?? given.date ?? null,
    merchant: f?.merchant ?? given.merchant ?? null,
    vat: (f?.vat.length ? f.vat : (given.vat ?? [])).slice(0, 5),
    paymentMethod: f?.paymentMethod ?? given.paymentMethod ?? null,
  }
}

function base(companyId: string, ctx: ViewContext, mode: ReceiptCaptureView['mode']): Omit<ReceiptCaptureView, 'title' | 'fields' | 'receipt'> {
  return {
    view: 'receipt-capture',
    companyId,
    mode,
    executionMode: ctx.executionMode,
    canAttach: ctx.canAttach,
    canExpense: ctx.canExpense,
    maxBytes: RECEIPT_MAX_BYTES,
    accept: RECEIPT_ACCEPT,
    outcome: null,
    candidates: [],
    proposal: null,
    approval: null,
    done: null,
    links: [{ label: 'Ouvrir les justificatifs dans Kledg', url: kledgPageUrl(companyId, 'banking/missing-receipts') }],
  }
}

function receiptOf(receipt: ReceiptOut | null): ReceiptCaptureView['receipt'] {
  return receipt ? { id: receipt.id, fileName: receipt.fileName, contentType: receipt.contentType, size: receipt.size, status: receipt.status } : null
}

/** The capture step: the file input and the fields the assistant read (capture_receipt). */
export function receiptCaptureForm(companyId: string, ctx: ViewContext, fields: CaptureFields, receipt: ReceiptOut | null = null): ReceiptCaptureView {
  return {
    ...base(companyId, ctx, 'capture'),
    title: receipt ? 'Justificatif déposé' : 'Déposer un justificatif',
    subtitle: receipt ? receipt.fileName : 'Photo ou PDF du ticket ou de la facture',
    notice: receipt
      ? 'Indiquez le montant TTC et la date lus sur le justificatif : Kledg cherche la transaction bancaire correspondante.'
      :'Prenez la photo ou choisissez le fichier, vérifiez le montant et la date, puis envoyez : Kledg cherche la transaction bancaire correspondante.',
    fields: fieldsOf(receipt, fields),
    receipt: receiptOf(receipt),
  }
}

export interface MatchOut {
  action: 'match'
  receipt: ReceiptOut
  outcome: 'matched' | 'candidates' | 'none' | 'attached' | 'expense' | 'discarded'
  match: CandidateOut | null
  candidates: CandidateOut[]
  reason: 'personal_payment' | 'no_candidate' | null
  expenseProposal: ProposalOut | null
}

const OUTCOME_TITLES: Record<MatchOut['outcome'], string> = {
  matched: 'Transaction trouvée',
  candidates: 'Transactions possibles',
  none: 'Aucune transaction ne correspond',
  attached: 'Justificatif déjà rattaché',
  expense: 'Justificatif déjà sur une note de frais',
  discarded: 'Justificatif abandonné',
}

function proposalOf(p: ProposalOut | null): ReceiptCaptureView['proposal'] {
  return p
    ? { date: p.date, merchant: p.merchant, amount: p.amount, category: p.categoryLabel, accountCode: p.accountCode, openDraft: p.openDraft?.number ?? null, needsEuroAmount: p.needsEuroAmount }
    : null
}

/** The result of a match (file_receipt action match), or of a staging without fields. */
export function receiptMatchView(companyId: string, ctx: ViewContext, out: MatchOut): ReceiptCaptureView {
  const candidates = (out.outcome === 'matched' && out.match ? [out.match, ...out.candidates.filter((c) => c.transactionId !== out.match!.transactionId)] : out.candidates).slice(0, 5)
  const notice =
    out.outcome === 'matched'
      ? 'Une seule transaction correspond au montant, à la date et au commerçant. Rattachez-y le justificatif.'
      : out.outcome === 'candidates'
        ? 'Plusieurs transactions peuvent correspondre : choisissez la bonne, ou créez une note de frais si la dépense a été payée personnellement.'
        : out.outcome === 'none'
          ? out.reason === 'personal_payment'
            ? 'Payée personnellement (carte personnelle ou espèces) : c’est une note de frais.'
            : 'Aucune dépense de la banque ne correspond (montant, date de 3 jours avant à 10 jours après). Est-ce une note de frais ?'
          : undefined
  const receipt = out.receipt
  return {
    ...base(companyId, ctx, 'result'),
    title: OUTCOME_TITLES[out.outcome],
    subtitle: receipt.fields.merchant ? `${receipt.fields.merchant}${receipt.fields.date ? `, ${formatIsoDateFr(receipt.fields.date)}` : ''}` : receipt.fileName,
    ...(notice && { notice }),
    fields: fieldsOf(receipt),
    receipt: receiptOf(receipt),
    outcome: out.outcome,
    candidates: candidates.map(candidateOf),
    proposal: proposalOf(out.expenseProposal),
  }
}

export interface AttachPreviewOut {
  receipt: { id: string; fileName: string; contentType: string; size: number }
  transaction: CandidateOut
  destination: 'qonto' | 'kledg'
  alreadyAttached: boolean
  effect: string
}

/** The dry run of an attach: confirm (automatic mode), or approve in Kledg (validation mode). */
export function receiptApprovalView(
  companyId: string,
  ctx: ViewContext,
  preview: AttachPreviewOut,
  pending: { actionId: string | null; approvalUrl: string | null },
): ReceiptCaptureView {
  return {
    ...base(companyId, ctx, 'approval'),
    title: 'Rattacher le justificatif',
    subtitle: preview.receipt.fileName,
    notice:
      pending.actionId !== null
        ? 'Aperçu seulement : rien n’a été fait. Approuvez l’action dans Kledg (l’assistant ne peut pas l’approuver), puis exécutez-la ici.'
        : 'Aperçu seulement : rien n’a été fait. Confirmez pour rattacher le justificatif.',
    fields: fieldsOf(null),
    receipt: { id: preview.receipt.id, fileName: preview.receipt.fileName, contentType: preview.receipt.contentType, size: preview.receipt.size, status: preview.alreadyAttached ? 'attached' : 'staged' },
    approval: {
      transactionId: preview.transaction.transactionId,
      destination: preview.destination,
      effect: preview.effect,
      transaction: candidateOf(preview.transaction),
      actionId: pending.actionId,
      approvalUrl: pending.approvalUrl,
    },
  }
}

/** A receipt filed: attached to its transaction, added to an expense report, or discarded. */
export function receiptDoneView(
  companyId: string,
  ctx: ViewContext,
  done: { kind: 'attached' | 'expense' | 'discarded'; receipt: ReceiptOut | null; message: string; link?: { label: string; page: string } },
): ReceiptCaptureView {
  const view = base(companyId, ctx, 'done')
  return {
    ...view,
    title: done.kind === 'attached' ? 'Justificatif rattaché' : done.kind === 'expense' ? 'Note de frais préparée' : 'Justificatif abandonné',
    fields: fieldsOf(done.receipt),
    receipt: receiptOf(done.receipt),
    outcome: done.kind === 'discarded' ? 'discarded' : done.kind,
    done: { kind: done.kind, message: done.message },
    links: done.link ? [{ label: done.link.label, url: kledgPageUrl(companyId, done.link.page) }, ...(view.links ?? [])] : view.links,
  }
}
