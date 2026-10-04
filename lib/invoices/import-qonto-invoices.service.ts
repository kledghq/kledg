/**
 * Import of Qonto clients, client invoices and supplier invoices into tiers
 * and invoices (read-only on Qonto's side, lib/integrations/providers/qonto/
 * invoicing.ts for the verified endpoints, qonto-mapping.ts for the amounts).
 *
 * Invariants owned here:
 * - Qonto is called with the company's own stored API key only, so another
 *   organization's data cannot be reached;
 * - idempotent: a tiers is found again by its Qonto id (unique per company
 *   and kind), an invoice by its Qonto id (unique per company and source);
 *   running the import twice creates nothing twice;
 * - an imported invoice already posted keeps its amounts (its entry is the
 *   books); only its Qonto status is refreshed;
 * - an invoice whose amounts do not add up is not imported, and reported;
 * - no file is stored: the PDF stays at Qonto (attachment id), fetched on
 *   demand through the SSRF-safe file download (read-invoice-attachment).
 */

import { Prisma, type InvoiceDirection } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { calendarDay } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { dayToDate } from '@/lib/accounting/entry-date'
import { limitBankCalls } from '@/lib/banking/guard'
import { getPaymentTerms } from '@/lib/companies/payment-terms.service'
import { getQontoCredentials } from '@/lib/integrations/providers/qonto/get-credentials'
import { QontoInvoicing, type QontoClient } from '@/lib/integrations/providers/qonto/invoicing'
import { createTiers, termsOfTiers } from '@/lib/tiers/manage-tiers.service'
import { isValidSiren, isValidSiret, isValidVatNumber, normalizeIdentifier, normalizeVatNumber } from '@/lib/tiers/identifiers'
import { centsToDecimal } from '@/lib/utils/money'
import { mapClientInvoice, mapSupplierInvoice, type MappedInvoice } from './qonto-mapping'
import { defaultDueDate } from './status'

/** Body of POST /api/invoices/import-qonto. */
export const ImportQontoBodySchema = z
  .object({
    since: calendarDay('Date de début invalide').optional(),
  })
  .optional()
  .default({})

export interface ImportQontoResult {
  tiers: { created: number; updated: number }
  invoices: { created: number; updated: number; unchanged: number }
  /** Invoices Qonto holds that Kledg leaves aside on purpose (drafts, canceled, rejected). */
  ignored: number
  /** Invoices not imported, with the French reason. */
  refused: Array<{ direction: InvoiceDirection; reference: string; reason: string }>
  /** False when a list had more pages than one run reads: run it again with `since`. */
  complete: boolean
}

interface Identity {
  siren: string | null
  siret: string | null
  vatNumber: string | null
}

/** Identifiers given by Qonto, kept only when they pass the checks of identifiers.ts. */
export function identityOf(taxId: string | null | undefined, vat: string | null | undefined): Identity {
  const digits = normalizeIdentifier(taxId)
  const siret = digits && isValidSiret(digits) ? digits : null
  const siren = siret ? siret.slice(0, 9) : digits && isValidSiren(digits) ? digits : null
  const vatNumber = normalizeVatNumber(vat)
  const vatOk = vatNumber && isValidVatNumber(vatNumber) && (!vatNumber.startsWith('FR') || !siren || vatNumber.endsWith(siren)) ? vatNumber : null
  return { siren, siret, vatNumber: vatOk }
}

function clientName(client: QontoClient): string {
  const name = client.name?.trim() || [client.first_name, client.last_name].filter(Boolean).join(' ').trim()
  return (name || `Client ${client.id.slice(0, 8)}`).slice(0, 200)
}

function clientAddress(client: QontoClient) {
  const billing = client.billing_address
  const street = (billing?.street_address ?? client.address ?? '').trim()
  const postalCode = (billing?.zip_code ?? client.zip_code ?? '').trim()
  const city = (billing?.city ?? client.city ?? '').trim()
  const country = (billing?.country_code ?? client.country_code ?? 'FR').trim().toUpperCase()
  if (!street || !postalCode || !city || country.length !== 2) return null
  return { street: street.slice(0, 200), street2: null, postalCode: postalCode.slice(0, 20), city: city.slice(0, 100), country }
}

type Counters = ImportQontoResult

async function upsertCustomer(companyId: string, client: QontoClient, counters: Counters): Promise<string> {
  const existing = await prisma.tiers.findFirst({ where: { companyId, kind: 'CUSTOMER', qontoId: client.id }, select: { id: true, name: true, email: true } })
  const name = clientName(client)
  if (existing) {
    const email = client.email?.trim() || null
    if (existing.name !== name || (email && existing.email !== email)) {
      await prisma.tiers.update({ where: { id: existing.id }, data: { name, ...(email ? { email } : {}) } })
      counters.tiers.updated += 1
    }
    return existing.id
  }
  const identity = identityOf(client.tax_identification_number, client.vat_number)
  const email = client.email?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email.trim()) ? client.email.trim() : null
  const created = await createTiers(companyId, { kind: 'CUSTOMER', name, ...identity, email, address: clientAddress(client), qontoId: client.id }, { source: 'qonto' })
  counters.tiers.created += 1
  return created.id
}

async function upsertSupplier(companyId: string, supplierId: string | null, name: string, identity: Identity, counters: Counters): Promise<string> {
  if (supplierId) {
    const known = await prisma.tiers.findFirst({ where: { companyId, kind: 'SUPPLIER', qontoId: supplierId }, select: { id: true } })
    if (known) return known.id
  }
  const byName = await prisma.tiers.findFirst({
    where: { companyId, kind: 'SUPPLIER', qontoId: null, name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  })
  if (byName) {
    if (supplierId) await prisma.tiers.update({ where: { id: byName.id }, data: { qontoId: supplierId } })
    return byName.id
  }
  const created = await createTiers(companyId, { kind: 'SUPPLIER', name, ...identity, email: null, qontoId: supplierId }, { source: 'qonto' })
  counters.tiers.created += 1
  return created.id
}

async function saveInvoice(
  companyId: string,
  direction: InvoiceDirection,
  tiersId: string,
  mapped: MappedInvoice,
  company: { siren: string; vatNumber: string | null },
  counters: Counters,
) {
  const existing = await prisma.invoice.findFirst({
    where: { companyId, source: 'QONTO', externalId: mapped.externalId },
    select: { id: true, entryId: true, externalStatus: true },
  })
  if (existing?.entryId) {
    if (existing.externalStatus !== mapped.status) {
      await prisma.invoice.update({ where: { id: existing.id }, data: { externalStatus: mapped.status } })
      counters.invoices.updated += 1
    } else counters.invoices.unchanged += 1
    return
  }
  const clash = await prisma.invoice.findFirst({
    where: {
      companyId,
      direction,
      number: mapped.number,
      ...(direction === 'PURCHASE' ? { tiersId } : {}),
      ...(existing ? { id: { not: existing.id } } : {}),
    },
    select: { id: true },
  })
  if (clash) {
    counters.refused.push({ direction, reference: mapped.number, reason: 'une facture de même numéro est déjà enregistrée dans Kledg' })
    return
  }
  const tiers = await prisma.tiers.findUniqueOrThrow({ where: { id: tiersId }, select: { siren: true, vatNumber: true, paymentTermsDays: true, paymentTermsEndOfMonth: true } })
  const dueDate = mapped.dueDate ?? defaultDueDate(mapped.issueDate, termsOfTiers(tiers) ?? (await getPaymentTerms(companyId)))
  const own = { siren: company.siren, vat: company.vatNumber }
  const other = { siren: tiers.siren, vat: tiers.vatNumber }
  const [seller, buyer] = direction === 'SALE' ? [own, other] : [other, own]
  const data = {
    tiersId,
    number: mapped.number,
    issueDate: dayToDate(mapped.issueDate),
    dueDate: dayToDate(dueDate < mapped.issueDate ? mapped.issueDate : dueDate),
    externalStatus: mapped.status,
    externalAttachmentId: mapped.attachmentId,
    attachmentFileName: mapped.attachmentFileName,
    sellerSiren: seller.siren,
    sellerVatNumber: seller.vat,
    buyerSiren: buyer.siren,
    buyerVatNumber: buyer.vat,
    totalExclTax: centsToDecimal(mapped.totals.totalExclTaxCents),
    totalVat: centsToDecimal(mapped.totals.totalVatCents),
    totalInclTax: centsToDecimal(mapped.totals.totalInclTaxCents),
    lines: {
      create: mapped.lines.map((line, i) => ({
        position: i + 1,
        label: line.label,
        quantity: new Prisma.Decimal(line.quantityThousandths).div(1000),
        unitPrice: centsToDecimal(line.unitPriceCents),
        vatRateBp: line.vatRateBp,
        totalExclTax: centsToDecimal(line.totalExclTaxCents),
        nature: 'SERVICES' as const,
      })),
    },
    vatBreakdown: {
      create: mapped.totals.breakdown.map((row) => ({ vatRateBp: row.vatRateBp, baseAmount: centsToDecimal(row.baseCents), vatAmount: centsToDecimal(row.vatCents) })),
    },
  }
  await prisma.$transaction(async (tx) => {
    if (existing) {
      // Still a draft (checked above, again under the row lock): replace its lines with the document's.
      const locked = await tx.$queryRaw<Array<{ entryId: string | null }>>`SELECT "entryId" FROM "invoices" WHERE "id" = ${existing.id} FOR UPDATE`
      if (locked[0]?.entryId) return
      await tx.invoiceLine.deleteMany({ where: { invoiceId: existing.id } })
      await tx.invoiceVatBreakdown.deleteMany({ where: { invoiceId: existing.id } })
      await tx.invoice.update({ where: { id: existing.id }, data })
    } else {
      await tx.invoice.create({ data: { ...data, companyId, direction, source: 'QONTO', externalId: mapped.externalId } })
    }
  })
  if (existing) counters.invoices.updated += 1
  else counters.invoices.created += 1
}

export async function importQontoInvoices(companyId: string, input: { since?: string } = {}): Promise<ImportQontoResult> {
  await limitBankCalls(companyId)
  const { login, secretKey } = await getQontoCredentials(companyId)
  const qonto = new QontoInvoicing(login, secretKey)
  const since = input.since ? `${input.since}T00:00:00Z` : undefined
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { siren: true, vatNumber: true } })
  const counters: Counters = { tiers: { created: 0, updated: 0 }, invoices: { created: 0, updated: 0, unchanged: 0 }, ignored: 0, refused: [], complete: true }

  const clients = await qonto.listClients(since)
  counters.complete &&= clients.complete
  const customerIds = new Map<string, string>()
  for (const client of clients.items) customerIds.set(client.id, await upsertCustomer(companyId, client, counters))

  const sales = await qonto.listClientInvoices(since)
  counters.complete &&= sales.complete
  for (const invoice of sales.items) {
    const mapped = mapClientInvoice(invoice)
    if (mapped.kind === 'ignored') {
      counters.ignored += 1
      continue
    }
    if (mapped.kind === 'refused') {
      counters.refused.push({ direction: 'SALE', reference: invoice.number || invoice.id, reason: mapped.reason })
      continue
    }
    if (!invoice.client?.id) {
      counters.refused.push({ direction: 'SALE', reference: mapped.invoice.number, reason: 'client absent' })
      continue
    }
    const tiersId = customerIds.get(invoice.client.id) ?? (await upsertCustomer(companyId, invoice.client, counters))
    customerIds.set(invoice.client.id, tiersId)
    await saveInvoice(companyId, 'SALE', tiersId, mapped.invoice, company, counters)
  }

  const purchases = await qonto.listSupplierInvoices(since)
  counters.complete &&= purchases.complete
  for (const invoice of purchases.items) {
    const name = (invoice.supplier_name || invoice.supplier_snapshot?.name || '').trim().slice(0, 200)
    const mapped = mapSupplierInvoice(invoice, name)
    if (mapped.kind === 'ignored') {
      counters.ignored += 1
      continue
    }
    if (mapped.kind === 'refused') {
      counters.refused.push({ direction: 'PURCHASE', reference: invoice.invoice_number || invoice.id, reason: mapped.reason })
      continue
    }
    if (!name) {
      counters.refused.push({ direction: 'PURCHASE', reference: mapped.invoice.number, reason: 'fournisseur absent' })
      continue
    }
    const identity = identityOf(invoice.supplier_snapshot?.tin ?? invoice.tin_number, invoice.supplier_snapshot?.vat_number ?? invoice.vat_number)
    const tiersId = await upsertSupplier(companyId, invoice.supplier_id ?? null, name, identity, counters)
    await saveInvoice(companyId, 'PURCHASE', tiersId, mapped.invoice, company, counters)
  }

  await writeAuditLog('info', 'Qonto invoices imported', {
    action: 'IMPORT_QONTO_INVOICES',
    companyId,
    metadata: { tiers: counters.tiers, invoices: counters.invoices, ignored: counters.ignored, refused: counters.refused.length, complete: counters.complete },
  })
  return counters
}
