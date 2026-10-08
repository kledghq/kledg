/**
 * Qonto supplier invoices: the one Qonto endpoint that stores a file
 * without a bank transaction and keeps it readable through the API. Checked
 * in Qonto's Business API reference on 2026-10-08 (no change log or date on
 * the pages):
 *
 * - POST /v2/supplier_invoices/bulk (scope supplier_invoice.write; API key
 *   and OAuth, "Endpoints access" table of
 *   https://docs.qonto.com/get-started/business-api/authentication/introduction):
 *   multipart, up to 20 invoices, each `supplier_invoices[][file]` with its
 *   own `supplier_invoices[][idempotency_key]` (no idempotency header);
 *   optional `skip_attachment_matcher`. Answers 200 even when an invoice
 *   failed: the body has `supplier_invoices` and `errors` (code invalid,
 *   required, limit_reached, internal_server_error; pointer
 *   /supplier_invoices/idempotency_key/<key>). A new invoice is `to_review`.
 *   https://docs.qonto.com/api-reference/business-api/expense-management/supplier-invoices/create-supplier-invoices
 *   https://docs.qonto.com/get-started/business-api/use-cases/bulk-upload-supplier-invoices
 * - GET /v2/supplier_invoices/{id} (scope supplier_invoice.read): the
 *   invoice with its `attachment_id`; the file itself is read with
 *   GET /v2/attachments/{id} (signed URL valid 30 minutes).
 *   https://docs.qonto.com/api-reference/business-api/expense-management/supplier-invoices/retrieve-a-supplier-invoice
 * - No endpoint deletes a supplier invoice (list, create, retrieve, reject,
 *   mark as paid and unmark only): a file sent there stays at Qonto.
 *
 * Not used, and why (same date):
 * - POST /v2/attachments stores a standalone attachment, but the reference
 *   does not say how long an attachment linked to nothing is kept: Kledg
 *   cannot drop its copy on that basis.
 * - Requests (/v2/requests/*): transfer and card requests only, created by
 *   OAuth only; no reimbursement or expense report endpoint, no receipt
 *   inbox endpoint.
 */

import { QontoClientBase, qontoPathSegment } from './client-base'

export interface QontoSupplierInvoice {
  id: string
  attachment_id: string | null
  status: string | null
  file_name: string | null
}

export type SupplierInvoiceUpload =
  | { kind: 'created'; invoice: QontoSupplierInvoice }
  | { kind: 'refused'; codes: string[] }

function invoiceOf(value: unknown): QontoSupplierInvoice | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || !v.id) return null
  return {
    id: v.id,
    attachment_id: typeof v.attachment_id === 'string' && v.attachment_id ? v.attachment_id : null,
    status: typeof v.status === 'string' ? v.status : null,
    file_name: typeof v.file_name === 'string' ? v.file_name : null,
  }
}

export class QontoSupplierInvoices extends QontoClientBase {
  /**
   * Uploads one file as a supplier invoice. `skipMatcher`: Qonto does not try
   * to attach it to a transaction (a receipt paid with a personal card has
   * none). `refused` lists Qonto's error codes for this invoice; any other
   * failure throws (lib/banking/errors.ts).
   */
  async uploadSupplierInvoice(file: File, idempotencyKey: string, options: { skipMatcher: boolean }): Promise<SupplierInvoiceUpload> {
    const form = new FormData()
    form.append('supplier_invoices[][file]', file)
    form.append('supplier_invoices[][idempotency_key]', idempotencyKey)
    form.append('source', 'integration')
    form.append('skip_attachment_matcher', options.skipMatcher ? 'true' : 'false')
    const response = await this.send('/supplier_invoices/bulk', { method: 'POST', body: form }, false)
    const body = (await response.json().catch(() => ({}))) as { supplier_invoices?: unknown[]; errors?: Array<{ code?: string }> }
    const invoice = (body.supplier_invoices ?? []).map(invoiceOf).find((i): i is QontoSupplierInvoice => i !== null)
    if (invoice) return { kind: 'created', invoice }
    return { kind: 'refused', codes: (body.errors ?? []).map((e) => e.code ?? 'unknown') }
  }

  async getSupplierInvoice(id: string): Promise<QontoSupplierInvoice | null> {
    const body = await this.request<{ supplier_invoice?: unknown }>(`/supplier_invoices/${qontoPathSegment(id)}`)
    return invoiceOf(body.supplier_invoice)
  }
}
