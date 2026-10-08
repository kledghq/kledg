/**
 * Sales invoices created in Qonto first (Qonto-first, a company setting):
 * Kledg's form stays the same; on submit Kledg creates the client invoice in
 * Qonto (Qonto numbers it and makes the PDF), keeps Qonto's number and
 * document, and the invoice is posted in Kledg as any other. Endpoints and
 * what an API key may do: lib/integrations/providers/qonto/invoicing.ts.
 *
 * Invariants owned here:
 * - an invoice is never created twice in Qonto: Kledg records it (origin
 *   QONTO, qontoRequestedAt, no Qonto id yet) before sending it. Qonto
 *   refuses (4xx): nothing exists there, the record is deleted. Qonto does
 *   not answer (timeout, 5xx): the record stays pending and a retry
 *   (resumeQontoInvoice) first looks among the invoices created at Qonto
 *   since the request for the same client, date, total and number of lines,
 *   and adopts it instead of creating another one; a retry claims the record
 *   first (qontoRequestedAt moves forward), so two retries at once never
 *   both send it. Kledg's checks and the Qonto client come before the
 *   record: a failure there leaves nothing behind;
 * - the invoice keeps Qonto's number and amounts (Qonto issued the
 *   document), mapped like the import (qonto-mapping.ts); the accounts and
 *   natures typed in Kledg stay on the lines;
 * - once created in Qonto the invoice follows Qonto's rules: its amounts do
 *   not change in Kledg and it is not deleted (a credit note cancels it);
 * - Qonto refusing the connection (401, 403) is recorded on the company
 *   (qontoInvoicingRefusal): Kledg then numbers the invoices itself until the
 *   setting is saved again;
 * - credit notes are not created in Qonto (Create a credit note is not in
 *   the endpoints open to an API key, invoicing.ts); they follow Kledg's
 *   numbering;
 * - an invoice may be created as a draft in Qonto (qontoStatus "draft",
 *   stored as qontoDraft): it stays a draft in Kledg, without number and not
 *   postable, until it is finalized in Qonto; the import then finds it by
 *   its Qonto id and completes its number and document.
 */

import { Prisma, type Tiers } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, ExternalServiceError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { limitBankCalls } from '@/lib/banking/guard'
import { getQontoCredentials, QONTO_NOT_CONNECTED_MESSAGE } from '@/lib/integrations/providers/qonto/get-credentials'
import { QontoInvoicing, type QontoClientInvoice, type QontoCreateOutcome } from '@/lib/integrations/providers/qonto/invoicing'
import { calendarDayOf } from '@/lib/utils/date'
import { centsToDecimal, parseCents, toCents } from '@/lib/utils/money'
import { createInvoice, getInvoice, lockInvoice, originOfNewInvoice, type CreateInvoiceInput, type InvoiceDetail } from './manage-invoices.service'
import { loadNumberingSettings } from './numbering/series'
import { mapClientInvoice } from './qonto-mapping'

const cents = (value: { toString(): string }) => parseCents(value) ?? 0

/** Seconds a request stays Qonto's to answer before a retry may claim it (above the 20 s timeout of a bank call). */
const CLAIM_AFTER_MS = 60_000
/** A retry looks at invoices created at Qonto from this long before the first request. */
const LOOKBACK_MS = 2 * 60_000

export const QONTO_REFUSED_PREFIX = 'Qonto refuse la création de factures avec cette connexion'

export interface QontoInvoicingCapability {
  /** A Qonto API key is stored for the company. */
  connected: boolean
  /** Why Qonto refused to create an invoice with it (null: never refused). */
  refusal: string | null
  /** Kledg may create client invoices in Qonto. */
  canCreate: boolean
}

/** Whether the company's Qonto connection can create client invoices (the API key may: see invoicing.ts), without calling Qonto. */
export async function qontoInvoicingCapability(companyId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<QontoInvoicingCapability> {
  const [connection, integration, company] = await Promise.all([
    db.bankConnection.findUnique({ where: { companyId_provider: { companyId, provider: 'QONTO' } }, select: { secretKeyEncrypted: true } }),
    db.integration.findFirst({ where: { companyId, provider: 'QONTO', status: 'active', type: 'BANKING' }, select: { id: true } }),
    db.company.findUnique({ where: { id: companyId }, select: { qontoInvoicingRefusal: true } }),
  ])
  const connected = Boolean(connection?.secretKeyEncrypted) || Boolean(integration)
  const refusal = company?.qontoInvoicingRefusal ?? null
  return { connected, refusal, canCreate: connected && refusal === null }
}

/** Whether a new sales invoice goes to Qonto first: the setting (on by default) and a connection that can. */
export async function qontoFirstActive(companyId: string): Promise<boolean> {
  const [settings, capability] = await Promise.all([loadNumberingSettings(prisma, companyId), qontoInvoicingCapability(companyId)])
  return (settings.qontoFirst ?? true) && capability.canCreate
}

/**
 * Records a new invoice the way its numbering says: created in Qonto first
 * (choice qonto, or the company's default for a sales invoice), else in
 * Kledg (Kledg's series, typed, or already issued elsewhere). The entry
 * point of the API route and the MCP tool.
 */
export async function issueInvoice(companyId: string, input: CreateInvoiceInput, options: { source?: string } = {}): Promise<InvoiceDetail> {
  let choice = input.numbering
  if (input.qontoStatus && choice && choice !== 'qonto') {
    throw new ValidationError('Le statut dans Qonto (brouillon ou finalisée) ne vaut que pour une facture créée dans Qonto.')
  }
  if (!choice && input.qontoStatus) choice = 'qonto'
  if (!choice && input.direction === 'SALE' && input.typeCode === '380' && !input.number && (await qontoFirstActive(companyId))) choice = 'qonto'
  if (choice === 'qonto') return createInvoiceInQonto(companyId, input, options)
  return createInvoice(companyId, input, { source: options.source, origin: await originOfNewInvoice(prisma, companyId, input.direction, choice) })
}

function refusalMessage(outcome: Extract<QontoCreateOutcome<unknown>, { kind: 'refused' }>, what: 'invoice' | 'client', name: string): string {
  const has = (text: string) => outcome.codes.some((c) => c.includes(text)) || outcome.pointers.some((p) => p.includes(text))
  if (outcome.status === 401 || outcome.status === 403) {
    return `${QONTO_REFUSED_PREFIX} : la clé API enregistrée n’a pas ce droit (erreur ${outcome.status}). Kledg numérote vos factures en attendant ; vérifiez la clé API dans Qonto (Intégrations et partenariats), puis réactivez « Créer les factures dans Qonto » dans Informations.`
  }
  if (outcome.status === 429) return 'Qonto limite le nombre de requêtes : réessayez dans quelques minutes.'
  if (what === 'client') return `Qonto a refusé de créer le client « ${name} » (erreur ${outcome.status}) : vérifiez son adresse, son SIREN et son numéro de TVA, puis réessayez.`
  if (has('invoice_number_already_exists')) return 'Qonto signale que ce numéro de facture existe déjà dans Qonto : vérifiez la numérotation de Qonto, puis réessayez.'
  if (has('currency')) return `Le client « ${name} » n’a pas de devise dans Qonto : renseignez-la (EUR) sur sa fiche client dans Qonto, puis réessayez.`
  if (has('/number') || has('number')) {
    return 'La numérotation automatique est désactivée dans Qonto, qui exige alors un numéro : activez-la dans les paramètres de facturation de Qonto, ou créez la facture dans Kledg.'
  }
  if (has('iban')) return 'Qonto refuse l’IBAN du compte principal pour cette facture : vérifiez le compte dans Qonto, puis réessayez.'
  return `Qonto a refusé la facture (erreur ${outcome.status}) : vérifiez le client (adresse, devise) et les lignes, puis réessayez.`
}

const UNCERTAIN_MESSAGE =
  'Qonto n’a pas confirmé la création de la facture. Elle reste en attente dans Kledg : reprenez sa création depuis la facture, Kledg vérifiera d’abord si Qonto l’a créée, pour ne jamais la créer deux fois.'

async function qontoFor(companyId: string) {
  const { login, secretKey } = await getQontoCredentials(companyId)
  return new QontoInvoicing(login, secretKey)
}

/**
 * Deletes in Qonto the draft a Kledg invoice was created as, before Kledg
 * deletes its own copy: both stay in step. Already gone in Qonto: nothing
 * to do. Finalized in Qonto meanwhile, or no clear answer: refused, the
 * Kledg copy stays.
 */
export async function deleteQontoDraft(companyId: string, externalId: string): Promise<void> {
  const outcome = await (await qontoFor(companyId)).deleteClientInvoice(externalId)
  if (outcome === 'deleted' || outcome === 'gone') return
  if (outcome === 'not-draft') {
    throw new ConflictError('Cette facture a été finalisée dans Qonto : elle ne peut plus être supprimée. Importez les factures Qonto pour reprendre son numéro, puis annulez-la par un avoir.')
  }
  throw new ConflictError('Qonto n’a pas confirmé la suppression du brouillon : réessayez dans un instant, la facture reste dans Kledg tant que Qonto la garde.')
}

async function recordRefusal(companyId: string, message: string) {
  await prisma.company.update({ where: { id: companyId }, data: { qontoInvoicingRefusal: message.slice(0, 500) } })
  await writeAuditLog('warn', 'Qonto refused to create client invoices', { action: 'QONTO_INVOICING_REFUSED', companyId })
}

type TiersForQonto = Pick<Tiers, 'id' | 'name' | 'siren' | 'siret' | 'vatNumber' | 'email' | 'qontoId'> & {
  address: { street: string; street2: string | null; postalCode: string; city: string; country: string } | null
}

/** The Qonto client of a customer: its stored Qonto id, else found by SIRET, SIREN, VAT number or exact name, else created. */
async function ensureQontoClient(companyId: string, qonto: QontoInvoicing, tiers: TiersForQonto): Promise<string> {
  if (tiers.qontoId) return tiers.qontoId
  let found: string | null = null
  const lookups: Array<['tax_identification_number' | 'vat_number' | 'name', string | null]> = [
    ['tax_identification_number', tiers.siret],
    ['tax_identification_number', tiers.siren],
    ['vat_number', tiers.vatNumber],
    ['name', tiers.name.length >= 2 ? tiers.name : null],
  ]
  for (const [filter, value] of lookups) {
    if (!value || found) continue
    const clients = await qonto.findClients(filter, value)
    const exact = clients.filter((c) => filter !== 'name' || (c.name ?? '').trim().toLowerCase() === value.trim().toLowerCase())
    if (exact.length === 1) found = exact[0].id
  }
  if (!found) {
    if (!tiers.address) {
      throw new ValidationError(`Renseignez l’adresse du client « ${tiers.name} » : Qonto l’exige pour créer une facture.`)
    }
    const outcome = await qonto.createClient({
      kind: 'company',
      name: tiers.name.slice(0, 250),
      currency: 'EUR',
      locale: 'fr',
      ...(tiers.email ? { email: tiers.email } : {}),
      ...(tiers.vatNumber ? { vat_number: tiers.vatNumber } : {}),
      ...(tiers.siret || tiers.siren ? { tax_identification_number: (tiers.siret ?? tiers.siren) as string } : {}),
      billing_address: {
        street_address: [tiers.address.street, tiers.address.street2].filter(Boolean).join(', ').slice(0, 250),
        city: tiers.address.city,
        zip_code: tiers.address.postalCode,
        country_code: tiers.address.country,
      },
    })
    if (outcome.kind === 'uncertain') {
      throw new ExternalServiceError(`Qonto n’a pas confirmé la création du client « ${tiers.name} » : réessayez, Kledg le retrouvera par son SIREN, son numéro de TVA ou son nom.`)
    }
    if (outcome.kind === 'refused') {
      const message = refusalMessage(outcome, 'client', tiers.name)
      if (outcome.status === 401 || outcome.status === 403) await recordRefusal(companyId, message)
      throw new ExternalServiceError(message)
    }
    found = outcome.value.id
  }
  // Remember it: the next invoice of this customer goes to the same Qonto client (unless another tiers already holds it).
  const holder = await prisma.tiers.findFirst({ where: { companyId, kind: 'CUSTOMER', qontoId: found }, select: { id: true } })
  if (!holder) await prisma.tiers.update({ where: { id: tiers.id }, data: { qontoId: found } })
  return found
}

const TIERS_SELECT = {
  id: true,
  name: true,
  siren: true,
  siret: true,
  vatNumber: true,
  email: true,
  qontoId: true,
  address: { select: { street: true, street2: true, postalCode: true, city: true, country: true } },
} satisfies Prisma.TiersSelect

/** Decimal quantity as Qonto reads it ("1.5"). */
function quantityText(quantity: { toString(): string }): string {
  const text = quantity.toString()
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

/** Euros of cents as a decimal string ("1234.50"). */
const euros = (amountCents: number) => `${amountCents < 0 ? '-' : ''}${Math.floor(Math.abs(amountCents) / 100)}.${String(Math.abs(amountCents) % 100).padStart(2, '0')}`

async function loadForQonto(companyId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId },
    select: {
      id: true,
      origin: true,
      externalId: true,
      qontoRequestedAt: true,
      qontoDraft: true,
      createdAt: true,
      issueDate: true,
      dueDate: true,
      totalInclTax: true,
      tiers: { select: { name: true } },
      lines: { orderBy: { position: 'asc' }, select: { label: true, quantity: true, unitPrice: true, vatRateBp: true } },
    },
  })
  if (!invoice) throw new NotFoundError('Facture introuvable')
  return invoice
}

type LoadedInvoice = Awaited<ReturnType<typeof loadForQonto>>

function payloadOf(invoice: LoadedInvoice, clientId: string, iban: string) {
  return {
    client_id: clientId,
    issue_date: calendarDayOf(invoice.issueDate) as string,
    due_date: calendarDayOf(invoice.dueDate) as string,
    currency: 'EUR',
    // Finalized (numbered by Qonto) unless the user asked for a draft in Qonto.
    status: invoice.qontoDraft ? ('draft' as const) : ('unpaid' as const),
    payment_methods: { iban },
    items: invoice.lines.map((line) => ({
      // Qonto: title at most 40 characters, the full label in the description (1800).
      title: line.label.slice(0, 40),
      ...(line.label.length > 40 ? { description: line.label.slice(0, 1800) } : {}),
      quantity: quantityText(line.quantity),
      unit_price: { value: euros(cents(line.unitPrice)), currency: 'EUR' },
      vat_rate: String(line.vatRateBp / 10000),
    })),
  }
}

/** The invoice a lost answer may have created: same client, date, total and number of items, not linked to another invoice. */
async function findCreated(companyId: string, qonto: QontoInvoicing, invoice: LoadedInvoice, clientId: string): Promise<QontoClientInvoice | null> {
  // From the moment Kledg recorded the invoice (before its first request): a retry moves qontoRequestedAt, not createdAt.
  const since = new Date(invoice.createdAt.getTime() - LOOKBACK_MS).toISOString()
  const { items } = await qonto.listClientInvoicesCreatedSince(since)
  const day = calendarDayOf(invoice.issueDate) as string
  const total = cents(invoice.totalInclTax)
  const candidates = items.filter(
    (q) =>
      (q.client?.id ?? null) === clientId &&
      (q.issue_date ?? '').startsWith(day) &&
      q.total_amount !== null &&
      q.total_amount !== undefined &&
      toCents(q.total_amount.value) === total &&
      (q.items ?? []).length === invoice.lines.length &&
      q.status !== 'canceled',
  )
  if (candidates.length === 0) return null
  const linked = await prisma.invoice.findMany({ where: { companyId, source: 'QONTO', externalId: { in: candidates.map((c) => c.id) } }, select: { externalId: true } })
  const taken = new Set(linked.map((l) => l.externalId))
  return candidates.find((c) => !taken.has(c.id)) ?? null
}

/** Stores what Qonto created on the pending invoice: Qonto's id, number, status, PDF and, when they differ, its amounts. */
async function adopt(companyId: string, invoiceId: string, created: QontoClientInvoice): Promise<void> {
  const mapped = mapClientInvoice({ ...created, client: created.client ?? null })
  await prisma.$transaction(async (tx) => {
    const locked = await lockInvoice(tx, companyId, invoiceId)
    if (locked.externalId) return
    // A draft in Qonto stays without number in Kledg until it is finalized there (the import completes it).
    const number = created.status === 'draft' ? null : created.number?.trim() || null
    if (number) {
      const clash = await tx.invoice.findFirst({ where: { companyId, direction: 'SALE', number, id: { not: invoiceId } }, select: { id: true } })
      if (clash) {
        throw new ConflictError(
          `Qonto a créé la facture sous le n° ${number}, déjà porté par une autre facture de vente dans Kledg : corrigez la numérotation dans Qonto ou le numéro de l’autre facture, puis reprenez la création.`,
        )
      }
    }
    const data: Prisma.InvoiceUpdateInput = {
      externalId: created.id,
      number,
      externalStatus: created.status ?? null,
      externalAttachmentId: created.attachment_id ?? null,
      qontoDraft: created.status === 'draft',
    }
    if (mapped.kind === 'ok') {
      const current = await tx.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { totalInclTax: true, lines: { orderBy: { position: 'asc' }, select: { accountCode: true, nature: true, fixedAsset: true } } },
      })
      const doc = mapped.invoice
      if (doc.totals.totalInclTaxCents !== cents(current.totalInclTax) && doc.lines.length === current.lines.length) {
        // Qonto rounds its own way: the document's amounts are the invoice; Kledg's accounts stay on the lines.
        await tx.invoiceLine.deleteMany({ where: { invoiceId } })
        await tx.invoiceVatBreakdown.deleteMany({ where: { invoiceId } })
        data.totalExclTax = centsToDecimal(doc.totals.totalExclTaxCents)
        data.totalVat = centsToDecimal(doc.totals.totalVatCents)
        data.totalInclTax = centsToDecimal(doc.totals.totalInclTaxCents)
        data.lines = {
          create: doc.lines.map((line, i) => ({
            position: i + 1,
            label: line.label,
            quantity: new Prisma.Decimal(line.quantityThousandths).div(1000),
            unitPrice: centsToDecimal(line.unitPriceCents),
            vatRateBp: line.vatRateBp,
            totalExclTax: centsToDecimal(line.totalExclTaxCents),
            accountCode: current.lines[i].accountCode,
            nature: current.lines[i].nature,
            fixedAsset: current.lines[i].fixedAsset,
          })),
        }
        data.vatBreakdown = { create: doc.totals.breakdown.map((row) => ({ vatRateBp: row.vatRateBp, baseAmount: centsToDecimal(row.baseCents), vatAmount: centsToDecimal(row.vatCents) })) }
      }
    }
    await tx.invoice.update({ where: { id: invoiceId }, data })
  })
  await writeAuditLog('info', `Invoice created in Qonto: ${created.number ?? created.id}`, {
    action: 'CREATE_INVOICE_IN_QONTO',
    companyId,
    metadata: { invoiceId, qontoId: created.id },
  })
}

/** The Qonto client of the customer and the IBAN to print: everything Qonto needs before the invoice is sent. */
async function prerequisites(companyId: string, qonto: QontoInvoicing, tiersId: string) {
  const tiers = await prisma.tiers.findFirst({ where: { id: tiersId, companyId }, select: TIERS_SELECT })
  if (!tiers) throw new NotFoundError('Tiers introuvable')
  const clientId = await ensureQontoClient(companyId, qonto, tiers)
  const iban = await qonto.mainIban()
  if (!iban) throw new ValidationError('Aucun compte Qonto avec un IBAN : Qonto imprime l’IBAN du compte principal sur la facture.')
  return { clientId, iban }
}

/** Sends a pending invoice to Qonto (after looking for it there when `lookFirst`), then stores Qonto's answer. */
async function send(companyId: string, invoiceId: string, qonto: QontoInvoicing, target: { clientId: string; iban: string }, lookFirst: boolean): Promise<InvoiceDetail> {
  const invoice = await loadForQonto(companyId, invoiceId)
  const { clientId, iban } = target
  if (lookFirst) {
    const existing = await findCreated(companyId, qonto, invoice, clientId)
    if (existing) {
      await adopt(companyId, invoiceId, existing)
      return getInvoice(companyId, invoiceId)
    }
  }
  const outcome = await qonto.createClientInvoice(payloadOf(invoice, clientId, iban))
  if (outcome.kind === 'created') {
    await adopt(companyId, invoiceId, outcome.value)
    return getInvoice(companyId, invoiceId)
  }
  if (outcome.kind === 'uncertain') throw new ExternalServiceError(UNCERTAIN_MESSAGE)
  // Refused: nothing exists at Qonto (looked for first on a retry), the pending record goes.
  const message = refusalMessage(outcome, 'invoice', invoice.tiers.name)
  await prisma.invoice.deleteMany({ where: { id: invoiceId, companyId, externalId: null, entryId: null } })
  if (outcome.status === 401 || outcome.status === 403) await recordRefusal(companyId, message)
  throw new ExternalServiceError(message)
}

/** Creates a sales invoice in Qonto first, then keeps it in Kledg as a draft to post (see the module header). */
export async function createInvoiceInQonto(companyId: string, input: CreateInvoiceInput, options: { source?: string } = {}): Promise<InvoiceDetail> {
  if (input.direction !== 'SALE') throw new ValidationError('Seule une facture de vente se crée dans Qonto.')
  if (input.typeCode === '381') {
    throw new ValidationError('Qonto n’ouvre pas la création d’avoirs à la clé API enregistrée par Kledg : numérotez l’avoir dans Kledg, ou créez-le dans Qonto puis importez-le.')
  }
  if (input.number) throw new ValidationError('Qonto donne le numéro de la facture : laissez le numéro vide, ou choisissez « Enregistrer une facture déjà émise ».')
  const capability = await qontoInvoicingCapability(companyId)
  if (!capability.connected) throw new ValidationError(QONTO_NOT_CONNECTED_MESSAGE)
  if (capability.refusal) throw new ValidationError(capability.refusal.startsWith(QONTO_REFUSED_PREFIX) ? capability.refusal : `${QONTO_REFUSED_PREFIX} : ${capability.refusal}`)
  await limitBankCalls(companyId)
  const qonto = await qontoFor(companyId)
  const target = await prerequisites(companyId, qonto, input.tiersId)
  // Recorded before it is sent (checked like any invoice: tiers, lines, VAT, due date), so a lost answer is found again.
  const draft = await createInvoice(companyId, { ...input, number: null }, { source: options.source, origin: 'QONTO', qontoRequestedAt: new Date(), qontoDraft: input.qontoStatus === 'draft' })
  return send(companyId, draft.id, qonto, target, false)
}

/**
 * Resumes the creation in Qonto of an invoice whose answer was lost: looks
 * for it at Qonto first, else sends it again. Claimed first (an
 * optimistic update of qontoRequestedAt), so two retries never both send it.
 */
export async function resumeQontoInvoice(companyId: string, invoiceId: string): Promise<InvoiceDetail> {
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId }, select: { origin: true, externalId: true, qontoRequestedAt: true, tiersId: true } })
  if (!invoice) throw new NotFoundError('Facture introuvable')
  if (invoice.origin !== 'QONTO' || !invoice.qontoRequestedAt || invoice.externalId) {
    throw new ConflictError('Cette facture n’attend pas de réponse de Qonto.')
  }
  if (Date.now() - invoice.qontoRequestedAt.getTime() < CLAIM_AFTER_MS) {
    throw new ConflictError('Kledg attend encore la réponse de Qonto pour cette facture : réessayez dans une minute.')
  }
  await limitBankCalls(companyId)
  // Claimed under the invoice lock, which also checks an approved MCP action's invoice (KLEDG-R3-MCP-01)
  const claimed = await prisma.$transaction(async (tx) => {
    await lockInvoice(tx, companyId, invoiceId)
    return tx.invoice.updateMany({
      where: { id: invoiceId, companyId, externalId: null, qontoRequestedAt: invoice.qontoRequestedAt },
      data: { qontoRequestedAt: new Date() },
    })
  })
  if (claimed.count === 0) throw new ConflictError('La création de cette facture dans Qonto est déjà reprise : actualisez la page.')
  const qonto = await qontoFor(companyId)
  return send(companyId, invoiceId, qonto, await prerequisites(companyId, qonto, invoice.tiersId), true)
}
