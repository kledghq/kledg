/**
 * Routes of tiers, invoices, invoice payments, VAT settings and the
 * numbering of sales invoices against
 * PostgreSQL, with only the session mocked: status codes (200, 201, 204,
 * 400, 404, 409), French messages, input validation, totals computed on the
 * server whatever the client sends, and the full flow from a recorded
 * invoice to its posting and payment. Who may call them is the
 * authorization matrix (lib/api/__tests__/authorization-matrix.test.ts).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('invoice_routes')
  process.env.ENCRYPTION_KEY ??= 'b'.repeat(64)
  return { user: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' } as { id: string; email: string; name: string; role: string } | null }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Module = Record<string, Handler>

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
const routes = {} as Record<string, Module>

async function call(route: string, method: string, path: string, body?: unknown, params: Record<string, string> = {}) {
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  return routes[route][method](request, { params: Promise.resolve(params) })
}

const saleBody = (companyId: string, tiersId: string, number = 'V-001') => ({
  companyId,
  direction: 'SALE',
  tiersId,
  number,
  // Numbers chosen by the tests: invoices already issued (Kledg's own series: the numbering tests below)
  numbering: 'recorded',
  issueDate: '2026-03-02',
  lines: [
    { label: 'Conseil', quantity: '2', unitPriceCents: 12500, vatRateBp: 2000, nature: 'GOODS' },
    { label: 'Livre', quantity: '1,5', unitPriceCents: 1999, vatRateBp: 550, nature: 'GOODS' },
  ],
  // Totals sent by a client are ignored: the server computes them
  totalInclTax: 1,
})

describe.skipIf(!available)('invoice routes (PostgreSQL)', () => {
  let books: Books

  beforeAll(async () => {
    await prepareTestDatabase('invoice_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    Object.assign(routes, {
      tiers: await import('@/app/api/tiers/route'),
      tiersOne: await import('@/app/api/tiers/[id]/route'),
      attach: await import('@/app/api/tiers/attach-auxiliary/route'),
      invoices: await import('@/app/api/invoices/route'),
      invoice: await import('@/app/api/invoices/[id]/route'),
      lines: await import('@/app/api/invoices/[id]/lines/route'),
      post: await import('@/app/api/invoices/[id]/post/route'),
      payments: await import('@/app/api/invoices/[id]/payments/route'),
      candidates: await import('@/app/api/invoices/[id]/payments/candidates/route'),
      payment: await import('@/app/api/invoices/[id]/payments/[paymentId]/route'),
      settle: await import('@/app/api/invoices/[id]/settle/route'),
      attachment: await import('@/app/api/invoices/[id]/attachment/route'),
      importQonto: await import('@/app/api/invoices/import-qonto/route'),
      vat: await import('@/app/api/companies/[id]/vat-settings/route'),
      numbering: await import('@/app/api/companies/[id]/invoice-numbering/route'),
      qonto: await import('@/app/api/invoices/[id]/qonto/route'),
    })
  })

  beforeEach(async () => {
    await prepareTestDatabase('invoice_routes')
    await prisma.user.create({ data: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' } })
    books = await seedBooks(prisma, svc, { siren: '930000101', slug: 'routes-factures' })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('creates, searches, reads, updates and deletes tiers', async () => {
    const created = await call('tiers', 'POST', '/api/tiers', { companyId: books.companyId, kind: 'CUSTOMER', name: 'Éole', siren: '732829320' })
    expect(created.status).toBe(201)
    const tiers = await created.json()
    expect(tiers).toMatchObject({ name: 'Éole', auxiliaryAccountNumber: 'C00002', siren: '732829320' })

    const found = await call('tiers', 'GET', `/api/tiers?companyId=${books.companyId}&search=OLE&kind=CUSTOMER`)
    expect((await found.json()).tiers.map((t: { name: string }) => t.name)).toEqual(['Éole'])

    const read = await call('tiersOne', 'GET', `/api/tiers/${tiers.id}`, undefined, { id: tiers.id })
    expect(read.status).toBe(200)
    const updated = await call('tiersOne', 'PATCH', `/api/tiers/${tiers.id}`, { name: 'Éole SAS', paymentTerms: { days: 45, endOfMonth: true } }, { id: tiers.id })
    expect(await updated.json()).toMatchObject({ name: 'Éole SAS', paymentTermsDays: 45, paymentTermsEndOfMonth: true })

    const invalid = await call('tiers', 'POST', '/api/tiers', { companyId: books.companyId, kind: 'CUSTOMER', name: 'X', siren: '123456789' })
    expect(invalid.status).toBe(400)
    expect((await invalid.json()).error).toMatch(/SIREN/)
    const missing = await call('tiers', 'POST', '/api/tiers', { companyId: books.companyId, kind: 'CUSTOMER' })
    expect(missing.status).toBe(400)

    expect((await call('tiersOne', 'DELETE', `/api/tiers/${tiers.id}`, undefined, { id: tiers.id })).status).toBe(204)
    expect((await call('tiersOne', 'GET', `/api/tiers/${tiers.id}`, undefined, { id: tiers.id })).status).toBe(404)
  })

  it('creates the tiers of the auxiliary numbers of the books', async () => {
    await svc.createEntry({
      companyId: books.companyId,
      journalId: books.journals.AC,
      date: '2026-02-01',
      description: 'Facture importée',
      status: 'validated',
      lines: [
        { accountId: books.accounts['6064'], debit: '10', credit: '0' },
        { accountId: books.accounts['401000'], debit: '0', credit: '10', auxiliaryAccountNumber: 'BUREAU', auxiliaryAccountLabel: 'Bureau Vallée' },
      ],
    })
    const response = await call('attach', 'POST', '/api/tiers/attach-auxiliary', { companyId: books.companyId })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ created: 1, alreadyAttached: 0, skipped: [] })
  })

  it('[KLEDG-SEC-015] answers a French 400, never a 500, when an amount would not fit the Decimal(15, 2) columns', async () => {
    const base = saleBody(books.companyId, books.customerId, 'V-HUGE')
    const line = { label: 'Conseil', vatRateBp: 2000, nature: 'GOODS' }
    // One line beyond the column (quantity x unit price), then 200 lines that fit one by one but not in total.
    const oneLine = await call('invoices', 'POST', '/api/invoices', { ...base, lines: [{ ...line, quantity: '999999999', unitPriceCents: 1e13 }] })
    expect(oneLine.status).toBe(400)
    expect((await oneLine.json()).error).toMatch(/Montant trop élevé/)
    const manyLines = await call('invoices', 'POST', '/api/invoices', { ...base, lines: Array.from({ length: 200 }, () => ({ ...line, quantity: '1', unitPriceCents: 1e13 })) })
    expect(manyLines.status).toBe(400)
    expect((await manyLines.json()).error).toMatch(/Montant trop élevé/)
    expect(await prisma.invoice.count({ where: { companyId: books.companyId, number: 'V-HUGE' } })).toBe(0)

    const created = await call('invoices', 'POST', '/api/invoices', saleBody(books.companyId, books.customerId, 'V-EDIT'))
    const invoice = await created.json()
    const patched = await call('invoice', 'PATCH', `/api/invoices/${invoice.id}`, { ...base, number: 'V-EDIT', lines: [{ ...line, quantity: '999999999', unitPriceCents: 1e13 }] }, { id: invoice.id })
    expect(patched.status).toBe(400)
    expect((await patched.json()).error).toMatch(/Montant trop élevé/)
  })

  it('records an invoice with totals computed on the server, posts it, and records its payment', async () => {
    const created = await call('invoices', 'POST', '/api/invoices', saleBody(books.companyId, books.customerId))
    expect(created.status).toBe(201)
    const invoice = await created.json()
    // 250,00 + 29,985 -> 29,99 ; VAT 50,00 + 1,649 -> 1,65
    expect(invoice).toMatchObject({ totalExclTaxCents: 27999, totalVatCents: 5165, totalInclTaxCents: 33164, status: 'draft', dueDate: '2026-04-01' })

    const list = await call('invoices', 'GET', `/api/invoices?companyId=${books.companyId}&direction=SALE&search=V-001`)
    expect(list.status).toBe(200)
    const page = await list.json()
    expect(page.items.map((i: { id: string }) => i.id)).toEqual([invoice.id])
    expect(page.nextCursor).toBeNull()

    const posted = await call('post', 'POST', `/api/invoices/${invoice.id}/post`, undefined, { id: invoice.id })
    expect(posted.status).toBe(201)
    const { entryId } = await posted.json()
    expect((await call('post', 'POST', `/api/invoices/${invoice.id}/post`, undefined, { id: invoice.id })).status).toBe(409)
    expect((await call('invoice', 'DELETE', `/api/invoices/${invoice.id}`, undefined, { id: invoice.id })).status).toBe(409)

    await svc.validateEntries(books.companyId, [entryId])
    const paymentLine = await books.payment('customer', '2026-04-02', '331.64')
    const candidates = await call('candidates', 'GET', `/api/invoices/${invoice.id}/payments/candidates`, undefined, { id: invoice.id })
    expect((await candidates.json()).candidates).toEqual([expect.objectContaining({ entryLineId: paymentLine, exact: true })])

    const recorded = await call('payments', 'POST', `/api/invoices/${invoice.id}/payments`, { entryLineId: paymentLine }, { id: invoice.id })
    expect(recorded.status).toBe(201)
    expect(await recorded.json()).toMatchObject({ lettered: true, letteringCode: 'AA', remainingCents: 0 })

    const detail = await (await call('invoice', 'GET', `/api/invoices/${invoice.id}`, undefined, { id: invoice.id })).json()
    expect(detail).toMatchObject({ status: 'paid', letteringCode: 'AA' })
    const removal = await call('payment', 'DELETE', `/api/invoices/${invoice.id}/payments/${detail.payments[0].id}`, undefined, { id: invoice.id, paymentId: detail.payments[0].id })
    expect(removal.status).toBe(409)
    const settled = await call('settle', 'POST', `/api/invoices/${invoice.id}/settle`, undefined, { id: invoice.id })
    expect(await settled.json()).toMatchObject({ lettered: true, letteringCode: 'AA' })
  })

  it('removes a part payment, unposts a draft entry, edits and deletes a draft invoice', async () => {
    const invoice = await (await call('invoices', 'POST', '/api/invoices', saleBody(books.companyId, books.customerId, 'V-002'))).json()
    await call('post', 'POST', `/api/invoices/${invoice.id}/post`, undefined, { id: invoice.id })
    const paymentLine = await books.payment('customer', '2026-04-02', '100.00')
    const recorded = await (await call('payments', 'POST', `/api/invoices/${invoice.id}/payments`, { entryLineId: paymentLine }, { id: invoice.id })).json()
    expect(recorded).toMatchObject({ paidCents: 10000, lettered: false })
    expect((await call('post', 'DELETE', `/api/invoices/${invoice.id}/post`, undefined, { id: invoice.id })).status).toBe(409)
    const removed = await call('payment', 'DELETE', `/api/invoices/${invoice.id}/payments/${recorded.paymentId}`, undefined, { id: invoice.id, paymentId: recorded.paymentId })
    expect(removed.status).toBe(204)
    const unposted = await call('post', 'DELETE', `/api/invoices/${invoice.id}/post`, undefined, { id: invoice.id })
    expect(unposted.status).toBe(200)

    const { companyId: _companyId, direction: _direction, ...fields } = saleBody(books.companyId, books.customerId, 'V-002')
    const edited = await call('invoice', 'PATCH', `/api/invoices/${invoice.id}`, { ...fields, lines: [{ label: 'Remise à plat', quantity: '1', unitPriceCents: 10000, vatRateBp: 1000 }] }, { id: invoice.id })
    expect(edited.status).toBe(200)
    expect(await edited.json()).toMatchObject({ totalInclTaxCents: 11000 })
    const accounts = await call('lines', 'PATCH', `/api/invoices/${invoice.id}/lines`, { lines: [{ id: (await (await call('invoice', 'GET', `/api/invoices/${invoice.id}`, undefined, { id: invoice.id })).json()).lines[0].id, accountCode: '6064' }] }, { id: invoice.id })
    expect(accounts.status).toBe(400)
    expect((await accounts.json()).error).toMatch(/classe 7/)
    expect((await call('invoice', 'DELETE', `/api/invoices/${invoice.id}`, undefined, { id: invoice.id })).status).toBe(204)
  })

  it('answers 400 for invalid input and a missing fiscal year, 404 for another company', async () => {
    const invalid = await call('invoices', 'POST', '/api/invoices', { ...saleBody(books.companyId, books.customerId), lines: [] })
    expect(invalid.status).toBe(400)
    expect((await invalid.json()).error).toMatch(/au moins une ligne/)
    const badRate = await call('invoices', 'POST', '/api/invoices', { ...saleBody(books.companyId, books.customerId), lines: [{ label: 'A', quantity: '1', unitPriceCents: 100, vatRateBp: 1960 }] })
    expect(badRate.status).toBe(400)

    const old = await (await call('invoices', 'POST', '/api/invoices', { ...saleBody(books.companyId, books.customerId, 'V-OLD'), issueDate: '2024-03-02' })).json()
    const refused = await call('post', 'POST', `/api/invoices/${old.id}/post`, undefined, { id: old.id })
    expect(refused.status).toBe(400)
    expect((await refused.json()).error).toMatch(/Aucun exercice ne contient/)

    const other = await seedBooks(prisma, svc, { siren: '930000102', slug: 'routes-factures-b' })
    const cross = await call('invoices', 'POST', '/api/invoices', saleBody(books.companyId, other.customerId))
    expect(cross.status).toBe(404)
  })

  it('serves no document for an invoice entered by hand, and asks to connect Qonto before an import', async () => {
    const invoice = await (await call('invoices', 'POST', '/api/invoices', saleBody(books.companyId, books.customerId))).json()
    const file = await call('attachment', 'GET', `/api/invoices/${invoice.id}/attachment`, undefined, { id: invoice.id })
    expect(file.status).toBe(404)
    expect((await file.json()).error).toMatch(/Aucun document/)
    const imported = await call('importQonto', 'POST', '/api/invoices/import-qonto', { companyId: books.companyId })
    expect(imported.status).toBe(404)
    expect((await imported.json()).error).toMatch(/Qonto n'est pas connecté/)
  })

  it('reads and changes the option for VAT on debits', async () => {
    const read = await call('vat', 'GET', `/api/companies/${books.companyId}/vat-settings`, undefined, { id: books.companyId })
    expect(await read.json()).toMatchObject({ servicesVatOnDebits: false, isVatExempt: false })
    const changed = await call('vat', 'PUT', `/api/companies/${books.companyId}/vat-settings`, { servicesVatOnDebits: true }, { id: books.companyId })
    expect(await changed.json()).toMatchObject({ servicesVatOnDebits: true, isVatExempt: false })
    expect((await call('vat', 'PUT', `/api/companies/${books.companyId}/vat-settings`, {}, { id: books.companyId })).status).toBe(400)
  })

  it('numbers a sales invoice when posted, and reads and changes the numbering', async () => {
    const { number: _number, numbering: _numbering, ...auto } = saleBody(books.companyId, books.customerId)
    const created = await call('invoices', 'POST', '/api/invoices', auto)
    expect(created.status).toBe(201)
    const draft = await created.json()
    expect(draft).toMatchObject({ number: null, origin: 'AUTO', provisionalNumber: 'F2026-0001' })
    const typed = await call('invoices', 'POST', '/api/invoices', { ...auto, number: 'F2026-0001' })
    expect(typed.status).toBe(400)
    expect((await typed.json()).error).toMatch(/numérotation automatique est active/)
    const posted = await call('post', 'POST', `/api/invoices/${draft.id}/post`, undefined, { id: draft.id })
    expect(posted.status).toBe(201)
    expect((await posted.json()).number).toBe('F2026-0001')

    const read = await call('numbering', 'GET', `/api/companies/${books.companyId}/invoice-numbering`, undefined, { id: books.companyId })
    expect(read.status).toBe(200)
    const view = await read.json()
    expect(view).toMatchObject({ patterns: { invoice: 'F{YYYY}-{SEQ:4}' }, qonto: { connected: false, active: false } })
    const settings = { ...view.settings, prefix: 'FV' }
    const saved = await call('numbering', 'PUT', `/api/companies/${books.companyId}/invoice-numbering`, { settings, nextNumbers: { invoice: 10 } }, { id: books.companyId })
    expect(saved.status).toBe(200)
    expect((await saved.json()).patterns.invoice).toBe('FV{YYYY}-{SEQ:4}')
    const bad = await call('numbering', 'PUT', `/api/companies/${books.companyId}/invoice-numbering`, { settings: { ...settings, year: 'NONE' } }, { id: books.companyId })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toMatch(/ajoutez l’année/)
    const lower = await call('numbering', 'PUT', `/api/companies/${books.companyId}/invoice-numbering`, { settings, nextNumbers: { invoice: 5 } }, { id: books.companyId })
    expect(lower.status).toBe(409)

    // Not waiting for Qonto: nothing to resume
    const resume = await call('qonto', 'POST', `/api/invoices/${draft.id}/qonto`, undefined, { id: draft.id })
    expect(resume.status).toBe(409)
    expect((await resume.json()).error).toBe('Cette facture n’attend pas de réponse de Qonto.')
  })
})
