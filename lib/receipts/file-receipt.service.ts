/**
 * Filing a staged receipt (docs/justificatifs-photo.md): find the bank
 * transaction it belongs to, attach it, or turn it into an expense line.
 * The MCP tool file_receipt and the Justificatifs page call these services.
 *
 * - Matching (matchStagedReceipt): the fields read on the receipt (amount
 *   TTC, currency, date, merchant, VAT, how it was paid) are recorded on the
 *   staged receipt, then the company's debit transactions around its date
 *   are scored (match-receipt.ts, pure). No model call: the assistant reads
 *   the photo, or the user types the fields.
 * - Attaching (attachStagedReceipt): for a Qonto account the file goes to
 *   Qonto's attachments API with the company's own credentials (the path of
 *   upload_receipt and of the simple mode, uploadQontoReceipt), within the
 *   per-company limit of bank calls and with an idempotency key derived from
 *   the receipt and the transaction; Kledg then drops its copy. For another
 *   bank, which has no receipt API, Kledg keeps the file and links it to
 *   the transaction (an attachment with receiptFileId): the Justificatifs
 *   page counts it as provided and the receipt proxy serves it.
 * - Expense report (expenseFromStagedReceipt): a line prefilled with the
 *   receipt's date, merchant, amount and VAT (one line per VAT rate, as the
 *   expense module asks), its category from the company's keyword rules,
 *   and the receipt attached, added to the user's own brouillon covering
 *   that day if there is one, else to a new brouillon for the month. Never
 *   submitted nor validated: the user finishes it in Kledg.
 *
 * Idempotent on the same file: the receipt is claimed with a conditional
 * update (staged to attached or expense) before anything is filed, so a
 * retried or concurrent call files it once and answers what was done.
 */

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { calendarDay, centsField, optionalText } from '@/lib/api/zod-fields'
import { transactionOfCompany } from '@/lib/api/resources'
import { limitBankCalls } from '@/lib/banking/guard'
import { uploadQontoReceipt } from '@/lib/integrations/providers/qonto/sync-attachments'
import { detectSupplier, indexTiers } from './detect-supplier'
import { EXPENSE_CATEGORIES, EXPENSE_LINE_CATEGORIES, type ExpenseCategory } from '@/lib/expense-reports/categories'
import { matchCategoryRule } from '@/lib/expense-reports/category-rules'
import { listCategoryRules } from '@/lib/expense-reports/manage-category-rules.service'
import { appendExpenseLines, createExpenseReport, type ExpenseLineBody } from '@/lib/expense-reports/manage-expense-reports.service'
import type { ExpenseActor } from '@/lib/expense-reports/actor'
import { isFrenchVatRate } from '@/lib/invoices/amounts'
import { calendarDayOf, isoDateToUtc, lastDayOfMonth } from '@/lib/utils/date'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import { candidateWindow, matchReceipt, originalAmountOf, PAYMENT_HINTS, type PaymentHint, type ScoredCandidate, type TransactionCandidate } from './match-receipt'
import {
  STAGED_SELECT,
  findStagedReceipt,
  stagedReceiptView,
  type ReceiptVatLine,
  type StagedReceiptActor,
  type StagedReceiptRow,
  type StagedReceiptView,
} from './stage-receipt.service'

/** Transactions scored for one receipt, at most: the window is two weeks of one company's debits. */
const MAX_TRANSACTIONS = 500
const MAX_TIERS = 5000

/** Fields read on a receipt, in cents (the MCP tool converts the euros of the assistant). */
export const ReceiptFieldsSchema = z.object({
  amountCents: centsField({ min: 1, invalid: 'Montant TTC invalide', negative: 'Le montant TTC doit être positif' }),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Devise invalide : un code à trois lettres (EUR, USD...)')
    .transform((value) => value.toUpperCase())
    .default('EUR'),
  date: calendarDay('Date du justificatif invalide'),
  merchant: optionalText(200),
  vatLines: z
    .array(
      z.object({
        rateBp: z.number().int().min(0).max(10_000),
        amountCents: centsField({ min: 0, invalid: 'TVA invalide', negative: 'La TVA ne peut pas être négative' }),
      }),
    )
    .max(5, '5 taux de TVA au plus')
    .default([]),
  paymentHint: z.enum(PAYMENT_HINTS, { error: 'Moyen de paiement inconnu' }).nullish(),
})
export type ReceiptFieldsInput = z.input<typeof ReceiptFieldsSchema>
export type ReceiptFields = z.output<typeof ReceiptFieldsSchema>

/** Body of POST /api/receipts/staged/[id]/match: the fields, or none to match with the recorded ones. */
export const MatchReceiptBodySchema = z.object({ fields: ReceiptFieldsSchema.optional() })

/** Body of POST /api/receipts/staged/[id]/attach. */
export const AttachReceiptBodySchema = z.object({ transactionId: z.string({ error: 'La transaction est requise' }).min(1, 'La transaction est requise').max(64) })

/** Body of POST /api/receipts/staged/[id]/expense. */
export const ExpenseFromReceiptBodySchema = z.object({
  category: z.enum(EXPENSE_LINE_CATEGORIES as [ExpenseCategory, ...ExpenseCategory[]], { error: 'Catégorie inconnue' }).optional(),
  label: optionalText(300),
})
export type ExpenseFromReceiptInput = z.infer<typeof ExpenseFromReceiptBodySchema>

export interface CandidateView {
  transactionId: string
  date: string
  label: string | null
  counterpartyName: string | null
  /** Debit, positive, in cents. */
  amountCents: number
  bankAccountName: string
  bankProvider: string
  /** The receipt is sent to the bank (Qonto); else Kledg keeps it. */
  sendsToBank: boolean
  score: number
  reasons: string[]
}

export interface ExpenseProposal {
  date: string
  merchant: string | null
  amountCents: number
  currency: string
  vatLines: ReceiptVatLine[]
  category: ExpenseCategory
  categoryLabel: string
  accountCode: string | null
  /** The user's own brouillon covering the day, which the line joins; null: a new brouillon for the month. */
  openDraft: { id: string; number: string } | null
  /** A receipt in another currency: the expense line needs the amount in euros. */
  needsEuroAmount: boolean
}

export type MatchOutcomeName = 'matched' | 'candidates' | 'none' | 'attached' | 'expense' | 'discarded'

export interface ReceiptMatchResult {
  receipt: StagedReceiptView
  outcome: MatchOutcomeName
  match: CandidateView | null
  candidates: CandidateView[]
  /** none: paid personally (personal_payment) or no transaction found (no_candidate). */
  reason: 'personal_payment' | 'no_candidate' | null
  expenseProposal: ExpenseProposal | null
}

function fieldsOf(row: StagedReceiptRow): ReceiptFields | null {
  const view = stagedReceiptView(row)
  if (view.fields.amountCents === null || !view.fields.date) return null
  return {
    amountCents: view.fields.amountCents,
    currency: view.fields.currency ?? 'EUR',
    date: view.fields.date,
    merchant: view.fields.merchant,
    vatLines: view.fields.vatLines,
    paymentHint: (view.fields.paymentHint as PaymentHint | null) ?? null,
  }
}

const MISSING_FIELDS = 'Indiquez le montant TTC et la date du justificatif (et le commerçant si possible) pour le rattacher.'

/** Records the fields read on a staged receipt (only while it is staged). */
async function recordFields(companyId: string, row: StagedReceiptRow, fields: ReceiptFields): Promise<StagedReceiptRow> {
  if (row.status !== 'staged') return row
  return prisma.stagedReceipt.update({
    where: { id: row.id },
    data: {
      amount: centsToDecimal(fields.amountCents),
      currency: fields.currency,
      receiptDate: isoDateToUtc(fields.date),
      merchantName: fields.merchant ?? null,
      vatLines: fields.vatLines.length ? (fields.vatLines as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      paymentHint: fields.paymentHint ?? null,
    },
    select: STAGED_SELECT,
  })
}

const TRANSACTION_SELECT = {
  id: true,
  date: true,
  amount: true,
  side: true,
  label: true,
  counterpartyName: true,
  providerData: true,
  _count: { select: { attachments: true } },
  bankAccount: { select: { name: true, displayName: true, bankConnection: { select: { provider: true } } } },
} satisfies Prisma.BankTransactionSelect

type TransactionRow = Prisma.BankTransactionGetPayload<{ select: typeof TRANSACTION_SELECT }>

function candidateView(row: TransactionRow, scored: ScoredCandidate | null): CandidateView {
  const provider = row.bankAccount.bankConnection.provider
  return {
    transactionId: row.id,
    date: calendarDayOf(row.date) as string,
    label: row.label,
    counterpartyName: row.counterpartyName,
    amountCents: Math.abs(parseCents(row.amount) ?? 0),
    bankAccountName: row.bankAccount.displayName || row.bankAccount.name,
    bankProvider: provider,
    sendsToBank: provider === 'QONTO',
    score: scored?.score ?? 0,
    reasons: scored?.reasons ?? [],
  }
}

/** The user's own brouillon whose period covers `day`, the most recently edited. */
async function openDraftOf(companyId: string, userId: string, day: string): Promise<{ id: string; number: string } | null> {
  const date = isoDateToUtc(day)
  return prisma.expenseReport.findFirst({
    where: { companyId, status: 'DRAFT', entryId: null, claimant: { userId }, periodStart: { lte: date }, periodEnd: { gte: date } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, number: true },
  })
}

async function proposalOf(companyId: string, userId: string, fields: ReceiptFields): Promise<ExpenseProposal> {
  const { rules } = await listCategoryRules(companyId)
  const rule = fields.merchant ? matchCategoryRule(rules, { supplierName: fields.merchant }) : null
  const category: ExpenseCategory = rule?.category && rule.category !== 'MILEAGE' ? rule.category : 'OTHER'
  return {
    date: fields.date,
    merchant: fields.merchant ?? null,
    amountCents: fields.amountCents,
    currency: fields.currency,
    vatLines: fields.vatLines,
    category,
    categoryLabel: EXPENSE_CATEGORIES[category].label,
    accountCode: rule?.accountCode ?? EXPENSE_CATEGORIES[category].account,
    openDraft: await openDraftOf(companyId, userId, fields.date),
    needsEuroAmount: fields.currency !== 'EUR',
  }
}

/** Candidates of a receipt among the company's transactions (read only). */
async function scoreTransactions(companyId: string, fields: ReceiptFields) {
  const window = candidateWindow(fields.date)
  const rows = await prisma.bankTransaction.findMany({
    where: {
      ...transactionOfCompany(companyId),
      side: 'debit',
      date: { gte: isoDateToUtc(window.from), lte: isoDateToUtc(window.to) },
      OR: [{ status: null }, { status: { not: 'declined' } }],
    },
    select: TRANSACTION_SELECT,
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    take: MAX_TRANSACTIONS,
  })
  const tiers = indexTiers(
    rows.length === 0
      ? []
      : await prisma.tiers.findMany({ where: { companyId, kind: 'SUPPLIER' }, select: { id: true, name: true, kind: true, auxiliaryAccountNumber: true }, orderBy: { id: 'asc' }, take: MAX_TIERS }),
  )
  const candidates: TransactionCandidate[] = rows.map((row) => {
    const supplier = detectSupplier({ label: row.label, counterpartyName: row.counterpartyName, side: 'debit' }, tiers)
    return {
      id: row.id,
      date: calendarDayOf(row.date) as string,
      amountCents: Math.abs(parseCents(row.amount) ?? 0),
      side: row.side === 'credit' ? 'credit' : 'debit',
      label: row.label,
      counterpartyName: row.counterpartyName,
      original: originalAmountOf(row.providerData),
      hasReceipt: row._count.attachments > 0,
      supplierNames: supplier ? [supplier.name] : [],
    }
  })
  return { rows: new Map(rows.map((row) => [row.id, row])), outcome: matchReceipt({ ...fields, merchant: fields.merchant ?? null, paymentHint: fields.paymentHint ?? null }, candidates) }
}

/**
 * Records the fields read on a staged receipt (when given) and finds its
 * transaction: matched, candidates, or none (with the expense report Kledg
 * would prepare). A receipt already filed answers where it went.
 */
export async function matchStagedReceipt(companyId: string, id: string, actor: StagedReceiptActor, input?: ReceiptFields): Promise<ReceiptMatchResult> {
  let row = await findStagedReceipt(companyId, id, actor)
  if (row.status !== 'staged') {
    return { receipt: stagedReceiptView(row), outcome: row.status as MatchOutcomeName, match: null, candidates: [], reason: null, expenseProposal: null }
  }
  if (input) row = await recordFields(companyId, row, input)
  const fields = fieldsOf(row)
  if (!fields) throw new ValidationError(MISSING_FIELDS)
  const { rows, outcome } = await scoreTransactions(companyId, fields)
  const view = (c: ScoredCandidate) => candidateView(rows.get(c.transactionId)!, c)
  const receipt = stagedReceiptView(row)
  if (outcome.outcome === 'none') {
    return { receipt, outcome: 'none', match: null, candidates: [], reason: outcome.reason, expenseProposal: await proposalOf(companyId, actor.userId, fields) }
  }
  return {
    receipt,
    outcome: outcome.outcome,
    match: outcome.outcome === 'matched' ? view(outcome.match) : null,
    candidates: outcome.candidates.map(view),
    reason: null,
    // Paid personally after all? The proposal stays available next to the candidates.
    expenseProposal: outcome.outcome === 'candidates' ? await proposalOf(companyId, actor.userId, fields) : null,
  }
}

async function transactionToAttach(companyId: string, transactionId: string): Promise<TransactionRow> {
  const row = await prisma.bankTransaction.findFirst({ where: { id: transactionId, ...transactionOfCompany(companyId) }, select: TRANSACTION_SELECT })
  if (!row) throw new NotFoundError('Transaction introuvable')
  return row
}

export interface AttachPreview {
  receipt: { id: string; fileName: string; contentType: string; size: number; sha256: string }
  transaction: CandidateView & { receipts: number }
  destination: 'qonto' | 'kledg'
  /** The receipt is already attached to this transaction: nothing will be done. */
  alreadyAttached: boolean
  effect: string
}

function assertAttachable(row: StagedReceiptRow, transactionId: string): boolean {
  if (row.status === 'attached') {
    if (row.bankTransactionId === transactionId) return true
    throw new ConflictError('Ce justificatif est déjà rattaché à une autre transaction.')
  }
  if (row.status === 'expense') throw new ConflictError('Ce justificatif est déjà sur une note de frais.')
  if (row.status === 'discarded') throw new ConflictError('Ce justificatif a été abandonné : déposez-le de nouveau.')
  if (!row.fileId) throw new ConflictError('Le fichier de ce justificatif n’est plus conservé par Kledg : déposez-le de nouveau.')
  return false
}

/** What attaching would do, without writing (the dry run of file_receipt). */
export async function previewAttachReceipt(companyId: string, id: string, actor: StagedReceiptActor, transactionId: string): Promise<AttachPreview> {
  const row = await findStagedReceipt(companyId, id, actor)
  const alreadyAttached = assertAttachable(row, transactionId)
  const transaction = await transactionToAttach(companyId, transactionId)
  const destination = transaction.bankAccount.bankConnection.provider === 'QONTO' ? 'qonto' : 'kledg'
  return {
    receipt: { id: row.id, fileName: row.fileName, contentType: row.contentType, size: row.size, sha256: row.sha256 },
    transaction: { ...candidateView(transaction, null), receipts: transaction._count.attachments },
    destination,
    alreadyAttached,
    effect: alreadyAttached
      ? 'Déjà rattaché à cette transaction : rien ne sera fait.'
      : destination === 'qonto'
        ? 'Le justificatif sera envoyé à Qonto sur cette transaction (Kledg ne pourra pas le reprendre), puis Kledg supprimera sa copie.'
        : 'Kledg conservera le justificatif et le rattachera à cette transaction (votre banque n’accepte pas de justificatif par API).',
  }
}

/** A UUID derived from the receipt and the transaction: Qonto's idempotency key, the same on every retry. */
function idempotencyKey(stagedReceiptId: string, transactionId: string): string {
  const hex = createHash('sha256').update(`kledg:receipt:${stagedReceiptId}:${transactionId}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export interface AttachResult {
  receipt: StagedReceiptView
  transactionId: string
  destination: 'qonto' | 'kledg'
  /** Already attached before this call: nothing was done. */
  alreadyAttached: boolean
  /** Receipts of the transaction known to Kledg now. */
  receipts: number
}

/** Attaches a staged receipt to a transaction of the company (see the module header). */
export async function attachStagedReceipt(companyId: string, id: string, actor: StagedReceiptActor, transactionId: string, options: { source?: string } = {}): Promise<AttachResult> {
  const row = await findStagedReceipt(companyId, id, actor)
  const transaction = await transactionToAttach(companyId, transactionId)
  const destination = transaction.bankAccount.bankConnection.provider === 'QONTO' ? 'qonto' : 'kledg'
  const done = async (alreadyAttached: boolean): Promise<AttachResult> => ({
    receipt: stagedReceiptView(await findStagedReceipt(companyId, id, actor)),
    transactionId,
    destination,
    alreadyAttached,
    receipts: await prisma.attachment.count({ where: { companyId, bankTransactionId: transactionId } }),
  })
  if (assertAttachable(row, transactionId)) return done(true)

  if (destination === 'kledg') {
    const attached = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string; bankTransactionId: string | null; fileId: string | null }>>`
        SELECT "status", "bankTransactionId", "fileId" FROM "staged_receipts" WHERE "id" = ${id} AND "companyId" = ${companyId} FOR UPDATE`
      const current = locked[0]
      if (!current) throw new NotFoundError('Justificatif introuvable')
      if (current.status !== 'staged' || !current.fileId) return assertAttachable({ ...row, status: current.status, bankTransactionId: current.bankTransactionId, fileId: current.fileId }, transactionId)
      const attachment = await tx.attachment.create({
        data: {
          companyId,
          bankTransactionId: transactionId,
          fileName: row.fileName,
          fileSize: row.size,
          fileContentType: row.contentType,
          receiptFileId: current.fileId,
          providerData: { source: 'kledg', stagedReceiptId: id },
        },
        select: { id: true },
      })
      await tx.stagedReceipt.update({ where: { id }, data: { status: 'attached', bankTransactionId: transactionId, attachmentId: attachment.id } })
      return false
    })
    if (!attached) await writeAuditLog('info', 'Receipt attached to a transaction (kept by Kledg)', { action: 'RECEIPT_ATTACHED', companyId, metadata: { stagedReceiptId: id, transactionId, destination, source: options.source ?? 'web' } })
    return done(attached)
  }

  // Qonto: claim the receipt first, so a concurrent call never sends it twice.
  const claimed = await prisma.stagedReceipt.updateMany({ where: { id, companyId, status: 'staged' }, data: { status: 'attached', bankTransactionId: transactionId } })
  if (claimed.count === 0) {
    const now = await findStagedReceipt(companyId, id, actor)
    return done(assertAttachable(now, transactionId))
  }
  try {
    const file = await prisma.receiptFile.findFirst({ where: { id: row.fileId!, companyId }, select: { content: true } })
    if (!file) throw new ConflictError('Le fichier de ce justificatif n’est plus conservé par Kledg : déposez-le de nouveau.')
    await limitBankCalls(companyId)
    const body = new File([new Uint8Array(file.content) as BlobPart], row.fileName, { type: row.contentType })
    await uploadQontoReceipt(companyId, transactionId, body, idempotencyKey(id, transactionId))
  } catch (error) {
    await prisma.stagedReceipt.updateMany({ where: { id, companyId, status: 'attached', bankTransactionId: transactionId }, data: { status: 'staged', bankTransactionId: null } })
    throw error
  }
  // The receipt lives at Qonto now (synchronized back as an attachment): Kledg drops its copy.
  await prisma.stagedReceipt.update({ where: { id }, data: { fileId: null } })
  await prisma.receiptFile.deleteMany({ where: { companyId, id: row.fileId!, stagedReceipts: { none: {} }, attachments: { none: {} } } })
  await writeAuditLog('info', 'Receipt sent to the bank', { action: 'RECEIPT_ATTACHED', companyId, metadata: { stagedReceiptId: id, transactionId, destination, source: options.source ?? 'web' } })
  return done(false)
}

/** The lines of the receipt: one per VAT rate (the expense module wants one rate per line), the last one takes the rest. */
function expenseLinesOf(fields: ReceiptFields, input: ExpenseFromReceiptInput, attachmentId: string): ExpenseLineBody[] {
  const label = input.label ?? (fields.merchant ? `${fields.merchant}` : 'Dépense')
  const base = {
    kind: 'EXPENSE' as const,
    date: fields.date,
    supplierName: fields.merchant ?? null,
    label,
    category: input.category,
    accountCode: null,
    receiptKind: 'RECEIPT' as const,
    receiptAttachmentId: attachmentId,
    receiptReference: null,
    electric: false,
    mealTaker: null,
  }
  const rates = fields.vatLines.filter((v) => v.amountCents > 0 && v.rateBp > 0)
  for (const v of rates) {
    if (!isFrenchVatRate(v.rateBp)) throw new ValidationError(`Taux de TVA ${v.rateBp / 100} % non français : une TVA payée à l’étranger se saisit à 0 % (indiquez vatLines vide).`)
  }
  if (rates.length <= 1) {
    const vat = rates[0]
    return [{ ...base, amountInclTaxCents: fields.amountCents, vatRateBp: vat?.rateBp ?? 0, vatCents: vat?.amountCents ?? 0 }]
  }
  // HT of each rate is its VAT divided by the rate; the TTC of all lines but the last one is HT + VAT.
  const lines = rates.map((v, i) => {
    const ttc = i === rates.length - 1 ? 0 : v.amountCents + Math.round((v.amountCents * 10_000) / v.rateBp)
    return { ...base, label: `${label} (TVA ${v.rateBp / 100} %)`, amountInclTaxCents: ttc, vatRateBp: v.rateBp, vatCents: v.amountCents }
  })
  const others = lines.slice(0, -1).reduce((sum, l) => sum + l.amountInclTaxCents, 0)
  lines[lines.length - 1].amountInclTaxCents = fields.amountCents - others
  if (lines[lines.length - 1].amountInclTaxCents <= 0) throw new ValidationError('Les montants de TVA dépassent le montant TTC du justificatif.')
  return lines
}

export interface ExpenseResult {
  receipt: StagedReceiptView
  reportId: string
  number: string
  /** A new brouillon was created (else the lines joined the user's open brouillon). */
  created: boolean
  /** The receipt was already on this report before the call: nothing was done. */
  alreadyDone: boolean
  totalOwedCents: number
  lines: number
}

/** What the expense action would do, without writing. */
export async function previewExpenseFromReceipt(companyId: string, id: string, actor: StagedReceiptActor): Promise<ExpenseProposal & { alreadyDone: { reportId: string | null } | null }> {
  const row = await findStagedReceipt(companyId, id, actor)
  if (row.status === 'expense') {
    const fields = fieldsOf(row)
    if (!fields) throw new ValidationError(MISSING_FIELDS)
    return { ...(await proposalOf(companyId, actor.userId, fields)), alreadyDone: { reportId: row.expenseReportId } }
  }
  if (row.status !== 'staged') throw new ConflictError(row.status === 'attached' ? 'Ce justificatif est déjà rattaché à une transaction.' : 'Ce justificatif a été abandonné : déposez-le de nouveau.')
  const fields = fieldsOf(row)
  if (!fields) throw new ValidationError(MISSING_FIELDS)
  return { ...(await proposalOf(companyId, actor.userId, fields)), alreadyDone: null }
}

/**
 * Turns a staged receipt into an expense line of the user's own report
 * (see the module header): a brouillon they finish and submit in Kledg.
 */
export async function expenseFromStagedReceipt(
  companyId: string,
  id: string,
  actor: StagedReceiptActor,
  expenseActor: ExpenseActor,
  input: ExpenseFromReceiptInput = {},
  options: { source?: string } = {},
): Promise<ExpenseResult> {
  const row = await findStagedReceipt(companyId, id, actor)
  const fields = fieldsOf(row)
  if (row.status === 'expense' && row.expenseReportId) {
    const report = await prisma.expenseReport.findFirst({ where: { id: row.expenseReportId, companyId }, select: { id: true, number: true, totalInclTax: true, _count: { select: { lines: true } } } })
    if (report) return { receipt: stagedReceiptView(row), reportId: report.id, number: report.number, created: false, alreadyDone: true, totalOwedCents: parseCents(report.totalInclTax) ?? 0, lines: report._count.lines }
  }
  if (row.status !== 'staged') throw new ConflictError(row.status === 'attached' ? 'Ce justificatif est déjà rattaché à une transaction.' : 'Ce justificatif a été abandonné : déposez-le de nouveau.')
  if (!fields) throw new ValidationError(MISSING_FIELDS)
  if (fields.currency !== 'EUR') {
    throw new ValidationError(`Justificatif en ${fields.currency} : une note de frais est en euros. Indiquez le montant débité en euros (relevé de la carte) avec la devise EUR, puis recommencez.`)
  }
  if (!row.fileId) throw new ConflictError('Le fichier de ce justificatif n’est plus conservé par Kledg : déposez-le de nouveau.')

  // Claim the receipt: a concurrent call finds it taken and creates nothing.
  const claimed = await prisma.stagedReceipt.updateMany({ where: { id, companyId, status: 'staged' }, data: { status: 'expense' } })
  if (claimed.count === 0) {
    const now = await findStagedReceipt(companyId, id, actor)
    if (now.status === 'expense' && now.expenseReportId) return expenseFromStagedReceipt(companyId, id, actor, expenseActor, input, options)
    throw new ConflictError('Ce justificatif est en cours de classement\u00a0: réessayez dans un instant.')
  }
  let attachmentId: string | null = null
  try {
    const attachment = await prisma.attachment.create({
      data: { companyId, fileName: row.fileName, fileSize: row.size, fileContentType: row.contentType, receiptFileId: row.fileId, providerData: { source: 'kledg', stagedReceiptId: id } },
      select: { id: true },
    })
    attachmentId = attachment.id
    const lines = expenseLinesOf(fields, input, attachment.id)
    const [year, month] = fields.date.split('-').map(Number)
    const createReport = () =>
      createExpenseReport(
        companyId,
        { label: null, periodStart: `${fields.date.slice(0, 7)}-01`, periodEnd: `${fields.date.slice(0, 7)}-${String(lastDayOfMonth(year, month)).padStart(2, '0')}`, lines },
        expenseActor,
        { source: options.source },
      )
    let draft = await openDraftOf(companyId, expenseActor.userId, fields.date)
    let report: Awaited<ReturnType<typeof createReport>>
    try {
      report = draft ? await appendExpenseLines(companyId, draft.id, lines, expenseActor, { source: options.source }) : await createReport()
    } catch (error) {
      // The open brouillon does not take the line (a line of it to fix, edited meanwhile): a new brouillon of the month does.
      if (!draft || !(error instanceof ValidationError || error instanceof ConflictError)) throw error
      draft = null
      report = await createReport()
    }
    const line = report.lines.find((l) => l.receiptAttachmentId === attachment.id)
    await prisma.stagedReceipt.update({ where: { id }, data: { expenseReportId: report.id, expenseLineId: line?.id ?? null, attachmentId: attachment.id } })
    await writeAuditLog('info', 'Receipt added to an expense report', {
      action: 'RECEIPT_EXPENSE',
      companyId,
      metadata: { stagedReceiptId: id, reportId: report.id, created: !draft, source: options.source ?? 'web' },
    })
    return {
      receipt: stagedReceiptView(await findStagedReceipt(companyId, id, actor)),
      reportId: report.id,
      number: report.number,
      created: !draft,
      alreadyDone: false,
      totalOwedCents: report.totalInclTaxCents,
      lines: report.lines.length,
    }
  } catch (error) {
    await prisma.stagedReceipt.updateMany({ where: { id, companyId, status: 'expense', expenseReportId: null }, data: { status: 'staged' } })
    if (attachmentId) await prisma.attachment.deleteMany({ where: { id: attachmentId, companyId, expenseLines: { none: {} } } })
    throw error
  }
}
