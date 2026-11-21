/**
 * Import of a received e-invoice file (Factur-X PDF, CII or UBL XML) as a
 * draft purchase invoice. Since 1 September 2026 every company subject to
 * VAT in France receives its suppliers' invoices as e-invoices through an
 * approved platform (CGI art. 289 bis; docs/factures-et-tiers.md,
 * Facturation électronique): this records the file the platform delivers,
 * instead of typing it again.
 *
 * Invariants owned here:
 * - the document's amounts are kept (lines, VAT per rate, totals), after the
 *   checks of e-invoice/normalize.ts; nothing is recomputed;
 * - only an invoice addressed to the company is imported: a buyer SIREN or
 *   VAT number that is not the company's is refused, an invoice the company
 *   issued itself is refused (Kledg imports received invoices);
 * - idempotent: the same file, or the same supplier number, imported twice
 *   creates nothing the second time (checked again under the invoice number
 *   lock, lockInvoiceNumbers, so two concurrent imports cannot both create);
 * - the supplier is found by SIREN, then VAT number, then name; created as a
 *   tiers otherwise, in the same transaction as the invoice;
 * - the file is kept as received (receipt_files, LPF art. L102 B: an
 *   e-invoice is kept in its original format), linked by documentFileId;
 *   deleteUnreferencedReceiptFiles never deletes it while the invoice lives;
 * - the invoice is a draft: a person chooses its accounts and posts it.
 */

import { findSamePurchaseInvoice } from './duplicate-purchase'
import { defaultLineNature } from './line-nature'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { dayToDate } from '@/lib/accounting/entry-date'
import { assertFileSize } from '@/lib/api/files'
import { FRENCH_ERRORS } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { getPaymentTerms } from '@/lib/companies/payment-terms.service'
import { discardObject, putReceiptObject, receiptFileData, sha256Hex, type PendingObject } from '@/lib/receipts/receipt-file-store'
import { RECEIPT_MAX_BYTES } from '@/lib/receipts/file-type'
import { configuredStorageDriver } from '@/lib/storage'
import { createTiers, termsOfTiers } from '@/lib/tiers/manage-tiers.service'
import { centsToDecimal } from '@/lib/utils/money'
import { lockInvoiceNumbers } from './numbering/series'
import { defaultDueDate } from './status'
import { parseEInvoice } from './e-invoice/parse-e-invoice'
import type { EInvoiceParty, ParsedEInvoice } from './e-invoice/types'

export interface EInvoiceFile {
  bytes: Uint8Array
  fileName?: string | null
}

const TIERS_SELECT = { id: true, name: true, siren: true, vatNumber: true, defaultAccountCode: true, paymentTermsDays: true, paymentTermsEndOfMonth: true } as const
type SupplierRow = Prisma.TiersGetPayload<{ select: typeof TIERS_SELECT }>

/** What the file holds and what the import would do (the dry run of the MCP tool, the answer of the import). */
export interface EInvoiceAnalysis {
  format: ParsedEInvoice['format']
  number: string
  creditNote: boolean
  issueDate: string
  dueDate: string | null
  supplier: { name: string; siren: string | null; vatNumber: string | null; tiersId: string | null; auxiliaryAccountNumber: string | null }
  lines: Array<{ label: string; quantity: number; unitPriceCents: number; vatRateBp: number; totalExclTaxCents: number }>
  vatBreakdown: Array<{ vatRateBp: number; baseCents: number; vatCents: number }>
  totalExclTaxCents: number
  totalVatCents: number
  totalInclTaxCents: number
  /** The invoice already in Kledg (same file, or same number from the same supplier, imported or typed): importing again creates nothing. */
  alreadyImported: { invoiceId: string } | null
  warnings: string[]
}

export interface EInvoiceImportResult extends EInvoiceAnalysis {
  invoiceId: string
  /** False when the invoice was already imported. */
  created: boolean
  supplierCreated: boolean
}

const fileNameOf = (name: string | null | undefined, format: ParsedEInvoice['format']) =>
  (name?.trim() || (format === 'factur-x' ? 'facture.pdf' : 'facture.xml')).replace(/[^\w.\- ]+/g, '_').slice(0, 200)

/** Whether a party of the document is the company (same SIREN, or same VAT number). */
function isCompany(party: EInvoiceParty, company: { siren: string; vatNumber: string | null }): boolean | null {
  if (party.siren) return party.siren === company.siren
  if (party.vatNumber) return !!company.vatNumber && party.vatNumber === company.vatNumber
  return null
}

function parse(file: EInvoiceFile, company: { siren: string; vatNumber: string | null }): ParsedEInvoice {
  // The file is kept with the receipts, whose storage takes 5 MB at most (receipt_files_size_check)
  if (file.bytes.length > RECEIPT_MAX_BYTES) throw new ValidationError('Facture électronique non importée\u00a0: le fichier dépasse 5 Mo.')
  const result = parseEInvoice(file.bytes)
  if (result.kind === 'refused') throw new ValidationError(`Facture électronique non importée : ${result.reason}.`)
  const invoice = result.invoice
  const buyerIsCompany = isCompany(invoice.buyer, company)
  if (buyerIsCompany === false) {
    if (isCompany(invoice.seller, company)) throw new ValidationError('Cette facture a été émise par votre société : Kledg importe les factures reçues de vos fournisseurs.')
    const id = invoice.buyer.siren ? `SIREN ${invoice.buyer.siren}` : `TVA ${invoice.buyer.vatNumber}`
    throw new ValidationError(`Cette facture est adressée à une autre société (${invoice.buyer.name || 'acheteur'}, ${id}) : importez-la dans la société destinataire.`)
  }
  if (buyerIsCompany === null) invoice.warnings.unshift('La facture n’indique ni le SIREN ni le numéro de TVA de l’acheteur : vérifiez qu’elle est bien adressée à votre société.')
  return invoice
}

async function loadCompany(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { siren: true, vatNumber: true } })
  if (!company) throw new NotFoundError('Société introuvable')
  return company
}

type Db = Prisma.TransactionClient | typeof prisma

async function findSupplier(db: Db, companyId: string, seller: EInvoiceParty): Promise<(SupplierRow & { auxiliaryAccountNumber: string }) | null> {
  const select = { ...TIERS_SELECT, auxiliaryAccountNumber: true }
  if (seller.siren) {
    const bySiren = await db.tiers.findFirst({ where: { companyId, kind: 'SUPPLIER', siren: seller.siren }, select, orderBy: { createdAt: 'asc' } })
    if (bySiren) return bySiren
  }
  if (seller.vatNumber) {
    const byVat = await db.tiers.findFirst({ where: { companyId, kind: 'SUPPLIER', vatNumber: seller.vatNumber }, select, orderBy: { createdAt: 'asc' } })
    if (byVat) return byVat
  }
  return db.tiers.findFirst({ where: { companyId, kind: 'SUPPLIER', name: { equals: seller.name, mode: 'insensitive' } }, select, orderBy: { createdAt: 'asc' } })
}

/** The invoice already recorded for this file or this supplier number, if any. */
async function findImported(db: Db, companyId: string, sha256: string, supplierId: string | null, invoice: ParsedEInvoice): Promise<{ id: string } | null> {
  const same = await db.invoice.findFirst({
    where: {
      companyId,
      direction: 'PURCHASE',
      OR: [{ documentFile: { sha256 } }, ...(supplierId ? [{ tiersId: supplierId, number: invoice.number }] : [])],
    },
    select: { id: true },
  })
  // The same invoice already recorded from another source (Qonto), under another tiers (#136)
  return (
    same ??
    (await findSamePurchaseInvoice(db, companyId, {
      number: invoice.number,
      sellerSiren: invoice.seller.siren,
      issueDate: dayToDate(invoice.issueDate),
      totalInclTaxCents: invoice.totals.totalInclTaxCents,
    }))
  )
}

function analysisOf(invoice: ParsedEInvoice, supplier: { id: string; auxiliaryAccountNumber: string } | null, alreadyImported: { id: string } | null): EInvoiceAnalysis {
  return {
    format: invoice.format,
    number: invoice.number,
    creditNote: invoice.typeCode === '381',
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    supplier: {
      name: invoice.seller.name,
      siren: invoice.seller.siren,
      vatNumber: invoice.seller.vatNumber,
      tiersId: supplier?.id ?? null,
      auxiliaryAccountNumber: supplier?.auxiliaryAccountNumber ?? null,
    },
    lines: invoice.lines.map((line) => ({
      label: line.label,
      quantity: line.quantityThousandths / 1000,
      unitPriceCents: line.unitPriceCents,
      vatRateBp: line.vatRateBp,
      totalExclTaxCents: line.totalExclTaxCents,
    })),
    vatBreakdown: invoice.totals.breakdown,
    totalExclTaxCents: invoice.totals.totalExclTaxCents,
    totalVatCents: invoice.totals.totalVatCents,
    totalInclTaxCents: invoice.totals.totalInclTaxCents,
    alreadyImported: alreadyImported ? { invoiceId: alreadyImported.id } : null,
    warnings: invoice.warnings,
  }
}

/** Reads the file and says what the import would record, without writing anything. */
export async function analyzeEInvoice(companyId: string, file: EInvoiceFile): Promise<EInvoiceAnalysis> {
  const company = await loadCompany(companyId)
  const invoice = parse(file, company)
  const supplier = await findSupplier(prisma, companyId, invoice.seller)
  const imported = await findImported(prisma, companyId, sha256Hex(file.bytes), supplier?.id ?? null, invoice)
  return analysisOf(invoice, supplier, imported)
}

/** The form of POST /api/invoices/import-e-invoice: companyId (read by the route), file, mode. */
export const EInvoiceFormSchema = z.object({
  file: z.instanceof(File, { error: 'Aucun fichier reçu.' }),
  mode: z.unknown().optional().transform((value): 'preview' | 'import' => (value === 'preview' ? 'preview' : 'import')),
})

/** Runs the form of the invoices page: the analysis of the file (preview, never writes) or its import. */
export async function runEInvoiceForm(companyId: string, form: FormData): Promise<EInvoiceAnalysis | EInvoiceImportResult> {
  const parsed = EInvoiceFormSchema.safeParse(Object.fromEntries(form.entries()), { error: FRENCH_ERRORS })
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(' '))
  const { file, mode } = parsed.data
  assertFileSize(file)
  const input = { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name }
  return mode === 'preview' ? analyzeEInvoice(companyId, input) : importEInvoice(companyId, input)
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const
const NEEDS_OBJECT = Symbol('needs-object')

/** Records the e-invoice as a draft purchase invoice (or returns the one already imported). */
export async function importEInvoice(companyId: string, file: EInvoiceFile, options: { source?: string } = {}): Promise<EInvoiceImportResult> {
  const company = await loadCompany(companyId)
  const invoice = parse(file, company)
  const sha256 = sha256Hex(file.bytes)
  const contentType = invoice.format === 'factur-x' ? 'application/pdf' : 'application/xml'
  const fileName = fileNameOf(file.fileName, invoice.format)

  const record = async (pending: PendingObject | null) =>
    prisma.$transaction(async (tx) => {
      // The lock of the company's invoice numbers: a concurrent import of the same invoice waits, then finds it.
      await lockInvoiceNumbers(tx, companyId)
      let supplier = await findSupplier(tx, companyId, invoice.seller)
      const existing = await findImported(tx, companyId, sha256, supplier?.id ?? null, invoice)
      if (existing) return { invoiceId: existing.id, supplier, created: false, supplierCreated: false, usedObject: false }

      let storedFile = await tx.receiptFile.findUnique({ where: { companyId_sha256: { companyId, sha256 } }, select: { id: true } })
      let usedObject = false
      if (!storedFile) {
        if (!pending && configuredStorageDriver() !== 'postgres') return NEEDS_OBJECT
        storedFile = await tx.receiptFile.create({ data: { companyId, sha256, contentType, size: file.bytes.length, ...receiptFileData(file.bytes, pending) }, select: { id: true } })
        usedObject = pending !== null
      }

      let supplierCreated = false
      if (!supplier) {
        const created = await createTiers(
          companyId,
          { kind: 'SUPPLIER', name: invoice.seller.name, siren: invoice.seller.siren, siret: invoice.seller.siret, vatNumber: invoice.seller.vatNumber, email: null, address: invoice.seller.address },
          { source: options.source ?? 'web', db: tx },
        )
        supplier = await tx.tiers.findUniqueOrThrow({ where: { id: created.id }, select: { ...TIERS_SELECT, auxiliaryAccountNumber: true } })
        supplierCreated = true
      }

      const terms = termsOfTiers(supplier) ?? (await getPaymentTerms(companyId))
      const dueDate = invoice.dueDate ?? defaultDueDate(invoice.issueDate, terms)
      const created = await tx.invoice.create({
        data: {
          companyId,
          direction: 'PURCHASE',
          tiersId: supplier.id,
          number: invoice.number,
          origin: 'MANUAL',
          source: 'E_INVOICE',
          typeCode: invoice.typeCode,
          issueDate: dayToDate(invoice.issueDate),
          dueDate: dayToDate(dueDate < invoice.issueDate ? invoice.issueDate : dueDate),
          sellerSiren: invoice.seller.siren,
          sellerVatNumber: invoice.seller.vatNumber,
          buyerSiren: company.siren,
          buyerVatNumber: company.vatNumber,
          totalExclTax: centsToDecimal(invoice.totals.totalExclTaxCents),
          totalVat: centsToDecimal(invoice.totals.totalVatCents),
          totalInclTax: centsToDecimal(invoice.totals.totalInclTaxCents),
          documentFileId: storedFile.id,
          attachmentFileName: fileName,
          lines: {
            create: invoice.lines.map((line, i) => ({
              position: i + 1,
              label: line.label,
              quantity: new Prisma.Decimal(line.quantityThousandths).div(1000),
              unitPrice: centsToDecimal(line.unitPriceCents),
              vatRateBp: line.vatRateBp,
              totalExclTax: centsToDecimal(line.totalExclTaxCents),
              accountCode: supplier.defaultAccountCode,
              // The document does not say goods or services: the supplier's account decides (#132)
              nature: defaultLineNature({ tiersAccountCode: supplier.defaultAccountCode }),
            })),
          },
          vatBreakdown: {
            create: invoice.totals.breakdown.map((row) => ({ vatRateBp: row.vatRateBp, baseAmount: centsToDecimal(row.baseCents), vatAmount: centsToDecimal(row.vatCents) })),
          },
        },
        select: { id: true },
      })
      return { invoiceId: created.id, supplier, created: true, supplierCreated, usedObject }
    }, TX_OPTIONS)

  // The object is written before its row, outside the transaction (receipts do the same, stage-receipt.service.ts).
  let pending: PendingObject | null = null
  let outcome: Awaited<ReturnType<typeof record>> | null = null
  try {
    if ((await prisma.receiptFile.count({ where: { companyId, sha256 } })) === 0) pending = await putReceiptObject(companyId, file.bytes, contentType, sha256)
    outcome = await record(pending)
    if (outcome === NEEDS_OBJECT) {
      pending = await putReceiptObject(companyId, file.bytes, contentType, sha256)
      outcome = await record(pending)
    }
  } finally {
    if (pending && !(outcome && outcome !== NEEDS_OBJECT && outcome.usedObject)) await discardObject(pending)
  }
  if (!outcome || outcome === NEEDS_OBJECT) throw new ConflictError('La facture n’a pas pu être enregistrée : importez-la de nouveau.')

  if (outcome.created) {
    await writeAuditLog('info', `E-invoice imported: ${invoice.number}`, {
      action: 'IMPORT_E_INVOICE',
      companyId,
      metadata: { invoiceId: outcome.invoiceId, format: invoice.format, supplierCreated: outcome.supplierCreated, source: options.source ?? 'web' },
    })
  }
  const supplier = outcome.supplier
  return {
    ...analysisOf(invoice, supplier, outcome.created ? null : { id: outcome.invoiceId }),
    invoiceId: outcome.invoiceId,
    created: outcome.created,
    supplierCreated: outcome.supplierCreated,
  }
}
