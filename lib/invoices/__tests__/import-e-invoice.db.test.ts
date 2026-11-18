/**
 * Import of received e-invoices (POST /api/invoices/import-e-invoice,
 * lib/invoices/import-e-invoice.service.ts) against PostgreSQL, with only
 * the session mocked: a Factur-X PDF becomes a draft purchase invoice with
 * the document's lines and VAT, its supplier found or created, its file
 * kept as received (LPF art. L102 B) and served by the attachment route;
 * the same file or the same supplier number imported again creates
 * nothing; an invoice addressed to another company, or issued by the
 * company itself, is refused; the preview writes nothing; deleting the
 * draft deletes its file, and the cleanup of receipt files never touches
 * the file of a living invoice. Fictitious data.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('e_invoice_import')
  process.env.ENCRYPTION_KEY ??= 'b'.repeat(64)
  return { user: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))
// The files go to the database (postgres driver), whatever the environment running the tests.
vi.mock('@/lib/storage', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/storage')>()), configuredStorageDriver: () => 'postgres' }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'
import { BUYER, SELLER, ciiXml, facturXPdf, sampleInvoice, ublXml } from '@/lib/invoices/e-invoice/__tests__/fixtures'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let importRoute: { POST: Handler }
let attachmentRoute: { GET: Handler }
let invoiceRoute: { DELETE: Handler }
let store: typeof import('@/lib/receipts/receipt-file-store')

function upload(companyId: string, content: Uint8Array | string, fileName: string, mode?: 'preview') {
  const form = new FormData()
  form.set('companyId', companyId)
  form.set('file', new File([typeof content === 'string' ? content : Buffer.from(content)], fileName))
  if (mode) form.set('mode', mode)
  return importRoute.POST(new NextRequest('http://localhost/api/invoices/import-e-invoice', { method: 'POST', body: form }))
}

describe.skipIf(!available)('e-invoice import (PostgreSQL)', () => {
  let books: Books

  beforeAll(async () => {
    await prepareTestDatabase('e_invoice_import')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    importRoute = (await import('@/app/api/invoices/import-e-invoice/route')) as unknown as { POST: Handler }
    attachmentRoute = (await import('@/app/api/invoices/[id]/attachment/route')) as unknown as { GET: Handler }
    invoiceRoute = (await import('@/app/api/invoices/[id]/route')) as unknown as { DELETE: Handler }
    store = await import('@/lib/receipts/receipt-file-store')
  })

  beforeEach(async () => {
    await prepareTestDatabase('e_invoice_import')
    await prisma.user.create({ data: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' } })
    // The buyer of the fixtures: the company importing the invoices
    books = await seedBooks(prisma, svc, { siren: BUYER.siren, slug: 'factures-electroniques' })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('records a Factur-X PDF as a draft purchase invoice with the document’s amounts, creates its supplier and keeps the file', async () => {
    const pdf = facturXPdf(ciiXml())
    const response = await upload(books.companyId, pdf, 'F2026-0042.pdf')
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({
      created: true,
      supplierCreated: true,
      format: 'factur-x',
      number: 'F2026-0042',
      totalExclTaxCents: 25000,
      totalVatCents: 4275,
      totalInclTaxCents: 29275,
      alreadyImported: null,
      warnings: [],
    })

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: result.invoiceId },
      include: { lines: { orderBy: { position: 'asc' } }, vatBreakdown: { orderBy: { vatRateBp: 'desc' } }, tiers: { include: { address: true } }, documentFile: true },
    })
    expect(invoice).toMatchObject({
      companyId: books.companyId,
      direction: 'PURCHASE',
      source: 'E_INVOICE',
      origin: 'MANUAL',
      typeCode: '380',
      number: 'F2026-0042',
      entryId: null,
      sellerSiren: SELLER.siren,
      sellerVatNumber: SELLER.vat,
      buyerSiren: BUYER.siren,
      attachmentFileName: 'F2026-0042.pdf',
    })
    expect(invoice.issueDate.toISOString().slice(0, 10)).toBe('2026-03-02')
    expect(invoice.dueDate.toISOString().slice(0, 10)).toBe('2026-04-01')
    expect(invoice.totalInclTax.toString()).toBe('292.75')
    expect(invoice.lines.map((l) => [l.label, l.quantity.toString(), l.unitPrice.toString(), l.vatRateBp, l.totalExclTax.toString()])).toEqual([
      ['Ramettes de papier A4', '2', '100', 2000, '200'],
      ['Livre de comptabilité', '1', '50', 550, '50'],
    ])
    expect(invoice.vatBreakdown.map((b) => [b.vatRateBp, b.baseAmount.toString(), b.vatAmount.toString()])).toEqual([
      [2000, '200', '40'],
      [550, '50', '2.75'],
    ])
    expect(invoice.tiers).toMatchObject({ kind: 'SUPPLIER', name: SELLER.name, siren: SELLER.siren, siret: SELLER.siret, vatNumber: SELLER.vat, address: { city: 'Paris', postalCode: '75011' } })
    expect(invoice.documentFile).toMatchObject({ contentType: 'application/pdf', size: pdf.length, storageDriver: 'postgres' })

    // The original, as received, from the attachment route
    const file = await attachmentRoute.GET(new NextRequest(`http://localhost/api/invoices/${invoice.id}/attachment`), { params: Promise.resolve({ id: invoice.id }) })
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toContain('application/pdf')
    expect(Buffer.from(await file.arrayBuffer()).equals(Buffer.from(pdf))).toBe(true)
  })

  it('creates nothing the second time: same file, or the same invoice in another syntax', async () => {
    const pdf = facturXPdf(ciiXml())
    const first = await (await upload(books.companyId, pdf, 'facture.pdf')).json()
    const again = await (await upload(books.companyId, pdf, 'facture.pdf')).json()
    const asUbl = await (await upload(books.companyId, ublXml(), 'facture.xml')).json()
    expect(again).toMatchObject({ created: false, invoiceId: first.invoiceId, alreadyImported: { invoiceId: first.invoiceId } })
    expect(asUbl).toMatchObject({ created: false, invoiceId: first.invoiceId })
    expect(await prisma.invoice.count({ where: { companyId: books.companyId, source: 'E_INVOICE' } })).toBe(1)
    expect(await prisma.receiptFile.count({ where: { companyId: books.companyId } })).toBe(1)
    expect(await prisma.tiers.count({ where: { companyId: books.companyId, siren: SELLER.siren } })).toBe(1)
  })

  it('finds a known supplier by its SIREN and takes its default account for the lines', async () => {
    await prisma.tiers.update({ where: { id: books.supplierId }, data: { siren: SELLER.siren } })
    const result = await (await upload(books.companyId, ublXml(), 'facture.xml')).json()
    expect(result).toMatchObject({ created: true, supplierCreated: false, supplier: { tiersId: books.supplierId, auxiliaryAccountNumber: 'F00001' } })
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: result.invoiceId }, include: { lines: true, documentFile: true } })
    expect(invoice.tiersId).toBe(books.supplierId)
    expect(invoice.lines.map((l) => l.accountCode)).toEqual(['6064', '6064'])
    expect(invoice.documentFile?.contentType).toBe('application/xml')
  })

  it('refuses an invoice addressed to another company, and one the company issued itself', async () => {
    const other = await upload(books.companyId, ciiXml(sampleInvoice({ buyer: { name: 'Autre SA', siren: '930000112', vat: null } })), 'autre.xml')
    expect(other.status).toBe(400)
    expect((await other.json()).error).toMatch(/adressée à une autre société \(Autre SA, SIREN 930000112\)/)
    const own = await upload(books.companyId, ciiXml(sampleInvoice({ seller: { name: 'Nous', siren: BUYER.siren, vat: null }, buyer: { name: SELLER.name, siren: SELLER.siren, vat: null } })), 'vente.xml')
    expect(own.status).toBe(400)
    expect((await own.json()).error).toMatch(/émise par votre société/)
    expect(await prisma.invoice.count({ where: { companyId: books.companyId } })).toBe(0)
  })

  it('answers a French 400 with the reason for a file that is not a usable e-invoice', async () => {
    const response = await upload(books.companyId, ciiXml(sampleInvoice({ grandTotal: '1.00' })), 'faux.xml')
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/^Facture électronique non importée.*BR-CO-15/)
    const noFile = new FormData()
    noFile.set('companyId', books.companyId)
    const missing = await importRoute.POST(new NextRequest('http://localhost/api/invoices/import-e-invoice', { method: 'POST', body: noFile }))
    expect(missing.status).toBe(400)
    expect((await missing.json()).error).toBe('Aucun fichier reçu.')
    // Kept with the receipts, whose storage takes 5 MB at most
    const huge = await upload(books.companyId, new Uint8Array(5 * 1024 * 1024 + 1), 'enorme.pdf')
    expect(huge.status).toBe(400)
    expect((await huge.json()).error).toMatch(/dépasse 5 Mo/)
  })

  it('previews without writing anything', async () => {
    const response = await upload(books.companyId, facturXPdf(ciiXml()), 'facture.pdf', 'preview')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ number: 'F2026-0042', supplier: { name: SELLER.name, tiersId: null }, alreadyImported: null })
    expect(await prisma.invoice.count()).toBe(0)
    expect(await prisma.receiptFile.count()).toBe(0)
  })

  it('keeps the file while the invoice lives, and deletes it with the draft', async () => {
    const { invoiceId } = await (await upload(books.companyId, facturXPdf(ciiXml()), 'facture.pdf')).json()
    // The cleanup of receipts (staging, filing) never deletes the file of an invoice
    expect(await store.deleteUnreferencedReceiptFiles(books.companyId)).toBe(0)
    expect(await prisma.receiptFile.count()).toBe(1)
    const deleted = await invoiceRoute.DELETE(new NextRequest(`http://localhost/api/invoices/${invoiceId}`, { method: 'DELETE' }), { params: Promise.resolve({ id: invoiceId }) })
    expect(deleted.status).toBe(204)
    expect(await prisma.receiptFile.count()).toBe(0)
  })
})
