/**
 * Qonto invoicing endpoints, read-only. Only endpoints checked in Qonto's
 * public Business API reference (docs.qonto.com, checked 2026-10-04) are
 * called; each works with the API key Kledg already stores (login:secret):
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
 * Not called: Qonto documents no list of suppliers (suppliers come from the
 * supplier invoices), and the endpoints /customers, /invoices, /payments,
 * /vendors and /suppliers are not in the public reference.
 */

import { QontoClientBase, qontoPathSegment } from './client-base'

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

  /** The signed URL of an attachment (valid 30 minutes): fetch it through files.ts only. */
  async getAttachmentFile(attachmentId: string): Promise<QontoAttachmentFile | null> {
    const body = await this.request<{ attachment?: Partial<QontoAttachmentFile> }>(`/attachments/${qontoPathSegment(attachmentId)}`)
    const attachment = body.attachment
    if (!attachment?.url) return null
    return { url: attachment.url, file_name: attachment.file_name ?? null, file_content_type: attachment.file_content_type ?? null }
  }
}
