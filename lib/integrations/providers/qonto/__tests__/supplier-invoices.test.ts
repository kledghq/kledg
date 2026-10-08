/**
 * Qonto supplier invoices (lib/integrations/providers/qonto/supplier-
 * invoices.ts): the multipart upload Qonto documents (one file and its
 * idempotency key per invoice, no attachment matcher on request), the
 * 200 answer that carries per invoice errors, and the read back of the
 * invoice's attachment id.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { QontoSupplierInvoices } from '../supplier-invoices'
import { QONTO_RECEIPT_CAPABILITIES } from '../capabilities'

const calls: Array<{ url: string; init: RequestInit }> = []
function answer(status: number, body: unknown) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  calls.length = 0
})

const file = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'taxi.jpg', { type: 'image/jpeg' })

describe('QontoSupplierInvoices', () => {
  it('uploads one file with its idempotency key, without the attachment matcher, with the API key', async () => {
    answer(200, { supplier_invoices: [{ id: 'si-1', attachment_id: 'att-1', status: 'to_review', file_name: 'taxi.jpg' }], errors: [] })
    const result = await new QontoSupplierInvoices('org-slug', 'secret').uploadSupplierInvoice(file(), 'key-1', { skipMatcher: true })
    expect(result).toEqual({ kind: 'created', invoice: { id: 'si-1', attachment_id: 'att-1', status: 'to_review', file_name: 'taxi.jpg' } })
    const { url, init } = calls[0]
    expect(url).toBe('https://thirdparty.qonto.com/v2/supplier_invoices/bulk')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('org-slug:secret')
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    const form = init.body as FormData
    expect((form.get('supplier_invoices[][file]') as File).name).toBe('taxi.jpg')
    expect(form.get('supplier_invoices[][idempotency_key]')).toBe('key-1')
    expect(form.get('skip_attachment_matcher')).toBe('true')
    expect(form.get('source')).toBe('integration')
  })

  it('reads the per invoice errors of a 200 answer as a refusal', async () => {
    answer(200, { supplier_invoices: [], errors: [{ code: 'invalid', detail: 'File is too large or wrong content type', source: { pointer: '/supplier_invoices/idempotency_key/key-1/file' } }] })
    expect(await new QontoSupplierInvoices('o', 's').uploadSupplierInvoice(file(), 'key-1', { skipMatcher: true })).toEqual({ kind: 'refused', codes: ['invalid'] })
  })

  it('throws a typed error when Qonto refuses the request itself', async () => {
    answer(403, { errors: [{ code: 'forbidden', detail: 'Missing scope' }] })
    await expect(new QontoSupplierInvoices('o', 's').uploadSupplierInvoice(file(), 'k', { skipMatcher: true })).rejects.toThrow()
  })

  it('reads an invoice back with its attachment id', async () => {
    answer(200, { supplier_invoice: { id: 'si-1', attachment_id: 'att-1', status: 'to_review' } })
    expect(await new QontoSupplierInvoices('o', 's').getSupplierInvoice('si-1')).toMatchObject({ id: 'si-1', attachment_id: 'att-1' })
    expect(calls[0].url).toBe('https://thirdparty.qonto.com/v2/supplier_invoices/si-1')
  })

  it('declares what Qonto can store in one place', () => {
    expect(QONTO_RECEIPT_CAPABILITIES).toEqual({ storesTransactionReceipts: true, canStoreUnmatchedReceipts: true, canStoreExpenseReports: false })
  })
})
