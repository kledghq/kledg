/**
 * Import of Qonto clients and invoices against PostgreSQL, with Qonto's
 * HTTP API mocked (no network) on the sandbox base URL of the existing
 * configuration (QONTO_ENVIRONMENT=sandbox): only the verified read-only
 * endpoints are called, tiers and invoices are mapped with their lines,
 * a second run creates nothing (idempotent by Qonto id), a posted invoice
 * keeps its amounts, and the PDF is read through the SSRF-safe download.
 * Fictitious data.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('qonto_invoices')
  process.env.ENCRYPTION_KEY ??= 'a'.repeat(64)
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedBooks, type Books } from './helpers/books'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let importer: typeof import('../import-qonto-invoices.service')
let attachment: typeof import('../read-invoice-attachment.service')
let posting: typeof import('../post-invoice.service')
let base: string

const eur = (value: string) => ({ value, currency: 'EUR' })

const CLIENTS = [
  { id: 'cl-1', kind: 'company', name: 'Martin SA', email: 'compta@martin.test', tax_identification_number: '73282932000074', vat_number: 'FR44732829320', billing_address: { street_address: '1 rue des Lilas', city: 'Lyon', zip_code: '69001', country_code: 'FR' } },
  { id: 'cl-2', kind: 'individual', first_name: 'Jeanne', last_name: 'Petit', tax_identification_number: 'not-a-siren' },
]

let clientInvoices: unknown[] = []
let supplierInvoices: unknown[] = []

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const calls: string[] = []

function qontoMock(url: string): Response {
  calls.push(url)
  const parsed = new URL(url)
  const path = parsed.pathname.replace(/^\/v2/, '')
  const page = Number(parsed.searchParams.get('page') ?? '1')
  if (path === '/clients') return json({ clients: page === 1 ? CLIENTS : [], meta: { current_page: page, next_page: null } })
  if (path === '/client_invoices') return json({ client_invoices: clientInvoices, meta: { current_page: 1, next_page: null } })
  if (path === '/supplier_invoices') return json({ supplier_invoices: supplierInvoices, meta: { current_page: 1, next_page: null } })
  if (path === '/attachments/att-1') return json({ attachment: { id: 'att-1', file_name: 'F-001.pdf', file_content_type: 'application/pdf', url: 'https://qonto-files.s3.eu-central-1.amazonaws.com/F-001.pdf' } })
  if (path === '/attachments/att-evil') return json({ attachment: { id: 'att-evil', url: 'http://169.254.169.254/latest/meta-data' } })
  return json({ errors: [{ detail: 'not found' }] }, 404)
}

describe.skipIf(!available)('Qonto invoices import (PostgreSQL, mocked Qonto API)', () => {
  let books: Books

  beforeAll(async () => {
    await prepareTestDatabase('qonto_invoices')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    importer = await import('../import-qonto-invoices.service')
    attachment = await import('../read-invoice-attachment.service')
    posting = await import('../post-invoice.service')
    base = (await import('@/lib/integrations/providers/qonto/client-base')).QONTO_SANDBOX_API_URL
  })

  beforeEach(async () => {
    process.env.QONTO_ENVIRONMENT = 'sandbox'
    delete process.env.QONTO_API_URL
    process.env.RATE_LIMIT_DISABLED = 'true'
    calls.length = 0
    clientInvoices = [
      {
        id: 'ci-1',
        number: 'F-001',
        status: 'unpaid',
        issue_date: '2026-03-02',
        due_date: '2026-04-01',
        attachment_id: 'att-1',
        total_amount: eur('366.60'),
        items: [
          { title: 'Conseil', quantity: '2', unit_price: eur('125.00'), vat_rate: '0.2', total_vat: eur('50.00') },
          { title: 'Livre', quantity: '3', unit_price: eur('20.00'), vat_rate: '0.055', total_vat: eur('3.30') },
          { title: 'Frais', quantity: '1', unit_price: eur('3.00'), vat_rate: '0.1', total_vat: eur('0.30') },
        ],
        client: CLIENTS[0],
      },
      { id: 'ci-draft', number: null, status: 'draft', issue_date: '2026-03-03', total_amount: eur('10.00'), items: [], client: CLIENTS[1] },
      { id: 'ci-bad', number: 'F-002', status: 'paid', issue_date: '2026-03-04', total_amount: eur('999.00'), items: [{ title: 'A', quantity: '1', unit_price: eur('1.00'), vat_rate: '0.2' }], client: CLIENTS[1] },
    ]
    supplierInvoices = [
      {
        id: 'si-1',
        supplier_id: 'sup-1',
        supplier_name: 'Papeterie Durand',
        invoice_number: 'D-77',
        status: 'to_pay',
        issue_date: '2026-02-15',
        due_date: null,
        total_amount: eur('132.10'),
        total_amount_excluding_taxes: eur('111.00'),
        total_tax_amount: eur('21.10'),
        taxes: [{ tax_rate: '20', tax_amount: eur('20.00') }, { tax_rate: '10', tax_amount: eur('1.10') }],
        attachment_id: 'att-9',
        supplier_snapshot: { name: 'Papeterie Durand', tin: '303265045', vat_number: 'FR40303265045' },
      },
      { id: 'si-2', supplier_name: 'Rejeté', invoice_number: 'R-1', status: 'rejected', issue_date: '2026-02-01', total_amount: eur('5.00') },
    ]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => qontoMock(url)))
    await prepareTestDatabase('qonto_invoices')
    books = await seedBooks(prisma, svc, { siren: '900000201', slug: 'qonto-alpha' })
    const { encrypt } = await import('@/lib/integrations/encryption')
    await prisma.bankConnection.create({
      data: { companyId: books.companyId, provider: 'QONTO', login: 'qonto-login', secretKeyEncrypted: encrypt('qonto-secret', process.env.ENCRYPTION_KEY!) },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.QONTO_ENVIRONMENT
    delete process.env.RATE_LIMIT_DISABLED
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('calls only the verified read-only endpoints on the configured (sandbox) host', async () => {
    await importer.importQontoInvoices(books.companyId)
    const fetchMock = vi.mocked(fetch)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((url) => url.startsWith(base))).toBe(true)
    expect([...new Set(calls.map((url) => new URL(url).pathname.replace(/^\/v2/, '')))].sort()).toEqual(['/client_invoices', '/clients', '/supplier_invoices'])
    for (const [, init] of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(init.method ?? 'GET').toBe('GET')
      expect((init.headers as Record<string, string>).Authorization).toBe('qonto-login:qonto-secret')
      expect(init.redirect).toBe('error')
    }
  })

  it('maps clients and suppliers to tiers and invoices with their lines, and reports what it left aside', async () => {
    const result = await importer.importQontoInvoices(books.companyId)
    expect(result.tiers.created).toBe(2) // two clients; the supplier matched the existing tiers of the same name
    expect(result.invoices).toEqual({ created: 2, updated: 0, unchanged: 0 })
    expect(result.ignored).toBe(2)
    expect(result.refused).toEqual([{ direction: 'SALE', reference: 'F-002', reason: 'le total des lignes ne correspond pas au total de la facture' }])
    expect(result.complete).toBe(true)

    const martin = await prisma.tiers.findFirstOrThrow({ where: { companyId: books.companyId, qontoId: 'cl-1' }, include: { address: true } })
    expect(martin).toMatchObject({ kind: 'CUSTOMER', name: 'Martin SA', siren: '732829320', siret: '73282932000074', vatNumber: 'FR44732829320', email: 'compta@martin.test' })
    expect(martin.address).toMatchObject({ city: 'Lyon', companyId: books.companyId })
    const jeanne = await prisma.tiers.findFirstOrThrow({ where: { companyId: books.companyId, qontoId: 'cl-2' } })
    expect(jeanne).toMatchObject({ name: 'Jeanne Petit', siren: null })

    const sale = await prisma.invoice.findFirstOrThrow({ where: { companyId: books.companyId, externalId: 'ci-1' }, include: { lines: { orderBy: { position: 'asc' } }, vatBreakdown: true } })
    expect(sale).toMatchObject({ direction: 'SALE', source: 'QONTO', number: 'F-001', externalStatus: 'unpaid', externalAttachmentId: 'att-1', tiersId: martin.id, sellerSiren: '900000201', buyerSiren: '732829320' })
    expect(sale.totalInclTax.toString()).toBe('366.6')
    expect(sale.lines.map((l) => [l.label, l.quantity.toString(), l.unitPrice.toString(), l.vatRateBp])).toEqual([
      ['Conseil', '2', '125', 2000],
      ['Livre', '3', '20', 550],
      ['Frais', '1', '3', 1000],
    ])

    const purchase = await prisma.invoice.findFirstOrThrow({ where: { companyId: books.companyId, externalId: 'si-1' }, include: { tiers: true, vatBreakdown: { orderBy: { vatRateBp: 'desc' } } } })
    expect(purchase.tiers).toMatchObject({ id: books.supplierId, kind: 'SUPPLIER', qontoId: 'sup-1', auxiliaryAccountNumber: 'F00001' })
    expect(purchase.vatBreakdown.map((b) => [b.vatRateBp, b.baseAmount.toString(), b.vatAmount.toString()])).toEqual([
      [2000, '100', '20'],
      [1000, '11', '1.1'],
    ])
    // No due date at Qonto: the company's terms (30 days)
    expect(purchase.dueDate.toISOString().slice(0, 10)).toBe('2026-03-17')
  })

  it('creates a supplier unknown to Kledg with its Qonto identifiers', async () => {
    await prisma.tiers.update({ where: { id: books.supplierId }, data: { name: 'Autre papeterie' } })
    await importer.importQontoInvoices(books.companyId)
    const created = await prisma.tiers.findFirstOrThrow({ where: { companyId: books.companyId, qontoId: 'sup-1' } })
    expect(created).toMatchObject({ kind: 'SUPPLIER', name: 'Papeterie Durand', siren: '303265045', vatNumber: 'FR40303265045', auxiliaryAccountNumber: 'F00002' })
  })

  it('creates nothing twice on a second run, and keeps the amounts of a posted invoice', async () => {
    await importer.importQontoInvoices(books.companyId)
    const again = await importer.importQontoInvoices(books.companyId)
    expect(again.tiers.created).toBe(0)
    expect(again.invoices).toEqual({ created: 0, updated: 2, unchanged: 0 })
    expect(await prisma.invoice.count({ where: { companyId: books.companyId } })).toBe(2)
    expect(await prisma.tiers.count({ where: { companyId: books.companyId } })).toBe(4) // 2 seeded + 2 imported clients

    const sale = await prisma.invoice.findFirstOrThrow({ where: { companyId: books.companyId, externalId: 'ci-1' } })
    await posting.postInvoice(books.companyId, sale.id)
    ;(clientInvoices[0] as { status: string; total_amount: unknown }).status = 'paid'
    const third = await importer.importQontoInvoices(books.companyId)
    expect(third.invoices.unchanged + third.invoices.updated).toBe(2)
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: sale.id }, include: { lines: true } })
    expect(after.externalStatus).toBe('paid')
    expect(after.totalInclTax.toString()).toBe('366.6')
    expect(after.lines).toHaveLength(3)
  })

  it('serves the PDF from the Qonto attachment through the checked download, and refuses a URL outside Qonto file hosts', async () => {
    await importer.importQontoInvoices(books.companyId)
    const sale = await prisma.invoice.findFirstOrThrow({ where: { companyId: books.companyId, externalId: 'ci-1' } })
    const fileFetch = vi.fn(async () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { 'content-length': '4' } }))
    const file = await attachment.readInvoiceAttachment(books.companyId, sale.id, fileFetch as unknown as typeof fetch)
    expect(file).toMatchObject({ contentType: 'application/pdf', fileName: 'F-001.pdf' })
    expect(new Uint8Array(file.body)).toEqual(new Uint8Array([37, 80, 68, 70]))
    expect(fileFetch).toHaveBeenCalledWith('https://qonto-files.s3.eu-central-1.amazonaws.com/F-001.pdf', expect.anything())

    await prisma.invoice.update({ where: { id: sale.id }, data: { externalAttachmentId: 'att-evil' } })
    const evilFetch = vi.fn()
    await expect(attachment.readInvoiceAttachment(books.companyId, sale.id, evilFetch as unknown as typeof fetch)).rejects.toThrow(/pas disponible/)
    expect(evilFetch).not.toHaveBeenCalled()
  })

  it('refuses the PDF of another company or of an invoice entered by hand', async () => {
    await importer.importQontoInvoices(books.companyId)
    const sale = await prisma.invoice.findFirstOrThrow({ where: { companyId: books.companyId, externalId: 'ci-1' } })
    const other = await seedBooks(prisma, svc, { siren: '900000202', slug: 'qonto-beta' })
    await expect(attachment.readInvoiceAttachment(other.companyId, sale.id)).rejects.toThrow(/Facture introuvable/)
    await prisma.invoice.update({ where: { id: sale.id }, data: { source: 'MANUAL' } })
    await expect(attachment.readInvoiceAttachment(books.companyId, sale.id)).rejects.toThrow(/Aucun document/)
  })

  it('answers with a French error when Qonto is not connected', async () => {
    const other = await seedBooks(prisma, svc, { siren: '900000203', slug: 'qonto-gamma' })
    await expect(importer.importQontoInvoices(other.companyId)).rejects.toThrow(/Qonto n'est pas connecté/)
  })
})
