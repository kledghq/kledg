/**
 * Qonto invoicing endpoints. Only endpoints checked in Qonto's public
 * Business API reference (docs.qonto.com, checked 2026-10-04 and
 * 2026-10-05) are called; each works with the API key Kledg already stores
 * (login:secret): the table "Endpoints access" of
 * https://docs.qonto.com/get-started/business-api/authentication/introduction
 * marks them API key ✔️ (the OpenAPI of each page lists `SecretKey` next to
 * the OAuth scope).
 *
 * - GET /v2/clients (scope client.read): list clients, paged (page,
 *   per_page), filter[updated_at_from];
 *   https://docs.qonto.com/api-reference/business-api/clients/list-clients
 * - GET /v2/client_invoices (scope client_invoices.read): list client
 *   invoices with their items (title, quantity, unit_price, vat_rate as a
 *   fraction "0.2"), totals, client and attachment_id; statuses draft,
 *   unpaid, paid, canceled;
 *   https://docs.qonto.com/api-reference/business-api/expense-management/client-quotes-notes/client-invoices/list-client-invoices
 * - GET /v2/supplier_invoices (scope supplier_invoice.read): list supplier
 *   invoices: supplier_id, supplier_name, invoice_number, dates, totals and
 *   a "taxes" array (tax_rate as a percentage "20", tax_amount); no lines;
 *   https://docs.qonto.com/api-reference/business-api/expense-management/supplier-invoices/list-supplier-invoices
 * - GET /v2/attachments/{id} (scope attachment.read): the invoice PDF, a
 *   signed URL valid 30 minutes, wrapped in "attachment";
 *   https://docs.qonto.com/api-reference/business-api/expense-management/attachments/retrieve-an-attachment
 *
 * - GET /v2/organization (scope organization.read): the bank accounts, the
 *   main one ("main": true) giving the IBAN printed on a client invoice;
 *   https://docs.qonto.com/api-reference/business-api/accounts-organizations/organizations/retrieve-the-authenticated-organization-and-list-bank-accounts
 * - GET /v2/clients with filter[tax_identification_number], filter[vat_number]
 *   or filter[name] (exact and case-insensitive; name also partial): finds
 *   the client of a tiers before creating one (Qonto has no uniqueness rule
 *   on clients);
 * - POST /v2/clients (scope client.write): creates a client; invoicing needs
 *   its currency, locale and billing address;
 *   https://docs.qonto.com/api-reference/business-api/clients/create-a-client
 * - POST /v2/client_invoices (scope client_invoice.write): creates a client
 *   invoice. Required: client_id, issue_date, due_date, currency,
 *   payment_methods.iban, items (title at most 40 characters, quantity,
 *   unit_price {value, currency}, vat_rate as a fraction "0.2"; description
 *   at most 1800). status "draft" or "unpaid" (the default: finalized).
 *   number: optional while Qonto's automatic numbering is on (the default
 *   setting), then Qonto gives it; required when it is off. Answers 201
 *   { client_invoice }, the PDF attachment generated asynchronously;
 *   https://docs.qonto.com/api-reference/business-api/expense-management/client-quotes-notes/client-invoices/create-a-client-invoice
 *   Kledg creates the invoice "unpaid" (finalized, numbered by Qonto): with
 *   an API key, Qonto offers no way to finalize a draft later (Finalize a
 *   client invoice is OAuth only in the endpoints access table), and credit
 *   notes cannot be created (Create a credit note: OAuth only).
 *   Idempotency: Qonto's X-Qonto-Idempotency-Key
 *   (https://docs.qonto.com/get-started/general/idempotent-requests) is not
 *   among the parameters of this endpoint, so Kledg records the request
 *   before sending it and, on a retry, looks for the invoice created since
 *   (filter[created_at_from]) before creating it again
 *   (lib/invoices/create-in-qonto.service.ts).
 *
 * Not called: Qonto documents no list of suppliers (suppliers come from the
 * supplier invoices), and the endpoints /customers, /invoices, /payments,
 * /vendors and /suppliers are not in the public reference.
 */

import { bankFetch } from '@/lib/banking/http'
import { logger } from '@/lib/logger'
import { QontoClientBase, getQontoExtraHeaders, qontoPathSegment } from './client-base'

export interface QontoMoney {
  value: string
  currency: string
}

export interface QontoAddress {
  street_address?: string | null
  city?: string | null
  zip_code?: string | null
  country_code?: string | null
}

export interface QontoClient {
  id: string
  kind?: string | null
  type?: string | null
  name?: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  vat_number?: string | null
  tax_identification_number?: string | null
  address?: string | null
  city?: string | null
  zip_code?: string | null
  country_code?: string | null
  billing_address?: QontoAddress | null
}

export interface QontoClientInvoiceItem {
  title?: string | null
  description?: string | null
  quantity?: string | null
  unit_price?: QontoMoney | null
  vat_rate?: string | null
  total_vat?: QontoMoney | null
  discount?: unknown
}

export interface QontoClientInvoice {
  id: string
  created_at?: string | null
  invoice_url?: string | null
  number?: string | null
  status?: string | null
  issue_date?: string | null
  due_date?: string | null
  total_amount?: QontoMoney | null
  vat_amount?: QontoMoney | null
  attachment_id?: string | null
  items?: QontoClientInvoiceItem[] | null
  client?: QontoClient | null
  currency?: string | null
}

export interface QontoSupplierInvoice {
  id: string
  supplier_id?: string | null
  supplier_name?: string | null
  invoice_number?: string | null
  status?: string | null
  issue_date?: string | null
  due_date?: string | null
  total_amount?: QontoMoney | null
  total_amount_excluding_taxes?: QontoMoney | null
  total_tax_amount?: QontoMoney | null
  taxes?: Array<{ tax_rate?: string | null; tax_amount?: QontoMoney | null }> | null
  attachment_id?: string | null
  file_name?: string | null
  vat_number?: string | null
  tin_number?: string | null
  supplier_snapshot?: { name?: string | null; tin?: string | null; vat_number?: string | null } | null
}

interface PageMeta {
  next_page: number | null
}

export interface QontoAttachmentFile {
  url: string
  file_name: string | null
  file_content_type: string | null
}

export interface QontoNewClient {
  kind: 'company' | 'individual' | 'freelancer'
  name: string
  currency: string
  locale: string
  email?: string
  vat_number?: string
  tax_identification_number?: string
  billing_address: { street_address: string; city: string; zip_code: string; country_code: string }
}

export interface QontoNewClientInvoice {
  client_id: string
  issue_date: string
  due_date: string
  currency: string
  status: 'unpaid'
  payment_methods: { iban: string }
  items: Array<{ title: string; description?: string; quantity: string; unit_price: QontoMoney; vat_rate: string }>
}

/**
 * Outcome of a creation: created; refused (Qonto answered 4xx: nothing was
 * created, the reason in French); or uncertain (no answer, a timeout or a
 * 5xx: the invoice may exist at Qonto, look for it before sending again).
 */
export type QontoCreateOutcome<T> =
  | { kind: 'created'; value: T }
  | { kind: 'refused'; status: number; codes: string[]; pointers: string[] }
  | { kind: 'uncertain' }

/** Pages read at most per list (100 items each): a larger organization is imported in several runs with `since`. */
export const MAX_PAGES = 50
const PER_PAGE = 100

export class QontoInvoicing extends QontoClientBase {
  private async listAll<T>(path: string, key: string, filters: Record<string, string>): Promise<{ items: T[]; complete: boolean }> {
    const items: T[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({ ...filters, page: String(page), per_page: String(PER_PAGE) })
      const body = await this.request<Record<string, unknown> & { meta?: PageMeta }>(`${path}?${params}`)
      const rows = body[key]
      if (Array.isArray(rows)) items.push(...(rows as T[]))
      if (!body.meta?.next_page) return { items, complete: true }
    }
    return { items, complete: false }
  }

  listClients(updatedAtFrom?: string) {
    return this.listAll<QontoClient>('/clients', 'clients', updatedAtFrom ? { 'filter[updated_at_from]': updatedAtFrom } : {})
  }

  listClientInvoices(updatedAtFrom?: string) {
    return this.listAll<QontoClientInvoice>('/client_invoices', 'client_invoices', updatedAtFrom ? { 'filter[updated_at_from]': updatedAtFrom } : {})
  }

  listSupplierInvoices(updatedAtFrom?: string) {
    return this.listAll<QontoSupplierInvoice>('/supplier_invoices', 'supplier_invoices', updatedAtFrom ? { 'filter[updated_at_from]': updatedAtFrom } : {})
  }

  /** Client invoices created since `createdAtFrom` (ISO 8601), oldest first: what a retry looks among. */
  listClientInvoicesCreatedSince(createdAtFrom: string) {
    return this.listAll<QontoClientInvoice>('/client_invoices', 'client_invoices', { 'filter[created_at_from]': createdAtFrom, sort_by: 'created_at:asc' })
  }

  /** Clients matching one exact filter (tax_identification_number, vat_number) or a name. */
  async findClients(filter: 'tax_identification_number' | 'vat_number' | 'name', value: string): Promise<QontoClient[]> {
    const params = new URLSearchParams({ [`filter[${filter}]`]: value, per_page: '100' })
    const body = await this.request<{ clients?: QontoClient[] }>(`/clients?${params}`)
    return body.clients ?? []
  }

  /** IBAN of the organization's main account (else its first account), printed on client invoices. */
  async mainIban(): Promise<string | null> {
    const body = await this.request<{ organization?: { bank_accounts?: Array<{ iban?: string; main?: boolean; status?: string }> } }>('/organization')
    const accounts = (body.organization?.bank_accounts ?? []).filter((a) => a.iban && a.status !== 'closed')
    return (accounts.find((a) => a.main) ?? accounts[0])?.iban ?? null
  }

  createClient(client: QontoNewClient) {
    return this.create<{ client?: QontoClient } & QontoClient, QontoClient>('/clients', client, (body) => (body.client?.id ? body.client : body.id ? body : null))
  }

  createClientInvoice(invoice: QontoNewClientInvoice) {
    return this.create<{ client_invoice?: QontoClientInvoice }, QontoClientInvoice>('/client_invoices', invoice, (body) => body.client_invoice ?? null)
  }

  /** POST with the outcome told apart (see QontoCreateOutcome); Qonto's error detail is logged, never shown. */
  private async create<B, T>(endpoint: string, payload: unknown, pick: (body: B) => T | null): Promise<QontoCreateOutcome<T>> {
    let response: Response
    try {
      response = await bankFetch('Qonto', (...args) => fetch(...args), `${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { Authorization: this.getAuthHeader(), 'Content-Type': 'application/json', ...getQontoExtraHeaders() },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      logger.warn(`[Qonto] POST ${endpoint} without answer`, error)
      return { kind: 'uncertain' }
    }
    if (response.ok) {
      const value = pick((await response.json().catch(() => ({}))) as B)
      if (value) return { kind: 'created', value }
      logger.error(`[Qonto] POST ${endpoint} answered ${response.status} without the created resource`)
      return { kind: 'uncertain' }
    }
    const text = await response.text().catch(() => '')
    if (response.status >= 500) {
      logger.error(`[Qonto] POST ${endpoint} failed`, { status: response.status, detail: text.replace(/\s+/g, ' ').slice(0, 300) })
      return { kind: 'uncertain' }
    }
    let codes: string[] = []
    let pointers: string[] = []
    try {
      const body = JSON.parse(text) as { errors?: Array<{ code?: string; source?: { pointer?: string } }> }
      codes = (body.errors ?? []).map((e) => e.code ?? '').filter(Boolean)
      pointers = (body.errors ?? []).map((e) => e.source?.pointer ?? '').filter(Boolean)
    } catch {
      // Not JSON: the status alone tells the reason.
    }
    logger.warn(`[Qonto] POST ${endpoint} refused`, { status: response.status, codes, pointers, detail: text.replace(/\s+/g, ' ').slice(0, 300) })
    return { kind: 'refused', status: response.status, codes, pointers }
  }

  /** The signed URL of an attachment (valid 30 minutes): fetch it through files.ts only. */
  async getAttachmentFile(attachmentId: string): Promise<QontoAttachmentFile | null> {
    const body = await this.request<{ attachment?: Partial<QontoAttachmentFile> }>(`/attachments/${qontoPathSegment(attachmentId)}`)
    const attachment = body.attachment
    if (!attachment?.url) return null
    return { url: attachment.url, file_name: attachment.file_name ?? null, file_content_type: attachment.file_content_type ?? null }
  }
}
