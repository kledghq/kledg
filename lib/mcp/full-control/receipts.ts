/**
 * Receipts photographed in Claude or ChatGPT (docs/justificatifs-photo.md):
 * capture_receipt opens the capture view, stage_receipt sends the file to
 * Kledg (the view, a ChatGPT file param or base64), file_receipt finds the
 * transaction, attaches the receipt or turns it into an expense line.
 *
 * Draft-level tools (kledg:write, `level: 'write'`), registered for every
 * connection that may write (lib/mcp/receipts-tools.ts) with the rights of
 * their routes (app/api/receipts/**): staging and the expense report need
 * expenses:submit (every role), matching banking:read, attaching
 * banking:reconcile. Attaching writes outside the drafts (at Qonto, which
 * Kledg cannot undo, or a receipt counted as provided): it is high impact.
 * On a draft-level connection it always waits for the user's approval in
 * Kledg; with full control it follows the execution mode (define.ts). The
 * expense action only prepares a brouillon the user submits in Kledg.
 *
 * Every result carries the data of the receipt capture view
 * (lib/mcp/views/receipt.ts), whose buttons call these same tools.
 */

import { z } from 'zod'
import { ValidationError } from '@/lib/accounting/errors'
import { expenseActorOf } from '@/lib/expense-reports/actor'
import { EXPENSE_LINE_CATEGORIES, type ExpenseCategory } from '@/lib/expense-reports/categories'
import { rateToBasisPoints } from '@/lib/invoices/amounts'
import { centsFromEuros, eurosInput, kledgPageUrl } from '@/lib/mcp/tool-meta'
import { viewMeta } from '@/lib/mcp/views'
import {
  receiptApprovalView,
  receiptCaptureForm,
  receiptDoneView,
  receiptMatchView,
  type AttachPreviewOut,
  type CandidateOut,
  type MatchOut,
  type ProposalOut,
  type ReceiptOut,
  type ViewContext,
} from '@/lib/mcp/views/receipt'
import { receiptActorOf } from '@/lib/receipts/actor'
import { RECEIPT_MAX_BYTES } from '@/lib/receipts/file-type'
import { PAYMENT_HINTS } from '@/lib/receipts/match-receipt'
import { fetchOpenAiFile } from '@/lib/receipts/openai-file'
import {
  attachStagedReceipt,
  expenseFromStagedReceipt,
  matchStagedReceipt,
  previewAttachReceipt,
  previewExpenseFromReceipt,
  ReceiptFieldsSchema,
  type CandidateView,
  type ExpenseProposal,
  type ReceiptFields,
  type ReceiptMatchResult,
} from '@/lib/receipts/file-receipt.service'
import { discardStagedReceipt, stageReceipt, type StagedReceiptView } from '@/lib/receipts/stage-receipt.service'
import { fromCents } from '@/lib/utils/money'
import { fullControlTool, type FullControlContext } from './define'
import { TWO_STEP } from './descriptions'
import { companyLock, rowTargets } from './fingerprint'
import { decodeBase64File } from './files'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu\u00a0: AAAA-MM-JJ')

/** What the assistant read on the receipt, in euros. */
const fieldInputs = {
  amount: eurosInput.optional().describe('Total paid, VAT included (TTC), in euros, as printed on the receipt.'),
  currency: z.string().regex(/^[A-Za-z]{3}$/, 'Devise\u00a0: un code à trois lettres').optional().describe('ISO code of the receipt currency, EUR by default.'),
  date: day.optional().describe('Date of the purchase printed on the receipt.'),
  merchant: z.string().max(200).optional().describe('Merchant or supplier name printed on the receipt.'),
  vat: z
    .array(z.object({ rate: z.number().min(0).max(100).describe('VAT rate in percent: 20, 10, 5.5 or 2.1.'), amount: eurosInput.describe('VAT amount of that rate, in euros.') }))
    .max(5)
    .optional()
    .describe('VAT amounts printed on the receipt, one per rate; omit when none is printed.'),
  paymentMethod: z
    .enum(PAYMENT_HINTS)
    .optional()
    .describe('How it was paid, when visible: company_card, personal_card, cash (personal_card and cash are expense reports), transfer, direct_debit, unknown.'),
}

type FieldArgs = { amount?: number; currency?: string; date?: string; merchant?: string; vat?: Array<{ rate: number; amount: number }>; paymentMethod?: (typeof PAYMENT_HINTS)[number] }

/** The fields in cents, or null when the amount or the date is missing. */
function fieldsFrom(args: FieldArgs): ReceiptFields | null {
  if (args.amount === undefined || !args.date) return null
  return ReceiptFieldsSchema.parse({
    amountCents: centsFromEuros(args.amount, 'amount'),
    currency: args.currency ?? 'EUR',
    date: args.date,
    merchant: args.merchant ?? null,
    vatLines: (args.vat ?? []).map((v, i) => {
      const rateBp = rateToBasisPoints(String(v.rate), 'percent')
      if (rateBp === null) throw new ValidationError(`vat[${i}]\u00a0: taux invalide.`)
      return { rateBp, amountCents: centsFromEuros(v.amount, `vat[${i}].amount`) }
    }),
    paymentHint: args.paymentMethod ?? null,
  })
}

function receiptOut(r: StagedReceiptView): ReceiptOut {
  return {
    id: r.id,
    fileName: r.fileName,
    contentType: r.contentType,
    size: r.size,
    status: r.status,
    fields: {
      amount: r.fields.amountCents === null ? null : fromCents(r.fields.amountCents),
      currency: r.fields.currency,
      date: r.fields.date,
      merchant: r.fields.merchant,
      vat: r.fields.vatLines.map((v) => ({ rate: v.rateBp / 100, amount: fromCents(v.amountCents) })),
      paymentMethod: r.fields.paymentHint,
    },
  }
}

function candidateOut(c: CandidateView): CandidateOut {
  return {
    transactionId: c.transactionId,
    date: c.date,
    label: c.label,
    counterpartyName: c.counterpartyName,
    amount: fromCents(c.amountCents),
    bankAccountName: c.bankAccountName,
    sendsToBank: c.sendsToBank,
    score: c.score,
    reasons: c.reasons,
  }
}

function proposalOut(p: ExpenseProposal | null): ProposalOut | null {
  return p
    ? { date: p.date, merchant: p.merchant, amount: fromCents(p.amountCents), category: p.category, categoryLabel: p.categoryLabel, accountCode: p.accountCode, openDraft: p.openDraft, needsEuroAmount: p.needsEuroAmount }
    : null
}

/** What the assistant should do next, per outcome (read by the model). */
const NEXT_STEPS: Record<MatchOut['outcome'], string> = {
  matched: 'One transaction matches: show it to the user, then call file_receipt with action attach, this stagedReceiptId and its transactionId.',
  candidates: 'Several transactions may match: show the candidates and let the user choose (the view has a Rattacher button per candidate), then call file_receipt with action attach and the chosen transactionId. If none is right, ask "Est-ce une note de frais\u00a0?".',
  none: 'No bank transaction matches. Ask the user "Est-ce une note de frais\u00a0?" (paid personally). On yes, call file_receipt with action expense and this stagedReceiptId: Kledg prepares a draft expense report the user finishes and submits in Kledg. Never answer for the user.',
  attached: 'This receipt is already attached to a transaction: nothing more to do.',
  expense: 'This receipt is already on an expense report: nothing more to do.',
  discarded: 'This receipt was discarded: stage it again to file it.',
}

function matchOut(result: ReceiptMatchResult): MatchOut & { nextStep: string } {
  return {
    action: 'match',
    receipt: receiptOut(result.receipt),
    outcome: result.outcome,
    match: result.match ? candidateOut(result.match) : null,
    candidates: result.candidates.map(candidateOut),
    reason: result.reason,
    expenseProposal: proposalOut(result.expenseProposal),
    nextStep: NEXT_STEPS[result.outcome],
  }
}

async function viewContext(ctx: FullControlContext & { executionMode: ViewContext['executionMode'] }): Promise<ViewContext> {
  return { executionMode: ctx.executionMode, canAttach: await ctx.can({ banking: ['reconcile'] }), canExpense: await ctx.can({ expenses: ['submit'] }) }
}

const HOW_TO_SEND =
  'Assistants cannot reliably send image bytes: prefer capture_receipt (the user takes the photo in the view) or, in ChatGPT, the file the user attached (file).'

// ------------------------------------------------------------------ capture_receipt

export const captureReceiptTool = fullControlTool({
  name: 'capture_receipt',
  title: 'Déposer un justificatif',
  level: 'write',
  description: `Opens the receipt capture view in the conversation (MCP Apps, ui://kledg/receipt-capture): the user takes a photo or picks a file (image or PDF; large photos are reduced in the view), checks the amount and the date, and the view stages it (stage_receipt) then looks for its bank transaction (file_receipt). Pass the fields you read on the photo the user showed you (amount TTC, date, merchant, VAT, payment method) to prefill the view. Use it when the user wants to file a receipt (justificatif, ticket, facture) photographed with their phone. ${HOW_TO_SEND}`,
  input: fieldInputs,
  permission: { expenses: ['submit'] },
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd, VAT rates in percent.',
  never: 'stores anything by itself: the user sends the file from the view.',
  readOnly: true,
  confirmation: false,
  meta: viewMeta('receipt-capture'),
  async execute(args) {
    return { action: 'capture', companyId: args.companyId, fields: { amount: args.amount ?? null, currency: args.currency ?? 'EUR', date: args.date ?? null, merchant: args.merchant ?? null }, nextStep: 'The capture view is shown: wait for the user to send the photo from it.' }
  },
  audit: null,
  view: async (args, _payload, ctx) => receiptCaptureForm(args.companyId, await viewContext(ctx), { amount: args.amount, currency: args.currency, date: args.date, merchant: args.merchant, vat: args.vat, paymentMethod: args.paymentMethod }),
})

// ------------------------------------------------------------------ stage_receipt

/** A file ChatGPT passes to the tool (Apps SDK file params): the four properties declared, download_url and file_id required. */
const openAiFile = z
  .object({
    download_url: z.string().max(4000),
    file_id: z.string().max(200),
    mime_type: z.string().max(200).optional(),
    file_name: z.string().max(255).optional(),
  })
  .describe('ChatGPT only: the image or PDF the user attached, filled by ChatGPT.')

const MAX_BASE64 = Math.ceil((RECEIPT_MAX_BYTES * 4) / 3) + 4

export const stageReceiptTool = fullControlTool({
  name: 'stage_receipt',
  title: 'Envoyer un justificatif à Kledg',
  level: 'write',
  description: `Sends a receipt (photo or PDF of a ticket or an invoice) to Kledg, where it waits to be filed (30 days): file (ChatGPT, the file the user attached), or contentBase64 with fileName (the capture view, or a client that can send the bytes). JPEG, PNG or PDF of 5 MB at most, checked from its content; HEIC is refused (the capture view converts it). The same file sent again returns the receipt already staged (or already filed), never a second one. With the fields read on the receipt (amount TTC and date at least), it also looks for the bank transaction, like file_receipt action match; otherwise call file_receipt with them. Returns stagedReceiptId. ${HOW_TO_SEND}`,
  input: {
    file: openAiFile.optional(),
    contentBase64: z.string().min(1).max(MAX_BASE64).optional().describe('The file, base64 encoded (5 MB at most before encoding).'),
    fileName: z.string().max(200).optional().describe('E.g. "ticket-boulangerie.jpg".'),
    from: z.enum(['capture_view']).optional().describe('Set by the capture view.'),
    ...fieldInputs,
  },
  permission: { expenses: ['submit'] },
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd, VAT rates in percent.',
  never: 'attaches the receipt to a transaction, sends it to the bank or creates an expense report (file_receipt does, after the user chose).',
  // A ChatGPT file is downloaded from OpenAI's file hosts.
  openWorld: true,
  idempotent: true,
  confirmation: false,
  meta: { ...viewMeta('receipt-capture'), 'openai/fileParams': ['file'] },
  async execute(args, ctx) {
    const actor = await receiptActorOf(ctx.access.user, args.companyId)
    let bytes: Uint8Array
    let fileName = args.fileName ?? null
    let source: 'view' | 'file_param' | 'base64'
    if (args.file) {
      bytes = await fetchOpenAiFile(args.file.download_url)
      fileName ??= args.file.file_name ?? null
      source = 'file_param'
    } else if (args.contentBase64) {
      bytes = decodeBase64File(args.contentBase64, RECEIPT_MAX_BYTES)
      source = args.from === 'capture_view' ? 'view' : 'base64'
    } else {
      throw new ValidationError('Joignez le fichier : file (ChatGPT) ou contentBase64. Sinon, ouvrez la vue de dépôt avec capture_receipt.')
    }
    const staged = await stageReceipt(args.companyId, actor, { bytes, fileName, source })
    const fields = fieldsFrom(args)
    if (fields || staged.receipt.status !== 'staged') {
      const result = await matchStagedReceipt(args.companyId, staged.receipt.id, actor, fields ?? undefined)
      return { stagedReceiptId: staged.receipt.id, duplicate: staged.duplicate, ...matchOut(result) }
    }
    return {
      action: 'stage' as const,
      stagedReceiptId: staged.receipt.id,
      duplicate: staged.duplicate,
      receipt: receiptOut(staged.receipt),
      nextStep: 'Read the amount TTC, the date and the merchant on the receipt, then call file_receipt with action match and this stagedReceiptId. If you cannot see the receipt, ask the user for them.',
    }
  },
  audit: (args, result) => ({ stagedReceiptId: result.stagedReceiptId, duplicate: result.duplicate, source: args.file ? 'file_param' : args.from === 'capture_view' ? 'view' : 'base64' }),
  view: async (args, payload, ctx) => {
    const out = payload as { action: string; receipt: ReceiptOut } & Partial<MatchOut>
    const vctx = await viewContext(ctx)
    if (out.action === 'match') return receiptMatchView(args.companyId, vctx, out as MatchOut)
    return receiptCaptureForm(args.companyId, vctx, { amount: args.amount, date: args.date, merchant: args.merchant }, out.receipt)
  },
})

// ------------------------------------------------------------------ file_receipt

export const fileReceiptTool = fullControlTool({
  name: 'file_receipt',
  title: 'Classer un justificatif',
  level: 'write',
  description: `Files a receipt staged with stage_receipt or the capture view. action match (default): records the fields you read on the photo (amount TTC, currency, date, merchant, VAT per rate, payment method) and looks for the company's bank debit without receipt: same amount (within a cent; the original amount for a foreign currency when the bank gives it), from 3 days before to 10 days after the date, merchant close to the label or the recognised supplier. It answers matched (one clear transaction), candidates (up to 5, scored, with reasons) or none, with nextStep. action attach: attaches the receipt to transactionId: sent to Qonto for a Qonto account (Kledg cannot take it back), else kept by Kledg and linked to the transaction; the same receipt is never attached twice. action expense: only after the user said it is an expense report (note de frais, paid personally): adds a line prefilled from the receipt (date, merchant, amount, VAT, category from the company's keyword rules, the receipt attached) to the user's own brouillon of that month, or a new brouillon; the user checks and submits it in Kledg. action discard: drops a receipt staged by mistake. Attach is high impact: ${TWO_STEP}`,
  input: {
    action: z.enum(['match', 'attach', 'expense', 'discard']).default('match'),
    stagedReceiptId: z.string().min(1).max(64).describe('From stage_receipt or the capture view.'),
    ...fieldInputs,
    transactionId: z.string().max(64).optional().describe('attach: the transaction, from the matched or candidate results.'),
    category: z
      .enum(EXPENSE_LINE_CATEGORIES as [ExpenseCategory, ...ExpenseCategory[]])
      .optional()
      .describe('expense: the category when the user gives one; omitted, the company keyword rules decide, else OTHER.'),
    label: z.string().max(300).optional().describe('expense: label of the line; omitted, the merchant.'),
  },
  permission: { banking: ['read'] },
  actions: { attach: { banking: ['reconcile'] }, expense: { expenses: ['submit'] }, discard: { expenses: ['submit'] } },
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd, VAT rates in percent.',
  never: 'submits, validates or posts an expense report, reconciles a transaction or books an entry.',
  // attach sends the receipt to Qonto
  openWorld: true,
  idempotent: true,
  confirmation: true,
  highImpactActions: ['attach'],
  // The approval covers the receipt and the transaction as the user saw them, under the company lock.
  targetState: ({ companyId, action, stagedReceiptId, transactionId }) =>
    action === 'attach' ? [companyLock(companyId), ...rowTargets('staged_receipts', companyId, stagedReceiptId), ...rowTargets('bank_transactions', companyId, transactionId)] : [],
  meta: viewMeta('receipt-capture'),
  async preview({ companyId, action, stagedReceiptId, transactionId }, ctx) {
    const actor = await receiptActorOf(ctx.access.user, companyId)
    if (action === 'attach') {
      if (!transactionId) throw new ValidationError('transactionId est requis pour rattacher le justificatif.')
      const preview = await previewAttachReceipt(companyId, stagedReceiptId, actor, transactionId)
      return { action, ...preview, transaction: { ...candidateOut(preview.transaction), receipts: preview.transaction.receipts } }
    }
    if (action === 'expense') {
      const proposal = await previewExpenseFromReceipt(companyId, stagedReceiptId, actor)
      return { action, proposal: proposalOut(proposal), effect: proposal.openDraft ? `Ligne ajoutée à la note de frais ${proposal.openDraft.number} (brouillon).` : 'Nouvelle note de frais en brouillon pour le mois.' }
    }
    return { action, effect: action === 'discard' ? 'Le justificatif et son fichier seront supprimés de Kledg.' : 'Recherche de la transaction, rien n’est classé.' }
  },
  async execute(args, ctx) {
    const { companyId, action, stagedReceiptId } = args
    const actor = await receiptActorOf(ctx.access.user, companyId)
    if (action === 'attach') {
      if (!args.transactionId) throw new ValidationError('transactionId est requis pour rattacher le justificatif.')
      const done = await attachStagedReceipt(companyId, stagedReceiptId, actor, args.transactionId, { source: 'mcp' })
      return {
        action: 'attach' as const,
        receipt: receiptOut(done.receipt),
        transactionId: done.transactionId,
        destination: done.destination,
        alreadyAttached: done.alreadyAttached,
        receipts: done.receipts,
        message: done.alreadyAttached
          ? 'Ce justificatif était déjà rattaché à cette transaction.'
          : done.destination === 'qonto'
            ? 'Justificatif envoyé à Qonto et rattaché à la transaction.'
            : 'Justificatif rattaché à la transaction et conservé par Kledg.',
        reviewUrl: kledgPageUrl(companyId, 'banking/missing-receipts'),
      }
    }
    if (action === 'expense') {
      const expenseActor = await expenseActorOf(ctx.access.user, companyId)
      const done = await expenseFromStagedReceipt(companyId, stagedReceiptId, actor, expenseActor, { category: args.category, label: args.label ?? null }, { source: 'mcp' })
      return {
        action: 'expense' as const,
        receipt: receiptOut(done.receipt),
        reportId: done.reportId,
        number: done.number,
        created: done.created,
        alreadyDone: done.alreadyDone,
        totalOwed: fromCents(done.totalOwedCents),
        lines: done.lines,
        message: done.alreadyDone
          ? `Ce justificatif est déjà sur la note de frais ${done.number}.`
          : `${done.created ? 'Note de frais' : 'Ligne ajoutée à la note de frais'} ${done.number} en brouillon : vérifiez-la et soumettez-la dans Kledg.`,
        reviewUrl: kledgPageUrl(companyId, `expense-reports/${done.reportId}`),
      }
    }
    if (action === 'discard') {
      const receipt = await discardStagedReceipt(companyId, stagedReceiptId, actor)
      return { action: 'discard' as const, receipt: receiptOut(receipt), message: 'Justificatif abandonné : son fichier est supprimé de Kledg.' }
    }
    return matchOut(await matchStagedReceipt(companyId, stagedReceiptId, actor, fieldsFrom(args) ?? undefined))
  },
  audit: (args, result) => ({
    action: args.action,
    stagedReceiptId: args.stagedReceiptId,
    transactionId: args.transactionId ?? null,
    ...('reportId' in result ? { reportId: result.reportId } : {}),
  }),
  view: async (args, payload, ctx) => {
    const vctx = await viewContext(ctx)
    const p = payload as { dryRun?: boolean; preview?: unknown; actionId?: string; approvalUrl?: string; executed?: boolean; result?: unknown }
    if (p.dryRun) {
      const preview = p.preview as AttachPreviewOut & { action: string }
      if (preview.action !== 'attach') throw new Error('No view for this dry run')
      return receiptApprovalView(args.companyId, vctx, preview, { actionId: p.actionId ?? null, approvalUrl: p.approvalUrl ?? null })
    }
    const result = (p.executed ? p.result : payload) as { action: string; receipt: ReceiptOut; message?: string; reportId?: string; number?: string; transactionId?: string }
    if (result.action === 'match') return receiptMatchView(args.companyId, vctx, result as unknown as MatchOut)
    if (result.action === 'attach') return receiptDoneView(args.companyId, vctx, { kind: 'attached', receipt: result.receipt, message: result.message ?? '' })
    if (result.action === 'expense') {
      return receiptDoneView(args.companyId, vctx, { kind: 'expense', receipt: result.receipt, message: result.message ?? '', link: { label: `Ouvrir la note de frais ${result.number ?? ''}`.trim(), page: `expense-reports/${result.reportId}` } })
    }
    return receiptDoneView(args.companyId, vctx, { kind: 'discarded', receipt: result.receipt, message: result.message ?? '' })
  },
})
