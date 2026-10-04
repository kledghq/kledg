/**
 * Routes of detected subscriptions against PostgreSQL, with only the
 * session mocked (roles come from the members of the database): status
 * codes, French messages, input validation, the roles (an accountant
 * decides and adds to the budget, a read-only member only reads), and
 * another company's subscriptions and budget lines answered as missing. The
 * authorization matrix covers every role on every route. Payments are dated
 * in the months before today, as the routes detect as of today.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('subscription_routes')
  return { user: null as { id: string; email: string; name: string; role: string } | null }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'
import { todayUtc, toIsoDateUtc } from '@/lib/utils/date'
import { addCalendarMonths } from '@/lib/subscriptions/detect'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Module = Record<string, Handler>

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let budgets: typeof import('@/lib/budgets/manage-budgets.service')
const routes = {} as Record<string, Module>

const USERS = {
  accountant: { id: 'u-acc', email: 'acc@test.local', name: 'Comptable', role: 'user' },
  viewer: { id: 'u-view', email: 'view@test.local', name: 'Lecture', role: 'user' },
  outsider: { id: 'u-out', email: 'out@test.local', name: 'Autre société', role: 'user' },
}

async function call(as: keyof typeof USERS, route: string, method: string, path: string, body?: unknown) {
  state.user = USERS[as]
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  return routes[route][method](request, { params: Promise.resolve({}) })
}

/** The 10th of the five months before the current one. */
function recentMonths(): string[] {
  const firstOfMonth = `${toIsoDateUtc(todayUtc()).slice(0, 7)}-10`
  return [-5, -4, -3, -2, -1].map((n) => addCalendarMonths(firstOfMonth, n))
}

describe.skipIf(!available)('subscription routes (PostgreSQL)', () => {
  let books: Books
  let other: Books
  let seq = 0

  beforeAll(async () => {
    await prepareTestDatabase('subscription_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    budgets = await import('@/lib/budgets/manage-budgets.service')
    Object.assign(routes, {
      list: await import('@/app/api/subscriptions/route'),
      decision: await import('@/app/api/subscriptions/decision/route'),
      budgetItem: await import('@/app/api/subscriptions/budget-item/route'),
    })
  })

  async function subscription(companyId: string, counterpartyName: string, amount: number) {
    const account = await prisma.bankAccount.findFirstOrThrow({ where: { bankConnection: { companyId } } })
    const ids: string[] = []
    for (const day of recentMonths()) {
      seq += 1
      const row = await prisma.bankTransaction.create({
        data: { bankAccountId: account.id, externalTransactionId: `route-${seq}`, date: new Date(`${day}T00:00:00Z`), amount, side: 'debit', label: `CB ${counterpartyName}`, counterpartyName },
      })
      ids.push(row.id)
    }
    return ids
  }

  beforeEach(async () => {
    await prepareTestDatabase('subscription_routes')
    books = await seedBooks(prisma, svc, { siren: '940000401', slug: 'routes-subscriptions' })
    other = await seedBooks(prisma, svc, { siren: '940000402', slug: 'routes-subscriptions-b' })
    await seedMembership(prisma, USERS.accountant.id, books.companyId, 'accountant')
    await seedMembership(prisma, USERS.viewer.id, books.companyId, 'viewer')
    await seedMembership(prisma, USERS.outsider.id, other.companyId, 'companyAdmin')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('lets a read-only member list the subscriptions and an accountant decide on them', async () => {
    const [first] = await subscription(books.companyId, 'Logiciel Paie', 59)

    const list = await call('viewer', 'list', 'GET', `/api/subscriptions?companyId=${books.companyId}`)
    expect(list.status).toBe(200)
    expect(list.headers.get('cache-control')).toContain('no-store')
    const body = await list.json()
    expect(body.items).toEqual([expect.objectContaining({ id: first, name: 'Logiciel Paie', cadence: 'monthly', typicalAmountCents: 5_900, annualizedCents: 70_800, decision: null })])
    expect(body.totals).toEqual({ activeCount: 1, activeAnnualizedCents: 70_800 })

    // The viewer changes nothing
    const refused = await call('viewer', 'decision', 'PUT', '/api/subscriptions/decision', { companyId: books.companyId, subscriptionId: first, status: 'ignored' })
    expect(refused.status).toBe(403)

    const ignored = await call('accountant', 'decision', 'PUT', '/api/subscriptions/decision', { companyId: books.companyId, subscriptionId: first, status: 'ignored' })
    expect(ignored.status).toBe(200)
    expect((await ignored.json()).decision).toMatchObject({ status: 'ignored', budgetLine: null })
    const after = await (await call('viewer', 'list', 'GET', `/api/subscriptions?companyId=${books.companyId}`)).json()
    expect(after.totals).toEqual({ activeCount: 0, activeAnnualizedCents: 0 })

    const pending = await call('accountant', 'decision', 'PUT', '/api/subscriptions/decision', { companyId: books.companyId, subscriptionId: first, status: 'pending' })
    expect((await pending.json()).decision).toBeNull()
    expect(await prisma.subscriptionDecision.count()).toBe(0)
  })

  it('adds a subscription to the budget for an accountant, never for a read-only member', async () => {
    const [first] = await subscription(books.companyId, 'Logiciel Paie', 59)
    const budget = await budgets.createBudget(books.companyId, { fiscalYearId: books.fiscalYearId, template: 'posts' })
    const line62 = budget.lines.find((l) => l.accountPrefix === '62')!
    const body = { companyId: books.companyId, subscriptionId: first, budgetLineId: line62.id, label: 'Paie', startMonth: '2026-01' }

    expect((await call('viewer', 'budgetItem', 'POST', '/api/subscriptions/budget-item', body)).status).toBe(403)
    const added = await call('accountant', 'budgetItem', 'POST', '/api/subscriptions/budget-item', body)
    expect(added.status).toBe(201)
    expect((await added.json()).decision).toMatchObject({ status: 'confirmed', budgetLine: { id: line62.id, accountPrefix: '62', fiscalYear: 2026 } })
    const items = await prisma.budgetRecurringItem.findMany({ where: { lineId: line62.id } })
    expect(items.map((i) => [i.label, i.amount.toString(), i.frequency, i.startMonth])).toEqual([['Paie', '59', 'MONTHLY', '2026-01']])

    const twice = await call('accountant', 'budgetItem', 'POST', '/api/subscriptions/budget-item', body)
    expect(twice.status).toBe(409)
    expect((await twice.json()).error).toBe('La ligne 62 a déjà l\'élément récurrent « Paie ».')
  })

  it('validates the input with French messages', async () => {
    const missing = await call('accountant', 'decision', 'PUT', '/api/subscriptions/decision', { companyId: books.companyId, status: 'confirmed' })
    expect(missing.status).toBe(400)
    expect((await missing.json()).error).toContain("L'abonnement est requis")

    const unknownStatus = await call('accountant', 'decision', 'PUT', '/api/subscriptions/decision', { companyId: books.companyId, subscriptionId: 'x', status: 'maybe' })
    expect((await unknownStatus.json()).error).toContain('Décision inconnue')

    const badMonth = await call('accountant', 'budgetItem', 'POST', '/api/subscriptions/budget-item', { companyId: books.companyId, subscriptionId: 'x', budgetLineId: 'y', startMonth: '2026-13' })
    expect(badMonth.status).toBe(400)
    expect((await badMonth.json()).error).toContain('Mois invalide')

    const gone = await call('accountant', 'decision', 'PUT', '/api/subscriptions/decision', { companyId: books.companyId, subscriptionId: 'not-a-subscription', status: 'confirmed' })
    expect(gone.status).toBe(404)
    expect((await gone.json()).error).toContain('Abonnement introuvable')
  })

  it("answers 404 on another company's subscriptions and budget lines", async () => {
    const [theirs] = await subscription(other.companyId, 'Logiciel Paie', 59)
    const [ours] = await subscription(books.companyId, 'Hebergement', 25)
    const theirBudget = await budgets.createBudget(other.companyId, { fiscalYearId: other.fiscalYearId, template: 'posts' })
    const theirLine = theirBudget.lines.find((l) => l.accountPrefix === '62')!

    expect((await call('accountant', 'list', 'GET', `/api/subscriptions?companyId=${other.companyId}`)).status).toBe(404)
    // Their subscription id given with one's own company
    expect((await call('accountant', 'decision', 'PUT', '/api/subscriptions/decision', { companyId: books.companyId, subscriptionId: theirs, status: 'ignored' })).status).toBe(404)
    expect((await call('accountant', 'decision', 'PUT', '/api/subscriptions/decision', { companyId: other.companyId, subscriptionId: theirs, status: 'ignored' })).status).toBe(404)
    // Their budget line with one's own subscription
    const foreignLine = await call('accountant', 'budgetItem', 'POST', '/api/subscriptions/budget-item', { companyId: books.companyId, subscriptionId: ours, budgetLineId: theirLine.id, startMonth: '2026-01' })
    expect(foreignLine.status).toBe(404)
    expect(await prisma.budgetRecurringItem.count()).toBe(0)
    expect(await prisma.subscriptionDecision.count()).toBe(0)
  })
})
