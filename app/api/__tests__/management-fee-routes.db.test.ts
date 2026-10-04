/**
 * Routes of management fees against PostgreSQL, with only the session
 * mocked (roles come from the members of the database): status codes,
 * French messages, input validation, and the cross-company rules: a
 * subsidiary the user cannot reach is refused (404 naming no company), a
 * read-only role in the holding cannot write (403), a read-only role in a
 * subsidiary cannot receive a proposed purchase invoice (403), and the
 * whole flow from the convention to the invoices of a period. The
 * authorization matrix covers every role on every route.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('management_fee_routes')
  return { user: null as { id: string; email: string; name: string; role: string } | null }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Module = Record<string, Handler>

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
const routes = {} as Record<string, Module>

const USERS = {
  group: { id: 'u-group', email: 'group@test.local', name: 'Comptable groupe', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Lecture seule', role: 'user' },
  partial: { id: 'u-partial', email: 'partial@test.local', name: 'Holding seule', role: 'user' },
  outsider: { id: 'u-out', email: 'out@test.local', name: 'Autre société', role: 'user' },
}

async function call(as: keyof typeof USERS, route: string, method: string, path: string, body?: unknown, params: Record<string, string> = {}) {
  state.user = USERS[as]
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  return routes[route][method](request, { params: Promise.resolve(params) })
}

describe.skipIf(!available)('management fee routes (PostgreSQL)', () => {
  let holding: Books
  let sub1: Books
  let sub2: Books

  const conventionBody = (over: Record<string, unknown> = {}) => ({
    companyId: holding.companyId,
    label: 'Convention 2026',
    pricing: 'COST_PLUS',
    markupBp: 800,
    allocationKey: 'CUSTOM',
    revenueAccountCode: '706000',
    startDate: '2026-01-01',
    subsidiaries: [
      { subsidiaryId: sub1.companyId, sharePercentBp: 7000 },
      { subsidiaryId: sub2.companyId, sharePercentBp: 3000 },
    ],
    ...over,
  })

  beforeAll(async () => {
    await prepareTestDatabase('management_fee_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    Object.assign(routes, {
      conventions: await import('@/app/api/management-fees/conventions/route'),
      convention: await import('@/app/api/management-fees/conventions/[id]/route'),
      preview: await import('@/app/api/management-fees/conventions/[id]/preview/route'),
      invoices: await import('@/app/api/management-fees/conventions/[id]/invoices/route'),
      subsidiaries: await import('@/app/api/management-fees/subsidiaries/route'),
    })
  })

  beforeEach(async () => {
    await prepareTestDatabase('management_fee_routes')
    holding = await seedBooks(prisma, svc, { siren: '931000012', slug: 'routes-holding' })
    sub1 = await seedBooks(prisma, svc, { siren: '931000020', slug: 'routes-filiale-1' })
    sub2 = await seedBooks(prisma, svc, { siren: '931000038', slug: 'routes-filiale-2' })
    for (const sub of [sub1, sub2]) {
      await prisma.shareholder.create({ data: { companyId: sub.companyId, type: 'LEGAL', sharePercentage: 100, companyShareholderId: holding.companyId } })
    }
    const charge = await prisma.account.findFirstOrThrow({ where: { companyId: holding.companyId, fiscalYearId: holding.fiscalYearId, code: '6064' } })
    await svc.createEntry({
      companyId: holding.companyId,
      journalId: holding.journals.OD,
      date: '2026-02-10',
      description: 'Fournitures',
      status: 'validated',
      lines: [
        { accountId: charge.id, debit: '1234.56', credit: '0' },
        { accountId: holding.accounts['512000'], debit: '0', credit: '1234.56' },
      ],
    })
    for (const books of [holding, sub1, sub2]) await seedMembership(prisma, USERS.group.id, books.companyId, 'accountant')
    await seedMembership(prisma, USERS.viewer.id, holding.companyId, 'viewer')
    await seedMembership(prisma, USERS.viewer.id, sub1.companyId, 'viewer')
    await seedMembership(prisma, USERS.viewer.id, sub2.companyId, 'viewer')
    await seedMembership(prisma, USERS.partial.id, holding.companyId, 'accountant')
    await seedMembership(prisma, USERS.partial.id, sub1.companyId, 'accountant')
    await seedMembership(prisma, USERS.partial.id, sub2.companyId, 'viewer')
    await seedMembership(prisma, USERS.outsider.id, sub1.companyId, 'companyAdmin')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('creates a convention, previews a period and prepares its invoices', async () => {
    const subsidiaries = await call('group', 'subsidiaries', 'GET', `/api/management-fees/subsidiaries?companyId=${holding.companyId}`)
    expect(subsidiaries.status).toBe(200)
    expect((await subsidiaries.json()).subsidiaries.map((s: { name: string }) => s.name)).toEqual(['routes-filiale-1', 'routes-filiale-2'])

    const created = await call('group', 'conventions', 'POST', '/api/management-fees/conventions', conventionBody())
    expect(created.status).toBe(201)
    const convention = await created.json()
    expect(convention).toMatchObject({ label: 'Convention 2026', markupBp: 800, allocationKey: 'CUSTOM', costAccountPrefixes: ['6'], invoicePrefix: 'FG', vatRateBp: 2000 })
    expect(convention.excludedAccountPrefixes).toContain('695')

    const list = await call('viewer', 'conventions', 'GET', `/api/management-fees/conventions?companyId=routes-holding`)
    expect(list.status).toBe(200)
    expect((await list.json()).map((c: { id: string }) => c.id)).toEqual([convention.id])

    const preview = await call('viewer', 'preview', 'GET', `/api/management-fees/conventions/${convention.id}/preview?periodStart=2026-01-01&periodEnd=2026-03-31`, undefined, {
      id: convention.id,
    })
    expect(preview.status).toBe(200)
    const computed = await preview.json()
    // 1 234,56 x 1,08 = 1 333,3248 -> 1 333,32, split 70/30: 933,32 and 400,00 (the remainder goes to the largest share)
    expect(computed.result).toMatchObject({ costPoolCents: 123_456, totalExclTaxCents: 133_332, markupCents: 9_876 })
    expect(computed.result.parts.map((p: { amountExclTaxCents: number; vatCents: number }) => [p.amountExclTaxCents, p.vatCents])).toEqual([
      [93_333, 18_667],
      [39_999, 8_000],
    ])

    const generated = await call('group', 'invoices', 'POST', `/api/management-fees/conventions/${convention.id}/invoices`, { periodStart: '2026-01-01', periodEnd: '2026-03-31', purchaseDrafts: true }, { id: convention.id })
    expect(generated.status).toBe(201)
    const { billings } = await generated.json()
    expect(billings.map((b: { salesInvoice: { number: string }; amountInclTaxCents: number }) => [b.salesInvoice.number, b.amountInclTaxCents])).toEqual([
      ['FG-2026-001', 112_000],
      ['FG-2026-002', 47_999],
    ])

    const history = await call('viewer', 'invoices', 'GET', `/api/management-fees/conventions/${convention.id}/invoices`, undefined, { id: convention.id })
    expect(history.status).toBe(200)
    expect((await history.json()).billings.map((b: { purchaseInvoice: { posted: boolean } }) => b.purchaseInvoice.posted)).toEqual([false, false])

    const again = await call('group', 'invoices', 'POST', `/api/management-fees/conventions/${convention.id}/invoices`, { periodStart: '2026-01-01', periodEnd: '2026-03-31' }, { id: convention.id })
    expect(again.status).toBe(409)
    const removed = await call('group', 'convention', 'DELETE', `/api/management-fees/conventions/${convention.id}`, undefined, { id: convention.id })
    expect(removed.status).toBe(409)
    expect((await removed.json()).error).toMatch(/déjà été facturée/)
  })

  it('refuses writes to a read-only role of the holding, and every route to a non-member', async () => {
    const created = await call('group', 'conventions', 'POST', '/api/management-fees/conventions', conventionBody())
    const { id } = await created.json()
    const writes = [
      await call('viewer', 'conventions', 'POST', '/api/management-fees/conventions', conventionBody()),
      await call('viewer', 'convention', 'PATCH', `/api/management-fees/conventions/${id}`, conventionBody(), { id }),
      await call('viewer', 'convention', 'DELETE', `/api/management-fees/conventions/${id}`, undefined, { id }),
      await call('viewer', 'invoices', 'POST', `/api/management-fees/conventions/${id}/invoices`, { periodStart: '2026-01-01', periodEnd: '2026-03-31' }, { id }),
    ]
    for (const response of writes) {
      expect(response.status).toBe(403)
      expect((await response.json()).error).toMatch(/Action non autorisée/)
    }
    // A member of a subsidiary only reaches nothing of the holding
    expect((await call('outsider', 'conventions', 'GET', `/api/management-fees/conventions?companyId=${holding.companyId}`)).status).toBe(404)
    expect((await call('outsider', 'convention', 'GET', `/api/management-fees/conventions/${id}`, undefined, { id })).status).toBe(404)
    expect((await call('outsider', 'preview', 'GET', `/api/management-fees/conventions/${id}/preview?periodStart=2026-01-01&periodEnd=2026-03-31`, undefined, { id })).status).toBe(404)
    expect(await prisma.invoice.count({ where: { number: { startsWith: 'FG-' } } })).toBe(0)
  })

  it('refuses a subsidiary the user cannot reach, without naming it', async () => {
    await prisma.member.deleteMany({ where: { userId: USERS.group.id, organization: { companyId: sub2.companyId } } })
    const response = await call('group', 'conventions', 'POST', '/api/management-fees/conventions', conventionBody())
    expect(response.status).toBe(404)
    const { error } = await response.json()
    expect(error).toMatch(/n’est pas accessible avec votre compte/)
    expect(error).not.toContain('routes-filiale-2')
    expect(await prisma.managementFeeConvention.count()).toBe(0)
  })

  it('refuses to propose a purchase invoice to a subsidiary where the role only reads, and allows the holding’s invoices alone', async () => {
    const created = await call('partial', 'conventions', 'POST', '/api/management-fees/conventions', conventionBody())
    expect(created.status).toBe(201)
    const { id } = await created.json()
    const refused = await call('partial', 'invoices', 'POST', `/api/management-fees/conventions/${id}/invoices`, { periodStart: '2026-01-01', periodEnd: '2026-03-31', purchaseDrafts: true }, { id })
    expect(refused.status).toBe(403)
    expect((await refused.json()).error).toMatch(/^routes-filiale-2 : Action non autorisée/)
    expect(await prisma.invoice.count({ where: { number: { startsWith: 'FG-' } } })).toBe(0)

    const alone = await call('partial', 'invoices', 'POST', `/api/management-fees/conventions/${id}/invoices`, { periodStart: '2026-01-01', periodEnd: '2026-03-31', purchaseDrafts: false }, { id })
    expect(alone.status).toBe(201)
    expect(await prisma.invoice.count({ where: { companyId: holding.companyId, number: { startsWith: 'FG-' } } })).toBe(2)
    expect(await prisma.invoice.count({ where: { companyId: { in: [sub1.companyId, sub2.companyId] } } })).toBe(0)
  })

  it('validates the input with French messages', async () => {
    const shares = await call(
      'group',
      'conventions',
      'POST',
      '/api/management-fees/conventions',
      conventionBody({ subsidiaries: [{ subsidiaryId: sub1.companyId, sharePercentBp: 5000 }, { subsidiaryId: sub2.companyId, sharePercentBp: 3000 }] }),
    )
    expect(shares.status).toBe(400)
    expect((await shares.json()).error).toMatch(/totalisent 80 %.*exactement 100 %/)
    const empty = await call('group', 'conventions', 'POST', '/api/management-fees/conventions', conventionBody({ subsidiaries: [] }))
    expect(empty.status).toBe(400)
    expect((await empty.json()).error).toMatch(/Ajoutez au moins une filiale/)
    const vat = await call('group', 'conventions', 'POST', '/api/management-fees/conventions', conventionBody({ vatRateBp: 1900 }))
    expect((await vat.json()).error).toMatch(/19 % n’est pas un taux de TVA français/)

    const created = await call('group', 'conventions', 'POST', '/api/management-fees/conventions', conventionBody())
    const { id } = await created.json()
    const badPeriod = await call('group', 'preview', 'GET', `/api/management-fees/conventions/${id}/preview?periodStart=2026-03-31&periodEnd=2026-01-01`, undefined, { id })
    expect(badPeriod.status).toBe(400)
    expect((await badPeriod.json()).error).toMatch(/ne peut pas précéder/)

    const updated = await call('group', 'convention', 'PATCH', `/api/management-fees/conventions/${id}`, conventionBody({ pricing: 'FIXED', fixedAmountCents: 500_000, allocationKey: 'EQUAL' }), { id })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ pricing: 'FIXED', fixedAmountCents: 500_000, markupBp: 0, subsidiaries: [{ sharePercentBp: null }, { sharePercentBp: null }] })
    const deleted = await call('group', 'convention', 'DELETE', `/api/management-fees/conventions/${id}`, undefined, { id })
    expect(deleted.status).toBe(204)
  })
})
