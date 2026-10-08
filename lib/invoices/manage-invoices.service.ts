/**
 * Purchase and sales invoices of a company, as records: list, read, create,
 * edit and delete drafts. Posting is in post-invoice.service.ts, payments in
 * invoice-payments.service.ts.
 *
 * Invariants owned here:
 * - every lookup is scoped by company (another company's invoice or tiers is
 *   a 404); the tiers of a sale is a customer, of a purchase a supplier;
 * - amounts are computed on the server from the lines, in cents, with the
 *   rounding rule of amounts.ts; a total sent by a client is never trusted;
 * - only French VAT rates are accepted on an invoice entered in Kledg, and
 *   none but 0 % on the sales of a company under the VAT franchise
 *   (CGI art. 293 B);
 * - the due date follows the payment terms of the tiers, else the
 *   company's, and a date typed by hand stays within the caps of Code de
 *   commerce art. L441-10;
 * - a sales invoice number is unique in the company (CGI ann. II art. 242
 *   nonies A, I, 7°: a unique number in a chronological, continuous
 *   sequence); a purchase invoice number is unique per supplier;
 * - where a sales number comes from is the invoice's origin: AUTO (Kledg's
 *   series, given when posted, numbering/series.ts: a draft has no number),
 *   MANUAL (typed: the company numbers elsewhere), RECORDED (an invoice
 *   already issued elsewhere, typed, outside the running series), QONTO
 *   (Qonto's number, create-in-qonto.service.ts), MANAGEMENT_FEES (the
 *   convention's series). The origin never changes once recorded;
 * - an invoice is edited or deleted only while it is a draft (no entry); a
 *   number given by the series stays with its invoice (no edit of the
 *   number or the date, no deletion: a credit note cancels it);
 *   an imported invoice keeps the document's amounts: only its accounts
 *   and natures change (updateInvoiceLineAccounts).
 */

import { Prisma, type InvoiceDirection, type InvoiceOrigin } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { calendarDay, centsField, optionalText } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { dayToDate } from '@/lib/accounting/entry-date'
import { getPaymentTerms } from '@/lib/companies/payment-terms.service'
import { termsOfTiers } from '@/lib/tiers/manage-tiers.service'
import { accountCodeError } from '@/lib/tiers/rules'
import { calendarDayOf, formatIsoDateFr } from '@/lib/utils/date'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import { computeInvoiceTotals, formatVatRate, isFrenchVatRate, parseQuantity, type InvoiceTotals } from './amounts'
import { assertInvoiceAmountsFit } from './amount-bounds'
import { assertOutsideRunningSeries, loadNumberingSettings, lockInvoiceNumbers, peekNextNumber } from './numbering/series'
import { VAT_EXEMPTION_CODES, invoiceExemptionMentions, isVatExemption, type VatExemption } from './vat-exemptions'
import { defaultDueDate, invoiceStatus, maxDueDate, remainingCents, type InvoiceStatus } from './status'
import { checkApprovedState } from '@/lib/approved-state/guard'

export const INVOICE_NOT_FOUND = 'Facture introuvable'

type Db = Prisma.TransactionClient | typeof prisma

/** A list cursor that is not an invoice of the company. */
const INVALID_CURSOR = 'Curseur invalide\u00a0: rechargez la liste.'

const directionSchema = z.enum(['SALE', 'PURCHASE'], { error: 'Choisissez une facture de vente ou d’achat' })

const lineSchema = z.object({
  label: z.string({ error: 'La désignation est requise' }).trim().min(1, 'La désignation est requise').max(500),
  quantity: z.union([z.string(), z.number()], { error: 'Quantité invalide' }),
  unitPriceCents: centsField({ min: 0, invalid: 'Prix unitaire invalide', negative: 'Le prix unitaire ne peut pas être négatif', integer: 'Prix unitaire en centimes' }),
  vatRateBp: z.number({ error: 'Taux de TVA invalide' }).int().min(0).max(10000),
  accountCode: optionalText(20),
  nature: z.enum(['GOODS', 'SERVICES']).default('SERVICES'),
  fixedAsset: z.boolean().default(false),
  /** Legal basis of an exempt 0 % sale line (vat-exemptions.ts); null: taxed or another 0 % operation. */
  vatExemption: z.enum(VAT_EXEMPTION_CODES, { error: 'Exonération inconnue' }).nullable().optional(),
})

const invoiceFields = {
  tiersId: z.string({ error: 'Choisissez le tiers' }).min(1, 'Choisissez le tiers').max(64),
  /** Absent for a sales invoice numbered by Kledg's series or by Qonto. */
  number: z.string({ error: 'Numéro invalide' }).trim().min(1, 'Le numéro est requis').max(60).nullish(),
  issueDate: calendarDay('Date de facture invalide'),
  dueDate: calendarDay('Date d’échéance invalide').nullish(),
  typeCode: z.enum(['380', '381']).default('380'),
  label: optionalText(500),
  lines: z.array(lineSchema, { error: 'Ajoutez au moins une ligne' }).min(1, 'Ajoutez au moins une ligne').max(200, '200 lignes au plus'),
}

/**
 * How a sales invoice gets its number: kledg (Kledg's series when the
 * numbering is automatic, else typed), qonto (created in Qonto, Qonto's
 * number), recorded (already issued elsewhere: the number is typed and
 * stays out of the series). Absent: the company's setting.
 */
export const INVOICE_NUMBERING_CHOICES = ['kledg', 'qonto', 'recorded'] as const
export type InvoiceNumberingChoice = (typeof INVOICE_NUMBERING_CHOICES)[number]

/** Body of POST /api/invoices. */
export const CreateInvoiceBodySchema = z.object({
  direction: directionSchema,
  ...invoiceFields,
  numbering: z.enum(INVOICE_NUMBERING_CHOICES, { error: 'Choisissez comment numéroter la facture' }).optional(),
  /** Created in Qonto: finalized (the default, numbered by Qonto) or a draft (numbered once finalized in Qonto). */
  qontoStatus: z.enum(['draft', 'finalized'], { error: 'Choisissez une facture finalisée ou un brouillon dans Qonto' }).optional(),
})
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceBodySchema>

/** Body of PATCH /api/invoices/[id] (a draft entered in Kledg). */
export const UpdateInvoiceBodySchema = z.object(invoiceFields)
export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceBodySchema>

/** Body of PATCH /api/invoices/[id]/lines: accounts and natures of the lines, the amounts unchanged. */
export const UpdateLineAccountsBodySchema = z.object({
  lines: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        accountCode: optionalText(20),
        nature: z.enum(['GOODS', 'SERVICES']).optional(),
        fixedAsset: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(200),
})

/** ?companyId=&direction=&status=&search=&tiersId=&cursor=&limit= */
export const ListInvoicesQuerySchema = z.object({
  direction: directionSchema,
  status: z.enum(['all', 'draft', 'posted']).default('all'),
  search: z.string().trim().max(100).optional(),
  tiersId: z.string().max(64).optional(),
  startDate: calendarDay('Date de début invalide').optional(),
  endDate: calendarDay('Date de fin invalide').optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type ListInvoicesQuery = z.infer<typeof ListInvoicesQuerySchema>

/** The tiers line of an invoice entry: its account is a 40 or 41 account. */
const TIERS_LINE_WHERE = { OR: [{ account: { code: { startsWith: '40' } } }, { account: { code: { startsWith: '41' } } }] } satisfies Prisma.EntryLineWhereInput

const SUMMARY_SELECT = {
  id: true,
  direction: true,
  number: true,
  issueDate: true,
  dueDate: true,
  typeCode: true,
  label: true,
  totalExclTax: true,
  totalVat: true,
  totalInclTax: true,
  source: true,
  origin: true,
  qontoRequestedAt: true,
  qontoDraft: true,
  externalId: true,
  externalStatus: true,
  externalAttachmentId: true,
  entryId: true,
  tiers: { select: { id: true, name: true, auxiliaryAccountNumber: true } },
  entry: { select: { id: true, entryNumber: true, status: true, lines: { where: TIERS_LINE_WHERE, select: { id: true, letteringCode: true } } } },
  payments: { select: { amount: true } },
} satisfies Prisma.InvoiceSelect

type SummaryRow = Prisma.InvoiceGetPayload<{ select: typeof SUMMARY_SELECT }>

const cents = (value: { toString(): string }) => parseCents(value) ?? 0

export interface InvoiceSummary {
  id: string
  direction: InvoiceDirection
  /** Null: a sales draft numbered when posted (origin AUTO), or waiting for Qonto. */
  number: string | null
  issueDate: string
  dueDate: string
  typeCode: string
  label: string | null
  tiers: { id: string; name: string; auxiliaryAccountNumber: string }
  totalExclTaxCents: number
  totalVatCents: number
  totalInclTaxCents: number
  paidCents: number
  remainingCents: number
  status: InvoiceStatus
  lettered: boolean
  letteringCode: string | null
  source: 'MANUAL' | 'QONTO'
  origin: InvoiceOrigin
  /** Kledg created the invoice in Qonto (Qonto-first), rather than importing it. */
  createdInQonto: boolean
  /** Qonto was asked to create the invoice and has not answered yet: resume it (POST /api/invoices/[id]/qonto). */
  qontoPending: boolean
  /** A draft in Qonto: numbered and postable once finalized in Qonto (the import completes it). */
  qontoDraft: boolean
  /** Id of the invoice at Qonto (created there or imported), null for an invoice Qonto never saw. */
  qontoId: string | null
  externalStatus: string | null
  hasAttachment: boolean
  entry: { id: string; entryNumber: string; status: string } | null
}

function summaryOf(row: SummaryRow): InvoiceSummary {
  const totalInclTaxCents = cents(row.totalInclTax)
  const paidCents = row.payments.reduce((sum, p) => sum + cents(p.amount), 0)
  const letteringCode = row.entry?.lines.find((l) => l.letteringCode)?.letteringCode ?? null
  const lettered = letteringCode !== null
  return {
    id: row.id,
    direction: row.direction,
    number: row.number,
    issueDate: calendarDayOf(row.issueDate) as string,
    dueDate: calendarDayOf(row.dueDate) as string,
    typeCode: row.typeCode,
    label: row.label,
    tiers: row.tiers,
    totalExclTaxCents: cents(row.totalExclTax),
    totalVatCents: cents(row.totalVat),
    totalInclTaxCents,
    paidCents,
    remainingCents: row.entry ? remainingCents({ totalInclTaxCents, paidCents, lettered }) : totalInclTaxCents,
    status: invoiceStatus({ posted: row.entry !== null, totalInclTaxCents, paidCents, lettered }),
    lettered,
    letteringCode,
    source: row.source,
    origin: row.origin,
    createdInQonto: row.origin === 'QONTO' && row.qontoRequestedAt !== null,
    qontoPending: row.origin === 'QONTO' && row.qontoRequestedAt !== null && row.externalId === null,
    qontoDraft: row.origin === 'QONTO' && row.qontoDraft,
    qontoId: row.source === 'QONTO' || row.origin === 'QONTO' ? row.externalId : null,
    externalStatus: row.externalStatus,
    hasAttachment: row.externalAttachmentId !== null,
    entry: row.entry ? { id: row.entry.id, entryNumber: row.entry.entryNumber, status: row.entry.status } : null,
  }
}

export async function listInvoices(companyId: string, query: ListInvoicesQuery) {
  // The cursor must be an invoice of the company (KLEDG-R3-AUTHZ-02): Prisma
  // reads the sort values of the cursor row by its id alone, so an id of
  // another company would reveal its existence and its date.
  if (query.cursor) {
    const owned = await prisma.invoice.findFirst({ where: { id: query.cursor, companyId }, select: { id: true } })
    if (!owned) throw new ValidationError(INVALID_CURSOR)
  }
  const term = query.search?.trim()
  const where: Prisma.InvoiceWhereInput = {
    companyId,
    direction: query.direction,
    ...(query.tiersId ? { tiersId: query.tiersId } : {}),
    ...(query.status === 'draft' ? { entryId: null } : query.status === 'posted' ? { entryId: { not: null } } : {}),
    ...(query.startDate || query.endDate
      ? { issueDate: { ...(query.startDate ? { gte: dayToDate(query.startDate) } : {}), ...(query.endDate ? { lte: dayToDate(query.endDate) } : {}) } }
      : {}),
    ...(term
      ? {
          OR: [
            { number: { contains: term, mode: 'insensitive' } },
            { label: { contains: term, mode: 'insensitive' } },
            { tiers: { name: { contains: term, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }
  const rows = await prisma.invoice.findMany({
    where,
    select: SUMMARY_SELECT,
    orderBy: [{ issueDate: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  })
  const page = rows.slice(0, query.limit)
  return { items: page.map(summaryOf), nextCursor: rows.length > query.limit ? page[page.length - 1].id : null }
}

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  currency: true,
  sellerSiren: true,
  sellerVatNumber: true,
  buyerSiren: true,
  buyerVatNumber: true,
  attachmentFileName: true,
  numberAssignedAt: true,
  createdAt: true,
  tiers: { select: { id: true, name: true, kind: true, auxiliaryAccountNumber: true, defaultAccountCode: true, defaultVatRateBp: true } },
  lines: {
    orderBy: { position: 'asc' },
    select: { id: true, position: true, label: true, quantity: true, unitPrice: true, vatRateBp: true, totalExclTax: true, accountCode: true, nature: true, fixedAsset: true, vatExemption: true },
  },
  vatBreakdown: { orderBy: { vatRateBp: 'desc' }, select: { vatRateBp: true, baseAmount: true, vatAmount: true } },
  payments: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      amount: true,
      createdAt: true,
      vatTransferEntry: { select: { id: true, entryNumber: true, status: true } },
      entryLine: { select: { id: true, accountingEntry: { select: { id: true, entryNumber: true, date: true, description: true, status: true } } } },
    },
  },
} satisfies Prisma.InvoiceSelect

export async function getInvoice(companyId: string, id: string, db: Db = prisma) {
  const row = await db.invoice.findFirst({ where: { id, companyId }, select: DETAIL_SELECT })
  if (!row) throw new NotFoundError(INVOICE_NOT_FOUND)
  // A draft of the series shows the number it would get if posted now (a hint: given only when posted).
  const provisionalNumber =
    row.origin === 'AUTO' && row.number === null ? await peekNextNumber(db, companyId, row.typeCode, calendarDayOf(row.issueDate) as string).catch(() => null) : null
  const hasExempt = row.lines.some((l) => l.vatExemption !== null)
  const companyMention = hasExempt ? ((await db.company.findUnique({ where: { id: companyId }, select: { vatExemptionMention: true } }))?.vatExemptionMention ?? null) : null
  return {
    ...summaryOf(row),
    provisionalNumber,
    numberAssignedAt: row.numberAssignedAt?.toISOString() ?? null,
    tiers: row.tiers,
    currency: row.currency,
    parties: { sellerSiren: row.sellerSiren, sellerVatNumber: row.sellerVatNumber, buyerSiren: row.buyerSiren, buyerVatNumber: row.buyerVatNumber },
    attachmentFileName: row.attachmentFileName,
    lines: row.lines.map((l) => ({
      id: l.id,
      position: l.position,
      label: l.label,
      quantity: l.quantity.toString(),
      unitPriceCents: cents(l.unitPrice),
      vatRateBp: l.vatRateBp,
      totalExclTaxCents: cents(l.totalExclTax),
      accountCode: l.accountCode,
      nature: l.nature,
      fixedAsset: l.fixedAsset,
      vatExemption: isVatExemption(l.vatExemption) ? l.vatExemption : null,
    })),
    /** Mentions the invoice carries for its exempt lines (CGI ann. II art. 242 nonies A, I, 12°). */
    vatExemptionMentions: row.direction === 'SALE' ? invoiceExemptionMentions(row.lines, companyMention) : [],
    vatBreakdown: row.vatBreakdown.map((b) => ({ vatRateBp: b.vatRateBp, baseCents: cents(b.baseAmount), vatCents: cents(b.vatAmount) })),
    payments: row.payments.map((p) => ({
      id: p.id,
      amountCents: cents(p.amount),
      entryLineId: p.entryLine.id,
      entry: { ...p.entryLine.accountingEntry, date: calendarDayOf(p.entryLine.accountingEntry.date) as string },
      vatTransferEntry: p.vatTransferEntry,
    })),
  }
}

export type InvoiceDetail = Awaited<ReturnType<typeof getInvoice>>

// ------------------------------------------------------------------ writes

interface PreparedLine {
  position: number
  label: string
  quantityThousandths: number
  unitPriceCents: number
  vatRateBp: number
  accountCode: string | null
  nature: 'GOODS' | 'SERVICES'
  fixedAsset: boolean
  vatExemption: VatExemption | null
}

/** Checks the lines of an invoice entered in Kledg; throws one French 400 listing every problem. */
function prepareLines(
  direction: InvoiceDirection,
  lines: CreateInvoiceInput['lines'],
  company: { isVatExempt: boolean },
): { prepared: PreparedLine[]; totals: InvoiceTotals } {
  const errors: string[] = []
  const kind = direction === 'SALE' ? 'CUSTOMER' : 'SUPPLIER'
  const prepared = lines.map((line, index) => {
    const n = index + 1
    const quantity = parseQuantity(line.quantity)
    if (quantity === null || quantity <= 0) errors.push(`Ligne ${n} : la quantité est un nombre positif, trois décimales au plus.`)
    if (!isFrenchVatRate(line.vatRateBp)) errors.push(`Ligne ${n} : ${formatVatRate(line.vatRateBp)} n’est pas un taux de TVA français.`)
    if (direction === 'SALE' && company.isVatExempt && line.vatRateBp !== 0) {
      errors.push(`Ligne ${n} : la société bénéficie de la franchise en base de TVA (CGI art. 293 B) : ses ventes sont sans TVA.`)
    }
    if (line.accountCode) {
      const error = accountCodeError(kind, 'line', line.accountCode)
      if (error) errors.push(`Ligne ${n} : ${error}`)
    }
    if (line.vatExemption && direction !== 'SALE') errors.push(`Ligne ${n} : seule une vente porte une exonération de TVA.`)
    if (line.vatExemption && line.vatRateBp !== 0) errors.push(`Ligne ${n} : une ligne exonérée est à 0 % de TVA.`)
    if (line.fixedAsset && direction === 'SALE') errors.push(`Ligne ${n} : seule une facture d’achat porte une immobilisation.`)
    if (line.fixedAsset && line.accountCode && !line.accountCode.startsWith('2')) {
      errors.push(`Ligne ${n} : une immobilisation se comptabilise en classe 2 (ex. 2183).`)
    }
    return {
      position: n,
      label: line.label,
      quantityThousandths: quantity ?? 0,
      unitPriceCents: line.unitPriceCents,
      vatRateBp: line.vatRateBp,
      accountCode: line.accountCode ?? null,
      nature: line.nature,
      fixedAsset: line.fixedAsset,
      vatExemption: direction === 'SALE' ? (line.vatExemption ?? null) : null,
    }
  })
  if (errors.length > 0) throw new ValidationError(errors.join(' '))
  const totals = computeInvoiceTotals(prepared)
  assertInvoiceAmountsFit(totals)
  if (totals.totalInclTaxCents <= 0) throw new ValidationError('Le total de la facture doit être positif.')
  return { prepared, totals }
}

async function loadTiersForInvoice(db: Db, companyId: string, tiersId: string, direction: InvoiceDirection) {
  const tiers = await db.tiers.findFirst({
    where: { id: tiersId, companyId },
    select: { id: true, kind: true, name: true, siren: true, vatNumber: true, paymentTermsDays: true, paymentTermsEndOfMonth: true },
  })
  if (!tiers) throw new NotFoundError('Tiers introuvable')
  const expected = direction === 'SALE' ? 'CUSTOMER' : 'SUPPLIER'
  if (tiers.kind !== expected) {
    throw new ValidationError(direction === 'SALE' ? 'Une facture de vente s’adresse à un client.' : 'Une facture d’achat vient d’un fournisseur.')
  }
  return tiers
}

async function resolveDueDate(companyId: string, tiers: { paymentTermsDays: number | null; paymentTermsEndOfMonth: boolean | null }, issueDay: string, typed: string | null | undefined) {
  if (typed) {
    if (typed < issueDay) throw new ValidationError('L’échéance ne peut pas précéder la date de la facture.')
    const cap = maxDueDate(issueDay)
    if (typed > cap) {
      throw new ValidationError(
        `L’échéance du ${formatIsoDateFr(typed)} dépasse le délai légal (60 jours après la facture ou 45 jours fin de mois, Code de commerce art. L441-10) : au plus tard le ${formatIsoDateFr(cap)}.`,
      )
    }
    return typed
  }
  return defaultDueDate(issueDay, termsOfTiers(tiers) ?? (await getPaymentTerms(companyId)))
}

async function assertNumberFree(db: Db, companyId: string, direction: InvoiceDirection, tiersId: string, number: string, exceptId?: string) {
  const clash = await db.invoice.findFirst({
    where: {
      companyId,
      direction,
      number,
      ...(direction === 'PURCHASE' ? { tiersId } : {}),
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  })
  if (clash) {
    throw new ConflictError(
      direction === 'SALE'
        ? `La facture de vente n° ${number} existe déjà : chaque facture émise a un numéro unique.`
        : `La facture n° ${number} de ce fournisseur est déjà enregistrée.`,
    )
  }
}

function amountData(totals: InvoiceTotals) {
  return {
    totalExclTax: centsToDecimal(totals.totalExclTaxCents),
    totalVat: centsToDecimal(totals.totalVatCents),
    totalInclTax: centsToDecimal(totals.totalInclTaxCents),
  }
}

function lineRows(prepared: PreparedLine[], totals: InvoiceTotals) {
  return prepared.map((line, i) => ({
    position: line.position,
    label: line.label,
    quantity: new Prisma.Decimal(line.quantityThousandths).div(1000),
    unitPrice: centsToDecimal(line.unitPriceCents),
    vatRateBp: line.vatRateBp,
    totalExclTax: centsToDecimal(totals.lineTotalsCents[i]),
    accountCode: line.accountCode,
    nature: line.nature,
    fixedAsset: line.fixedAsset,
    vatExemption: line.vatExemption,
  }))
}

function breakdownRows(totals: InvoiceTotals) {
  return totals.breakdown.map((row) => ({ vatRateBp: row.vatRateBp, baseAmount: centsToDecimal(row.baseCents), vatAmount: centsToDecimal(row.vatCents) }))
}

function partiesOf(direction: InvoiceDirection, company: { siren: string; vatNumber: string | null }, tiers: { siren: string | null; vatNumber: string | null }) {
  const own = { siren: company.siren, vat: company.vatNumber }
  const other = { siren: tiers.siren, vat: tiers.vatNumber }
  const [seller, buyer] = direction === 'SALE' ? [own, other] : [other, own]
  return { sellerSiren: seller.siren, sellerVatNumber: seller.vat, buyerSiren: buyer.siren, buyerVatNumber: buyer.vat }
}

async function loadCompany(db: Db, companyId: string) {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { siren: true, vatNumber: true, isVatExempt: true } })
  if (!company) throw new NotFoundError('Société introuvable')
  return company
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const
/** A transaction that waits for Qonto (20 s per call, lib/banking/http.ts) while it holds the invoice lock. */
const QONTO_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const

export const AUTO_NUMBER_TYPED =
  'La numérotation automatique est active : Kledg donne le numéro quand la facture est comptabilisée. Pour une facture déjà émise ailleurs, choisissez « Enregistrer une facture déjà émise ».'
const NUMBER_REQUIRED = 'Le numéro est requis'

/**
 * Origin of a new invoice entered in Kledg (not created in Qonto): a
 * purchase keeps its supplier's number; a sale follows `choice`, else the
 * company's numbering (AUTO when automatic, else MANUAL).
 */
export async function originOfNewInvoice(db: Db, companyId: string, direction: InvoiceDirection, choice: InvoiceNumberingChoice | undefined): Promise<InvoiceOrigin> {
  if (direction === 'PURCHASE') {
    if (choice && choice !== 'kledg') throw new ValidationError('Le numéro d’une facture d’achat est celui du fournisseur : il est saisi tel quel.')
    return 'MANUAL'
  }
  if (choice === 'recorded') return 'RECORDED'
  if (choice === 'qonto') throw new ValidationError('Une facture créée dans Qonto passe par la création dans Qonto.')
  const settings = await loadNumberingSettings(db, companyId)
  return settings.mode === 'AUTO' ? 'AUTO' : 'MANUAL'
}

/** Checks the number against the origin; returns the number to store (null: given later). */
function numberForOrigin(origin: InvoiceOrigin, number: string | null | undefined): string | null {
  if (origin === 'AUTO') {
    if (number) throw new ValidationError(AUTO_NUMBER_TYPED)
    return null
  }
  if (origin === 'QONTO') return number ?? null
  if (!number) throw new ValidationError(NUMBER_REQUIRED)
  return number
}

/**
 * Records an invoice as a draft. `options.origin`: where its number comes
 * from (originOfNewInvoice when absent). With `options.db`, runs in the
 * caller's transaction (the management fee generation, which serializes its
 * invoices under one lock); else in its own.
 */
export async function createInvoice(
  companyId: string,
  input: CreateInvoiceInput,
  options: { source?: string; db?: Prisma.TransactionClient; origin?: InvoiceOrigin; qontoRequestedAt?: Date; qontoDraft?: boolean } = {},
): Promise<InvoiceDetail> {
  const run = async (tx: Prisma.TransactionClient) => {
    const company = await loadCompany(tx, companyId)
    const tiers = await loadTiersForInvoice(tx, companyId, input.tiersId, input.direction)
    const { prepared, totals } = prepareLines(input.direction, input.lines, company)
    const origin = options.origin ?? (await originOfNewInvoice(tx, companyId, input.direction, input.numbering))
    const number = numberForOrigin(origin, input.number)
    await lockInvoiceNumbers(tx, companyId)
    if (number) {
      await assertNumberFree(tx, companyId, input.direction, tiers.id, number)
      if (origin === 'RECORDED') await assertOutsideRunningSeries(tx, companyId, number)
    }
    const dueDate = await resolveDueDate(companyId, tiers, input.issueDate, input.dueDate)
    const created = await tx.invoice.create({
      data: {
        companyId,
        direction: input.direction,
        tiersId: tiers.id,
        number,
        origin,
        ...(origin === 'QONTO' ? { source: 'QONTO' as const, qontoRequestedAt: options.qontoRequestedAt ?? new Date(), qontoDraft: options.qontoDraft ?? false } : {}),
        issueDate: dayToDate(input.issueDate),
        dueDate: dayToDate(dueDate),
        typeCode: input.typeCode,
        label: input.label ?? null,
        ...partiesOf(input.direction, company, tiers),
        ...amountData(totals),
        lines: { create: lineRows(prepared, totals) },
        vatBreakdown: { create: breakdownRows(totals) },
      },
      select: { id: true },
    })
    return { id: created.id, origin, number }
  }
  const created = options.db ? await run(options.db) : await prisma.$transaction(run, TX_OPTIONS)
  await writeAuditLog('info', `Invoice recorded: ${created.number ?? 'numbered when posted'}`, {
    action: 'CREATE_INVOICE',
    companyId,
    metadata: { invoiceId: created.id, direction: input.direction, origin: created.origin, source: options.source ?? 'web' },
  })
  return getInvoice(companyId, created.id, options.db)
}

/** Locks an invoice row of the company and returns its state (FOR UPDATE: posting and edits never interleave). */
export async function lockInvoice(tx: Prisma.TransactionClient, companyId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "invoices" WHERE "id" = ${id} AND "companyId" = ${companyId} FOR UPDATE`
  if (rows.length === 0) throw new NotFoundError(INVOICE_NOT_FOUND)
  // An approved MCP action acts on the invoice as the user saw it (KLEDG-R3-MCP-01)
  await checkApprovedState(tx, { kind: 'invoice', companyId, id })
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      direction: true,
      number: true,
      entryId: true,
      source: true,
      tiersId: true,
      origin: true,
      typeCode: true,
      issueDate: true,
      numberAssignedAt: true,
      qontoRequestedAt: true,
      qontoDraft: true,
      externalId: true,
    },
  })
  return invoice
}

/** How an invoice is named in a message: its number, or "en brouillon" before the series gives one. */
export function invoiceName(invoice: { number: string | null }): string {
  return invoice.number ? `La facture n° ${invoice.number}` : 'La facture en brouillon'
}

const DRAFT_ONLY = (invoice: { number: string | null }) =>
  `${invoiceName(invoice)} est comptabilisée : supprimez d’abord son écriture en brouillon (ou contre-passez-la si elle est validée) pour la modifier.`

export async function updateInvoice(companyId: string, id: string, input: UpdateInvoiceInput): Promise<InvoiceDetail> {
  const number = await prisma.$transaction(async (tx) => {
    const current = await lockInvoice(tx, companyId, id)
    if (current.entryId) throw new ConflictError(DRAFT_ONLY(current))
    if (current.source !== 'MANUAL') {
      throw new ConflictError('Une facture importée ou créée dans Qonto garde les montants du document : seuls ses comptes se modifient.')
    }
    let number: string | null
    if (current.origin === 'AUTO') {
      if (current.number) {
        // Given by the series: the number and the date (its place in the chronological sequence) stay.
        if (input.number && input.number !== current.number) throw new ValidationError(`Le numéro ${current.number} a été attribué par la série : il ne change plus.`)
        if (input.issueDate !== calendarDayOf(current.issueDate)) {
          throw new ConflictError(`La facture n° ${current.number} est numérotée : sa date fixe sa place dans la série et ne change plus. Émettez un avoir pour l’annuler.`)
        }
        if (input.typeCode !== current.typeCode) throw new ConflictError(`La facture n° ${current.number} est numérotée : son type ne change plus.`)
      } else if (input.number) throw new ValidationError(AUTO_NUMBER_TYPED)
      number = current.number
    } else {
      if (!input.number) throw new ValidationError(NUMBER_REQUIRED)
      number = input.number
    }
    const company = await loadCompany(tx, companyId)
    const tiers = await loadTiersForInvoice(tx, companyId, input.tiersId, current.direction)
    const { prepared, totals } = prepareLines(current.direction, input.lines, company)
    await lockInvoiceNumbers(tx, companyId)
    if (number) {
      await assertNumberFree(tx, companyId, current.direction, tiers.id, number, id)
      if (current.origin === 'RECORDED' && number !== current.number) await assertOutsideRunningSeries(tx, companyId, number)
    }
    const dueDate = await resolveDueDate(companyId, tiers, input.issueDate, input.dueDate)
    await tx.invoiceLine.deleteMany({ where: { invoiceId: id } })
    await tx.invoiceVatBreakdown.deleteMany({ where: { invoiceId: id } })
    await tx.invoice.update({
      where: { id },
      data: {
        tiersId: tiers.id,
        number,
        issueDate: dayToDate(input.issueDate),
        dueDate: dayToDate(dueDate),
        typeCode: input.typeCode,
        label: input.label ?? null,
        ...partiesOf(current.direction, company, tiers),
        ...amountData(totals),
        lines: { create: lineRows(prepared, totals) },
        vatBreakdown: { create: breakdownRows(totals) },
      },
    })
    return number
  }, TX_OPTIONS)
  await writeAuditLog('info', `Invoice updated: ${number ?? 'numbered when posted'}`, { action: 'UPDATE_INVOICE', companyId, metadata: { invoiceId: id } })
  return getInvoice(companyId, id)
}

export async function updateInvoiceLineAccounts(companyId: string, id: string, input: z.infer<typeof UpdateLineAccountsBodySchema>): Promise<InvoiceDetail> {
  await prisma.$transaction(async (tx) => {
    const current = await lockInvoice(tx, companyId, id)
    if (current.entryId) throw new ConflictError(DRAFT_ONLY(current))
    const lines = await tx.invoiceLine.findMany({ where: { invoiceId: id }, select: { id: true, accountCode: true, fixedAsset: true } })
    const byId = new Map(lines.map((l) => [l.id, l]))
    const kind = current.direction === 'SALE' ? 'CUSTOMER' : 'SUPPLIER'
    const errors: string[] = []
    for (const change of input.lines) {
      const line = byId.get(change.id)
      if (!line) throw new NotFoundError('Ligne de facture introuvable')
      const code = change.accountCode !== undefined ? change.accountCode : line.accountCode
      const fixedAsset = change.fixedAsset ?? line.fixedAsset
      if (code) {
        const error = accountCodeError(kind, 'line', code)
        if (error) errors.push(error)
      }
      if (fixedAsset && current.direction === 'SALE') errors.push('Seule une facture d’achat porte une immobilisation.')
      if (fixedAsset && code && !code.startsWith('2')) errors.push('Une immobilisation se comptabilise en classe 2 (ex. 2183).')
    }
    if (errors.length > 0) throw new ValidationError([...new Set(errors)].join(' '))
    for (const change of input.lines) {
      await tx.invoiceLine.update({
        where: { id: change.id },
        data: {
          ...(change.accountCode !== undefined ? { accountCode: change.accountCode } : {}),
          ...(change.nature ? { nature: change.nature } : {}),
          ...(change.fixedAsset !== undefined ? { fixedAsset: change.fixedAsset } : {}),
        },
      })
    }
  }, TX_OPTIONS)
  return getInvoice(companyId, id)
}

export async function deleteInvoice(companyId: string, id: string): Promise<{ id: string }> {
  const deleted = await prisma.$transaction(async (tx) => {
    // The lock also checks an approved MCP action's invoice (KLEDG-R3-MCP-01)
    const current = await lockInvoice(tx, companyId, id)
    if (current.entryId) throw new ConflictError(DRAFT_ONLY(current))
    if (current.origin === 'AUTO' && current.number) {
      throw new ConflictError(
        `La facture n° ${current.number} a reçu son numéro de la série : la supprimer laisserait un trou dans la numérotation (CGI ann. II art. 242 nonies A). Émettez un avoir pour l’annuler.`,
      )
    }
    const qontoDraft = current.origin === 'QONTO' && current.qontoDraft && current.externalId ? current.externalId : null
    if (current.origin === 'QONTO' && current.qontoRequestedAt && !qontoDraft) {
      throw new ConflictError(
        current.externalId
          ? `${invoiceName(current)} a été créée dans Qonto : annulez-la dans Qonto (par un avoir), Kledg reprendra son état à l’import.`
          : 'Kledg attend la réponse de Qonto pour cette facture : reprenez la création avant de la supprimer, pour ne pas laisser dans Qonto une facture inconnue de Kledg.',
      )
    }
    // A draft created in Qonto is deleted there first, so Kledg and Qonto stay in step: only once every
    // check above passed, under the invoice lock, so a refusal never leaves a Kledg invoice whose Qonto
    // draft is gone. A Qonto failure throws and rolls back: nothing changes in Kledg. It has no number
    // yet: deleting it in Kledg leaves no gap.
    if (qontoDraft) {
      const { deleteQontoDraft } = await import('./create-in-qonto.service')
      await deleteQontoDraft(companyId, qontoDraft)
    }
    await tx.invoice.delete({ where: { id } })
    return current
  }, QONTO_TX_OPTIONS)
  await writeAuditLog('info', `Invoice deleted: ${deleted.number ?? 'draft without number'}`, { action: 'DELETE_INVOICE', companyId, metadata: { invoiceId: id } })
  return { id }
}
