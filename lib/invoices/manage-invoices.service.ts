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
 *   nonies A, I: a unique number in a chronological, continuous sequence); a
 *   purchase invoice number is unique per supplier;
 * - an invoice is edited or deleted only while it is a draft (no entry);
 *   an imported invoice keeps the document's amounts: only its accounts
 *   and natures change (updateInvoiceLineAccounts).
 */

import { Prisma, type InvoiceDirection } from '@prisma/client'
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
import { defaultDueDate, invoiceStatus, maxDueDate, remainingCents, type InvoiceStatus } from './status'

export const INVOICE_NOT_FOUND = 'Facture introuvable'

type Db = Prisma.TransactionClient | typeof prisma

const directionSchema = z.enum(['SALE', 'PURCHASE'], { error: 'Choisissez une facture de vente ou d’achat' })

const lineSchema = z.object({
  label: z.string({ error: 'La désignation est requise' }).trim().min(1, 'La désignation est requise').max(500),
  quantity: z.union([z.string(), z.number()], { error: 'Quantité invalide' }),
  unitPriceCents: centsField({ min: 0, invalid: 'Prix unitaire invalide', negative: 'Le prix unitaire ne peut pas être négatif', integer: 'Prix unitaire en centimes' }),
  vatRateBp: z.number({ error: 'Taux de TVA invalide' }).int().min(0).max(10000),
  accountCode: optionalText(20),
  nature: z.enum(['GOODS', 'SERVICES']).default('SERVICES'),
  fixedAsset: z.boolean().default(false),
})

const invoiceFields = {
  tiersId: z.string({ error: 'Choisissez le tiers' }).min(1, 'Choisissez le tiers').max(64),
  number: z.string({ error: 'Le numéro est requis' }).trim().min(1, 'Le numéro est requis').max(60),
  issueDate: calendarDay('Date de facture invalide'),
  dueDate: calendarDay('Date d’échéance invalide').nullish(),
  typeCode: z.enum(['380', '381']).default('380'),
  label: optionalText(500),
  lines: z.array(lineSchema, { error: 'Ajoutez au moins une ligne' }).min(1, 'Ajoutez au moins une ligne').max(200, '200 lignes au plus'),
}

/** Body of POST /api/invoices. */
export const CreateInvoiceBodySchema = z.object({ direction: directionSchema, ...invoiceFields })
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
  number: string
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
    externalStatus: row.externalStatus,
    hasAttachment: row.externalAttachmentId !== null,
    entry: row.entry ? { id: row.entry.id, entryNumber: row.entry.entryNumber, status: row.entry.status } : null,
  }
}

export async function listInvoices(companyId: string, query: ListInvoicesQuery) {
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
  createdAt: true,
  tiers: { select: { id: true, name: true, kind: true, auxiliaryAccountNumber: true, defaultAccountCode: true, defaultVatRateBp: true } },
  lines: {
    orderBy: { position: 'asc' },
    select: { id: true, position: true, label: true, quantity: true, unitPrice: true, vatRateBp: true, totalExclTax: true, accountCode: true, nature: true, fixedAsset: true },
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
  return {
    ...summaryOf(row),
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
    })),
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

/**
 * Records an invoice. With `options.db`, runs in the caller's transaction (the
 * management fee generation, which serializes its invoices under one lock);
 * else in its own.
 */
export async function createInvoice(
  companyId: string,
  input: CreateInvoiceInput,
  options: { source?: string; db?: Prisma.TransactionClient } = {},
): Promise<InvoiceDetail> {
  const run = async (tx: Prisma.TransactionClient) => {
    const company = await loadCompany(tx, companyId)
    const tiers = await loadTiersForInvoice(tx, companyId, input.tiersId, input.direction)
    const { prepared, totals } = prepareLines(input.direction, input.lines, company)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:invoice-number:${companyId}`}))`
    await assertNumberFree(tx, companyId, input.direction, tiers.id, input.number)
    const dueDate = await resolveDueDate(companyId, tiers, input.issueDate, input.dueDate)
    const created = await tx.invoice.create({
      data: {
        companyId,
        direction: input.direction,
        tiersId: tiers.id,
        number: input.number,
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
    return created.id
  }
  const id = options.db ? await run(options.db) : await prisma.$transaction(run, TX_OPTIONS)
  await writeAuditLog('info', `Invoice recorded: ${input.number}`, {
    action: 'CREATE_INVOICE',
    companyId,
    metadata: { invoiceId: id, direction: input.direction, source: options.source ?? 'web' },
  })
  return getInvoice(companyId, id, options.db)
}

/** Locks an invoice row of the company and returns its state (FOR UPDATE: posting and edits never interleave). */
export async function lockInvoice(tx: Prisma.TransactionClient, companyId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "invoices" WHERE "id" = ${id} AND "companyId" = ${companyId} FOR UPDATE`
  if (rows.length === 0) throw new NotFoundError(INVOICE_NOT_FOUND)
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id },
    select: { id: true, direction: true, number: true, entryId: true, source: true, tiersId: true },
  })
  return invoice
}

const DRAFT_ONLY = (number: string) =>
  `La facture n° ${number} est comptabilisée : supprimez d’abord son écriture en brouillon (ou contre-passez-la si elle est validée) pour la modifier.`

export async function updateInvoice(companyId: string, id: string, input: UpdateInvoiceInput): Promise<InvoiceDetail> {
  await prisma.$transaction(async (tx) => {
    const current = await lockInvoice(tx, companyId, id)
    if (current.entryId) throw new ConflictError(DRAFT_ONLY(current.number))
    if (current.source !== 'MANUAL') {
      throw new ConflictError('Une facture importée garde les montants du document : seuls ses comptes se modifient.')
    }
    const company = await loadCompany(tx, companyId)
    const tiers = await loadTiersForInvoice(tx, companyId, input.tiersId, current.direction)
    const { prepared, totals } = prepareLines(current.direction, input.lines, company)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:invoice-number:${companyId}`}))`
    await assertNumberFree(tx, companyId, current.direction, tiers.id, input.number, id)
    const dueDate = await resolveDueDate(companyId, tiers, input.issueDate, input.dueDate)
    await tx.invoiceLine.deleteMany({ where: { invoiceId: id } })
    await tx.invoiceVatBreakdown.deleteMany({ where: { invoiceId: id } })
    await tx.invoice.update({
      where: { id },
      data: {
        tiersId: tiers.id,
        number: input.number,
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
  }, TX_OPTIONS)
  await writeAuditLog('info', `Invoice updated: ${input.number}`, { action: 'UPDATE_INVOICE', companyId, metadata: { invoiceId: id } })
  return getInvoice(companyId, id)
}

export async function updateInvoiceLineAccounts(companyId: string, id: string, input: z.infer<typeof UpdateLineAccountsBodySchema>): Promise<InvoiceDetail> {
  await prisma.$transaction(async (tx) => {
    const current = await lockInvoice(tx, companyId, id)
    if (current.entryId) throw new ConflictError(DRAFT_ONLY(current.number))
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
    const current = await lockInvoice(tx, companyId, id)
    if (current.entryId) throw new ConflictError(DRAFT_ONLY(current.number))
    await tx.invoice.delete({ where: { id } })
    return current
  }, TX_OPTIONS)
  await writeAuditLog('info', `Invoice deleted: ${deleted.number}`, { action: 'DELETE_INVOICE', companyId, metadata: { invoiceId: id } })
  return { id }
}
