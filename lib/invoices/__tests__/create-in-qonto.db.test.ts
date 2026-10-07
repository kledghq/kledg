/**
 * Sales invoices created in Qonto first, against PostgreSQL with Qonto's
 * HTTP API mocked (no network, sandbox base URL): the customer becomes a
 * Qonto client, the invoice is created finalized ("unpaid") and keeps
 * Qonto's number and PDF; a lost answer never creates the invoice twice
 * (the retry, or the import, finds it at Qonto); Qonto's refusals become
 * French messages and leave nothing behind; a connection Qonto refuses
 * (403) turns Qonto-first off until the setting is saved again. Endpoints:
 * lib/integrations/providers/qonto/invoicing.ts. Fictitious data.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('qonto_first')
  process.env.ENCRYPTION_KEY ??= 'a'.repeat(64)
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { DEFAULT_NUMBERING } from '../numbering/format'
import { seedBooks, type Books } from './helpers/books'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let qontoFirst: typeof import('../create-in-qonto.service')
let invoices: typeof import('../manage-invoices.service')
let posting: typeof import('../post-invoice.service')
let importer: typeof import('../import-qonto-invoices.service')
let settingsSvc: typeof import('../numbering/manage-numbering-settings.service')

const eur = (value: string) => ({ value, currency: 'EUR' })

interface Call {
  method: string
  path: string
  body: Record<string, unknown> | null
}
const calls: Call[] = []
/** What POST /client_invoices answers; `createdAtQonto` holds what Qonto really created (also on a lost answer). */
let invoiceAnswer: 'created' | 'lost' | 'unprocessable' | 'forbidden' = 'created'
let createdAtQonto: Array<Record<string, unknown>> = []

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function qontoInvoiceFrom(body: Record<string, unknown>, n: number) {
  const draft = body.status === 'draft'
  const items = body.items as Array<{ title: string; quantity: string; unit_price: { value: string }; vat_rate: string }>
  return {
    id: `qi-${n}`,
    // A number on a draft, if Qonto gave one, is ignored by Kledg until the invoice is finalized
    number: draft ? 'BROUILLON' : `QF-${String(n).padStart(3, '0')}`,
    status: draft ? 'draft' : 'unpaid',
    issue_date: body.issue_date,
    due_date: body.due_date,
    created_at: new Date().toISOString(),
    attachment_id: `att-${n}`,
    total_amount: eur('120.00'),
    items: items.map((i) => ({ ...i, unit_price: eur(i.unit_price.value), total_vat: eur('20.00') })),
    client: { id: body.client_id, name: 'Martin SA' },
  }
}

async function qontoMock(url: string, init?: RequestInit): Promise<Response> {
  const parsed = new URL(url)
  const path = parsed.pathname.replace(/^\/v2/, '')
  const method = init?.method ?? 'GET'
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
  calls.push({ method, path: `${path}${parsed.search}`, body })
  if (path === '/organization') return json({ organization: { bank_accounts: [{ iban: 'FR7616958000013622273207472', main: false, status: 'active' }, { iban: 'FR7616798000010000005663951', main: true, status: 'active' }] } })
  if (path === '/clients' && method === 'GET') return json({ clients: [] })
  if (path === '/clients' && method === 'POST') return json({ client: { id: 'qc-1', name: body?.name } })
  if (path === '/client_invoices' && method === 'POST') {
    if (invoiceAnswer === 'unprocessable') return json({ errors: [{ code: 'invalid', detail: 'items[0].title is too long', source: { pointer: '/data/attributes/items' } }] }, 422)
    if (invoiceAnswer === 'forbidden') return json({ errors: [{ code: 'insufficient_permissions' }] }, 403)
    const created = qontoInvoiceFrom(body ?? {}, createdAtQonto.length + 1)
    createdAtQonto.push(created)
    if (invoiceAnswer === 'lost') return json({ errors: [{ detail: 'gateway timeout' }] }, 504)
    return json({ client_invoice: created }, 201)
  }
  if (path === '/client_invoices' && method === 'GET') return json({ client_invoices: createdAtQonto, meta: { next_page: null } })
  const one = /^\/client_invoices\/([^/]+)$/.exec(path)
  if (one) {
    const found = createdAtQonto.find((i) => i.id === one[1])
    if (!found) return json({ errors: [{ detail: 'not found' }] }, 404)
    if (method === 'GET') return json({ client_invoice: found })
    if (method === 'DELETE') {
      if (found.status !== 'draft') return json({ errors: [{ code: 'invoice_not_in_draft_status' }] }, 412)
      createdAtQonto = createdAtQonto.filter((i) => i.id !== found.id)
      return new Response(null, { status: 204 })
    }
  }
  if (path === '/supplier_invoices') return json({ supplier_invoices: [], meta: { next_page: null } })
  return json({ errors: [{ detail: 'not found' }] }, 404)
}

const line = (label: string) => ({ label, quantity: '1', unitPriceCents: 10_000, vatRateBp: 2000, accountCode: '706000', nature: 'SERVICES' as const, fixedAsset: false })

describe.skipIf(!available)('sales invoices created in Qonto first (PostgreSQL, mocked Qonto API)', () => {
  let books: Books
  const sale = (extra: Record<string, unknown> = {}) =>
    qontoFirst.issueInvoice(books.companyId, { direction: 'SALE', tiersId: books.customerId, issueDate: '2026-03-02', dueDate: '2026-04-01', typeCode: '380', lines: [line('Conseil')], ...extra })
  const posts = (path: string) => calls.filter((c) => c.method === 'POST' && c.path === path).length

  beforeAll(async () => {
    await prepareTestDatabase('qonto_first')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    qontoFirst = await import('../create-in-qonto.service')
    invoices = await import('../manage-invoices.service')
    posting = await import('../post-invoice.service')
    importer = await import('../import-qonto-invoices.service')
    settingsSvc = await import('../numbering/manage-numbering-settings.service')
  })

  beforeEach(async () => {
    process.env.QONTO_ENVIRONMENT = 'sandbox'
    delete process.env.QONTO_API_URL
    process.env.RATE_LIMIT_DISABLED = 'true'
    calls.length = 0
    invoiceAnswer = 'created'
    createdAtQonto = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => qontoMock(url, init)))
    await prepareTestDatabase('qonto_first')
    books = await seedBooks(prisma, svc, { siren: '900000401', slug: 'qonto-first' })
    const { bankConnectionContext, encrypt } = await import('@/lib/integrations/encryption')
    await prisma.bankConnection.create({ data: { companyId: books.companyId, provider: 'QONTO', login: 'qonto-login', secretKeyEncrypted: encrypt('qonto-secret', process.env.ENCRYPTION_KEY!, bankConnectionContext(books.companyId, 'QONTO')) } })
    const address = await prisma.address.create({ data: { companyId: books.companyId, street: '1 rue des Lilas', postalCode: '69001', city: 'Lyon', country: 'FR' } })
    await prisma.tiers.update({ where: { id: books.customerId }, data: { addressId: address.id, siren: '732829320' } })
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    await prisma?.$disconnect()
  })

  it('is on by default with a Qonto connection: creates the client and the invoice in Qonto, keeps its number, PDF and amounts, then posts it', async () => {
    expect(await qontoFirst.qontoFirstActive(books.companyId)).toBe(true)
    const invoice = await sale()
    expect(invoice).toMatchObject({ number: 'QF-001', origin: 'QONTO', source: 'QONTO', createdInQonto: true, qontoPending: false, hasAttachment: true, totalInclTaxCents: 12_000 })
    const created = calls.find((c) => c.method === 'POST' && c.path === '/client_invoices')!.body!
    expect(created).toMatchObject({
      client_id: 'qc-1',
      issue_date: '2026-03-02',
      due_date: '2026-04-01',
      currency: 'EUR',
      status: 'unpaid',
      payment_methods: { iban: 'FR7616798000010000005663951' },
      items: [{ title: 'Conseil', quantity: '1', unit_price: { value: '100.00', currency: 'EUR' }, vat_rate: '0.2' }],
    })
    expect(created).not.toHaveProperty('number')
    expect(calls.find((c) => c.method === 'POST' && c.path === '/clients')!.body).toMatchObject({ kind: 'company', name: 'Martin SA', currency: 'EUR', tax_identification_number: '732829320', billing_address: { city: 'Lyon', zip_code: '69001', country_code: 'FR' } })
    expect((await prisma.tiers.findUniqueOrThrow({ where: { id: books.customerId } })).qontoId).toBe('qc-1')

    // Qonto's rules: no edit of the amounts, no deletion; posting uses Qonto's number
    await expect(invoices.updateInvoice(books.companyId, invoice.id, { tiersId: books.customerId, issueDate: '2026-03-02', typeCode: '380', lines: [line('X')] })).rejects.toThrow(/garde les montants/)
    await expect(invoices.deleteInvoice(books.companyId, invoice.id)).rejects.toThrow(/annulez-la dans Qonto/)
    const posted = await posting.postInvoice(books.companyId, invoice.id)
    expect(posted.number).toBe('QF-001')

    // A second invoice of the customer reuses its Qonto client; the import finds both, creates nothing
    await sale()
    expect(posts('/clients')).toBe(1)
    const imported = await importer.importQontoInvoices(books.companyId)
    expect(imported.invoices.created).toBe(0)
    expect(await prisma.invoice.count({ where: { companyId: books.companyId } })).toBe(2)
  })

  it('creates a draft in Qonto on request: no number, not postable, completed by the import once finalized in Qonto', async () => {
    const invoice = await sale({ qontoStatus: 'draft' })
    expect(invoice).toMatchObject({ origin: 'QONTO', number: null, qontoDraft: true, qontoPending: false, createdInQonto: true })
    expect(calls.find((c) => c.method === 'POST' && c.path === '/client_invoices')!.body).toMatchObject({ status: 'draft' })
    await expect(posting.postInvoice(books.companyId, invoice.id)).rejects.toThrow(/brouillon dans Qonto/)
    // Still a draft at Qonto: the import leaves it as it is and creates nothing
    expect((await importer.importQontoInvoices(books.companyId)).invoices).toMatchObject({ created: 0, updated: 0 })
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { number: true } })).toEqual({ number: null })

    // Finalized in Qonto (same id): the import gives it its number, keeps its accounts, and it posts
    Object.assign(createdAtQonto[0], { status: 'unpaid', number: 'QF-001' })
    expect((await importer.importQontoInvoices(books.companyId)).invoices).toMatchObject({ created: 0, updated: 1 })
    const completed = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { number: true, qontoDraft: true, externalId: true, lines: { select: { accountCode: true } } } })
    expect(completed).toEqual({ number: 'QF-001', qontoDraft: false, externalId: 'qi-1', lines: [{ accountCode: '706000' }] })
    expect((await posting.postInvoice(books.companyId, invoice.id)).number).toBe('QF-001')
    expect(await prisma.invoice.count({ where: { companyId: books.companyId } })).toBe(1)
  })

  it('keeps a Qonto draft in step: deleted in Kledg it is deleted in Qonto, deleted in Qonto the import removes it from Kledg', async () => {
    // Deleted in Kledg: Qonto deletes its draft first
    const first = await sale({ qontoStatus: 'draft' })
    await invoices.deleteInvoice(books.companyId, first.id)
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/client_invoices/qi-1')).toBe(true)
    expect(createdAtQonto).toHaveLength(0)
    expect(await prisma.invoice.count({ where: { id: first.id } })).toBe(0)

    // Deleted in Qonto: the next import removes the Kledg copy
    const second = await sale({ qontoStatus: 'draft' })
    createdAtQonto = []
    expect((await importer.importQontoInvoices(books.companyId)).removedDrafts).toBe(1)
    expect(await prisma.invoice.count({ where: { id: second.id } })).toBe(0)

    // Already gone in Qonto when deleted in Kledg: deleted in Kledg too
    const third = await sale({ qontoStatus: 'draft' })
    createdAtQonto = []
    await invoices.deleteInvoice(books.companyId, third.id)
    expect(await prisma.invoice.count({ where: { id: third.id } })).toBe(0)

    // Finalized in Qonto meanwhile: Kledg refuses and keeps its copy
    const fourth = await sale({ qontoStatus: 'draft' })
    createdAtQonto[createdAtQonto.length - 1].status = 'unpaid'
    await expect(invoices.deleteInvoice(books.companyId, fourth.id)).rejects.toThrow(/finalisée dans Qonto/)
    expect(await prisma.invoice.count({ where: { id: fourth.id } })).toBe(1)
  })

  it('refuses a Qonto status for an invoice not created in Qonto', async () => {
    await expect(sale({ qontoStatus: 'draft', numbering: 'kledg' })).rejects.toThrow(/ne vaut que pour une facture créée dans Qonto/)
  })

  it('never creates an invoice twice when Qonto’s answer is lost: the retry finds it at Qonto first', async () => {
    invoiceAnswer = 'lost'
    await expect(sale()).rejects.toThrow(/Qonto n’a pas confirmé la création de la facture/)
    const pending = await prisma.invoice.findFirstOrThrow({ where: { companyId: books.companyId } })
    expect(pending).toMatchObject({ origin: 'QONTO', number: null, externalId: null })
    const view = await invoices.getInvoice(books.companyId, pending.id)
    expect(view.qontoPending).toBe(true)
    await expect(posting.postInvoice(books.companyId, pending.id)).rejects.toThrow(/attend la réponse de Qonto/)
    await expect(invoices.deleteInvoice(books.companyId, pending.id)).rejects.toThrow(/reprenez la création/)
    await expect(qontoFirst.resumeQontoInvoice(books.companyId, pending.id)).rejects.toThrow(/réessayez dans une minute/)

    await prisma.invoice.update({ where: { id: pending.id }, data: { qontoRequestedAt: new Date(Date.now() - 120_000) } })
    invoiceAnswer = 'created'
    const resumed = await qontoFirst.resumeQontoInvoice(books.companyId, pending.id)
    expect(resumed).toMatchObject({ number: 'QF-001', qontoPending: false })
    expect(posts('/client_invoices')).toBe(1)
    expect(createdAtQonto).toHaveLength(1)
    await expect(qontoFirst.resumeQontoInvoice(books.companyId, pending.id)).rejects.toThrow(/n’attend pas de réponse/)
  })

  it('completes a pending invoice from the import instead of importing it twice', async () => {
    invoiceAnswer = 'lost'
    await expect(sale()).rejects.toThrow(/pas confirmé/)
    const result = await importer.importQontoInvoices(books.companyId)
    expect(result.invoices).toMatchObject({ created: 0, updated: 1 })
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { companyId: books.companyId } })
    expect(invoice).toMatchObject({ number: 'QF-001', externalId: 'qi-1', origin: 'QONTO' })
  })

  it('reports Qonto’s refusal in French and leaves nothing behind', async () => {
    invoiceAnswer = 'unprocessable'
    await expect(sale()).rejects.toThrow(/Qonto a refusé la facture \(erreur 422\)/)
    expect(await prisma.invoice.count({ where: { companyId: books.companyId } })).toBe(0)
    // A customer without an address is refused before anything is sent
    await prisma.tiers.update({ where: { id: books.customerId }, data: { addressId: null, qontoId: null } })
    calls.length = 0
    await expect(sale()).rejects.toThrow(/Renseignez l’adresse du client « Martin SA »/)
    expect(posts('/client_invoices')).toBe(0)
    expect(await prisma.invoice.count({ where: { companyId: books.companyId } })).toBe(0)
  })

  it('turns Qonto-first off when Qonto refuses the connection, until the setting is saved again', async () => {
    invoiceAnswer = 'forbidden'
    await expect(sale()).rejects.toThrow(/Qonto refuse la création de factures avec cette connexion/)
    const capability = await qontoFirst.qontoInvoicingCapability(books.companyId)
    expect(capability).toMatchObject({ connected: true, canCreate: false })
    expect(capability.refusal).toMatch(/erreur 403/)
    expect(await qontoFirst.qontoFirstActive(books.companyId)).toBe(false)
    // Kledg numbers the invoices meanwhile
    expect(await sale()).toMatchObject({ origin: 'AUTO', number: null })
    await expect(sale({ numbering: 'qonto' })).rejects.toThrow(/Qonto refuse la création/)
    const view = await settingsSvc.updateInvoiceNumbering(books.companyId, { settings: { ...DEFAULT_NUMBERING } })
    expect(view.qonto).toMatchObject({ refusal: null, active: true })
  })

  it('records an invoice already issued, or a credit note, without sending it to Qonto', async () => {
    const recorded = await sale({ numbering: 'recorded', number: 'ANC-2025-12', issueDate: '2026-02-15' })
    expect(recorded).toMatchObject({ origin: 'RECORDED', number: 'ANC-2025-12' })
    const note = await sale({ typeCode: '381' })
    expect(note).toMatchObject({ origin: 'AUTO', number: null })
    await expect(sale({ typeCode: '381', numbering: 'qonto' })).rejects.toThrow(/création d’avoirs/)
    const off = await sale({ numbering: 'kledg' })
    expect(off.origin).toBe('AUTO')
    expect(posts('/client_invoices')).toBe(0)
  })
})
