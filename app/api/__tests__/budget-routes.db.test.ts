/**
 * Routes of budgets against PostgreSQL, with only the session mocked (roles
 * come from the members of the database): status codes, French messages,
 * input validation, the roles (an accountant manages the budget, a
 * read-only member reads it and its comparison but changes nothing), and
 * another company's budget answered as missing. The authorization matrix
 * covers every role on every route.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('budget_routes')
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
  accountant: { id: 'u-acc', email: 'acc@test.local', name: 'Comptable', role: 'user' },
  viewer: { id: 'u-view', email: 'view@test.local', name: 'Lecture', role: 'user' },
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

describe.skipIf(!available)('budget routes (PostgreSQL)', () => {
  let books: Books
  let other: Books

  beforeAll(async () => {
    await prepareTestDatabase('budget_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    Object.assign(routes, {
      budgets: await import('@/app/api/budgets/route'),
      budget: await import('@/app/api/budgets/[id]/route'),
      lines: await import('@/app/api/budgets/[id]/lines/route'),
      report: await import('@/app/api/budgets/[id]/report/route'),
      line: await import('@/app/api/budget-lines/[id]/route'),
    })
  })

  beforeEach(async () => {
    await prepareTestDatabase('budget_routes')
    books = await seedBooks(prisma, svc, { siren: '940000201', slug: 'routes-budget' })
    other = await seedBooks(prisma, svc, { siren: '940000202', slug: 'routes-budget-b' })
    await seedMembership(prisma, USERS.accountant.id, books.companyId, 'accountant')
    await seedMembership(prisma, USERS.viewer.id, books.companyId, 'viewer')
    await seedMembership(prisma, USERS.outsider.id, other.companyId, 'companyAdmin')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('lets an accountant build the budget and a read-only member follow it', async () => {
    const created = await call('accountant', 'budgets', 'POST', '/api/budgets', { companyId: books.companyId, fiscalYearId: books.fiscalYearId })
    expect(created.status).toBe(201)
    const budget = await created.json()
    expect(budget).toMatchObject({ fiscalYear: { year: 2026 }, lines: [], editable: true })

    const line = await call('accountant', 'lines', 'POST', `/api/budgets/${budget.id}/lines`, {
      accountPrefix: '706',
      amounts: [{ month: '2026-01', amountCents: 400_000 }],
      recurringItems: [{ label: 'Maintenance', amountCents: 100_000, frequency: 'MONTHLY', startMonth: '2026-01' }],
    }, { id: budget.id })
    expect(line.status).toBe(201)
    const created706 = await line.json()
    expect(created706).toMatchObject({ accountPrefix: '706', label: 'Prestations de services', annualCents: 400_000 + 12 * 100_000 })

    const patched = await call('accountant', 'line', 'PATCH', `/api/budget-lines/${created706.id}`, { amounts: [] }, { id: created706.id })
    expect(patched.status).toBe(200)
    expect((await patched.json()).annualCents).toBe(1_200_000)

    // Revenue of January
    await svc.createEntry({
      companyId: books.companyId,
      journalId: books.journals.VE,
      date: '2026-01-20',
      description: 'Facture janvier',
      status: 'validated',
      lines: [
        { accountId: books.accounts['411000'], debit: '1500.00', credit: '0' },
        { accountId: books.accounts['706000'], debit: '0', credit: '1500.00' },
      ],
    })

    const list = await call('viewer', 'budgets', 'GET', `/api/budgets?companyId=${books.companyId}`)
    expect(list.status).toBe(200)
    expect((await list.json()).items).toEqual([expect.objectContaining({ id: budget.id, produitsCents: 1_200_000, resultatCents: 1_200_000 })])
    const detail = await call('viewer', 'budget', 'GET', `/api/budgets/${budget.id}`, undefined, { id: budget.id })
    expect((await detail.json()).lines).toHaveLength(1)
    const report = await call('viewer', 'report', 'GET', `/api/budgets/${budget.id}/report?throughMonth=2026-01`, undefined, { id: budget.id })
    expect(report.status).toBe(200)
    expect((await report.json()).produits.lines[0]).toMatchObject({ budgetCents: 100_000, actualCents: 150_000, varianceCents: 50_000, variancePercent: 50, favorable: true, annualBudgetCents: 1_200_000 })

    // A read-only member changes nothing
    expect((await call('viewer', 'lines', 'POST', `/api/budgets/${budget.id}/lines`, { accountPrefix: '6064' }, { id: budget.id })).status).toBe(403)
    expect((await call('viewer', 'line', 'PATCH', `/api/budget-lines/${created706.id}`, { label: 'X' }, { id: created706.id })).status).toBe(403)
    expect((await call('viewer', 'line', 'DELETE', `/api/budget-lines/${created706.id}`, undefined, { id: created706.id })).status).toBe(403)
    expect((await call('viewer', 'budget', 'DELETE', `/api/budgets/${budget.id}`, undefined, { id: budget.id })).status).toBe(403)
    expect((await call('viewer', 'budgets', 'POST', '/api/budgets', { companyId: books.companyId, fiscalYearId: books.fiscalYearId })).status).toBe(403)

    expect((await call('accountant', 'line', 'DELETE', `/api/budget-lines/${created706.id}`, undefined, { id: created706.id })).status).toBe(204)
    expect((await call('accountant', 'budget', 'DELETE', `/api/budgets/${budget.id}`, undefined, { id: budget.id })).status).toBe(204)
    expect(await prisma.budget.count({ where: { companyId: books.companyId } })).toBe(0)
  })

  it('validates the input with French messages', async () => {
    const budget = await (await call('accountant', 'budgets', 'POST', '/api/budgets', { companyId: books.companyId, fiscalYearId: books.fiscalYearId, template: 'posts' })).json()
    expect(budget.lines).toHaveLength(7)

    const again = await call('accountant', 'budgets', 'POST', '/api/budgets', { companyId: books.companyId, fiscalYearId: books.fiscalYearId })
    expect(again.status).toBe(409)
    expect((await again.json()).error).toBe("L'exercice 2026 a déjà un budget.")

    const closed = await call('accountant', 'budgets', 'POST', '/api/budgets', { companyId: books.companyId, fiscalYearId: books.closedFiscalYearId })
    expect(closed.status).toBe(409)

    const bank = await call('accountant', 'lines', 'POST', `/api/budgets/${budget.id}/lines`, { accountPrefix: '512' }, { id: budget.id })
    expect(bank.status).toBe(400)
    expect((await bank.json()).error).toContain('classe 6')

    const euros = await call('accountant', 'lines', 'POST', `/api/budgets/${budget.id}/lines`, { accountPrefix: '6064', amounts: [{ month: '2026-01', amountCents: 12.5 }] }, { id: budget.id })
    expect(euros.status).toBe(400)
    expect((await euros.json()).error).toContain('centimes')

    const badMonth = await call('accountant', 'lines', 'POST', `/api/budgets/${budget.id}/lines`, { accountPrefix: '6064', amounts: [{ month: '2026-13', amountCents: 100 }] }, { id: budget.id })
    expect((await badMonth.json()).error).toContain('Mois invalide')

    const backwards = await call(
      'accountant',
      'lines',
      'POST',
      `/api/budgets/${budget.id}/lines`,
      { accountPrefix: '6064', recurringItems: [{ label: 'Abonnement', amountCents: 100, frequency: 'MONTHLY', startMonth: '2026-06', endMonth: '2026-02' }] },
      { id: budget.id },
    )
    expect((await backwards.json()).error).toContain('Le dernier mois précède le premier')

    const frequency = await call(
      'accountant',
      'lines',
      'POST',
      `/api/budgets/${budget.id}/lines`,
      { accountPrefix: '6064', recurringItems: [{ label: 'Abonnement', amountCents: 100, frequency: 'WEEKLY', startMonth: '2026-06' }] },
      { id: budget.id },
    )
    expect((await frequency.json()).error).toContain('Fréquence inconnue')

    const through = await call('accountant', 'report', 'GET', `/api/budgets/${budget.id}/report?throughMonth=juin`, undefined, { id: budget.id })
    expect(through.status).toBe(400)
  })

  it("answers 404 on another company's budget and lines, and to a company outside one's memberships", async () => {
    const theirs = await (await call('outsider', 'budgets', 'POST', '/api/budgets', { companyId: other.companyId, fiscalYearId: other.fiscalYearId })).json()
    const theirLine = await (await call('outsider', 'lines', 'POST', `/api/budgets/${theirs.id}/lines`, { accountPrefix: '706' }, { id: theirs.id })).json()

    expect((await call('accountant', 'budget', 'GET', `/api/budgets/${theirs.id}`, undefined, { id: theirs.id })).status).toBe(404)
    expect((await call('accountant', 'report', 'GET', `/api/budgets/${theirs.id}/report`, undefined, { id: theirs.id })).status).toBe(404)
    expect((await call('accountant', 'lines', 'POST', `/api/budgets/${theirs.id}/lines`, { accountPrefix: '6064' }, { id: theirs.id })).status).toBe(404)
    expect((await call('accountant', 'line', 'PATCH', `/api/budget-lines/${theirLine.id}`, { label: 'Pris' }, { id: theirLine.id })).status).toBe(404)
    expect((await call('accountant', 'line', 'DELETE', `/api/budget-lines/${theirLine.id}`, undefined, { id: theirLine.id })).status).toBe(404)
    expect((await call('accountant', 'budget', 'DELETE', `/api/budgets/${theirs.id}`, undefined, { id: theirs.id })).status).toBe(404)
    // A fiscal year of another company given in the body of one's own company
    expect((await call('accountant', 'budgets', 'POST', '/api/budgets', { companyId: books.companyId, fiscalYearId: other.fiscalYearId })).status).toBe(404)
    expect((await call('accountant', 'budgets', 'GET', `/api/budgets?companyId=${other.companyId}`)).status).toBe(404)
    expect(await prisma.budgetLine.findUniqueOrThrow({ where: { id: theirLine.id } })).toMatchObject({ label: 'Prestations de services' })
  })
})
