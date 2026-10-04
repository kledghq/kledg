/**
 * Routes of expense reports, claimants and category rules against
 * PostgreSQL, with only the session mocked (roles come from the members of
 * the database): status codes, French messages, input validation, amounts
 * computed on the server whatever the client sends, the roles of the
 * workflow (a member who only submits files their own report, a validator
 * validates), and the full flow from a report to its posting and
 * reimbursement. The authorization matrix covers every role on every route.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('expense_routes')
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
  employee: { id: 'u-emp', email: 'emp@test.local', name: 'Camille Martin', role: 'user' },
  boss: { id: 'u-boss', email: 'boss@test.local', name: 'Comptable', role: 'user' },
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

const line = (over: Record<string, unknown> = {}) => ({
  date: '2026-03-10',
  supplierName: 'Brasserie du Port',
  label: 'Déjeuner client',
  category: 'RECEPTION',
  amountInclTaxCents: 11_000,
  vatRateBp: 1000,
  receiptKind: 'INVOICE',
  ...over,
})

describe.skipIf(!available)('expense report routes (PostgreSQL)', () => {
  let books: Books
  let other: Books

  beforeAll(async () => {
    await prepareTestDatabase('expense_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    Object.assign(routes, {
      reports: await import('@/app/api/expense-reports/route'),
      report: await import('@/app/api/expense-reports/[id]/route'),
      workflow: await import('@/app/api/expense-reports/[id]/workflow/route'),
      post: await import('@/app/api/expense-reports/[id]/post/route'),
      reimbursement: await import('@/app/api/expense-reports/[id]/reimbursement/route'),
      receipts: await import('@/app/api/expense-reports/receipts/route'),
      claimants: await import('@/app/api/expense-claimants/route'),
      claimant: await import('@/app/api/expense-claimants/[id]/route'),
      options: await import('@/app/api/expense-claimants/options/route'),
      rules: await import('@/app/api/expense-category-rules/route'),
      rule: await import('@/app/api/expense-category-rules/[id]/route'),
    })
  })

  beforeEach(async () => {
    await prepareTestDatabase('expense_routes')
    books = await seedBooks(prisma, svc, { siren: '930000201', slug: 'routes-ndf' })
    other = await seedBooks(prisma, svc, { siren: '930000202', slug: 'routes-ndf-b' })
    for (const [code, label] of [['421000', 'Personnel'], ['6257', 'Réceptions'], ['6251', 'Voyages']]) {
      await prisma.account.create({ data: { companyId: books.companyId, fiscalYearId: books.fiscalYearId, code, label } })
    }
    await seedMembership(prisma, USERS.employee.id, books.companyId, 'viewer')
    await seedMembership(prisma, USERS.boss.id, books.companyId, 'accountant')
    await seedMembership(prisma, USERS.outsider.id, other.companyId, 'companyAdmin')
    await prisma.user.update({ where: { id: USERS.employee.id }, data: { name: USERS.employee.name } })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('answers a French 400, never a 500, for an amount beyond the bounds', async () => {
    for (const over of [{ amountInclTaxCents: 1e17 }, { vatCents: 1e17 }]) {
      const response = await call('boss', 'reports', 'POST', '/api/expense-reports', { companyId: books.companyId, periodStart: '2026-03-01', periodEnd: '2026-03-31', lines: [line(over)] })
      expect(response.status).toBe(400)
      expect((await response.json()).error).toMatch(/Montant trop élevé/)
    }
    expect(await prisma.expenseReport.count({ where: { companyId: books.companyId } })).toBe(0)
  })

  it('lets a member who only reads the books file and submit their own report, with amounts computed on the server', async () => {
    const created = await call('employee', 'reports', 'POST', '/api/expense-reports', {
      companyId: books.companyId,
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
      lines: [line(), line({ category: 'TRANSPORT', supplierName: 'SNCF', amountInclTaxCents: 8_800 }), { kind: 'MILEAGE', date: '2026-03-12', label: 'Lyon, Grenoble', vehicleType: 'CAR', fiscalPower: 5, distanceKm: 100 }],
      // Totals sent by a client are ignored
      totalInclTax: 1,
    })
    expect(created.status).toBe(201)
    const report = await created.json()
    expect(report).toMatchObject({ number: 'NDF-0001', status: 'draft', own: true, totalInclTaxCents: 26_160, recoverableVatCents: 1_000, claimant: { name: 'Camille Martin', auxiliaryAccountNumber: 'S00001' } })

    const mine = await call('employee', 'reports', 'GET', `/api/expense-reports?companyId=${books.companyId}&mine=true`)
    expect((await mine.json()).items.map((r: { id: string }) => r.id)).toEqual([report.id])

    const submitted = await call('employee', 'workflow', 'POST', `/api/expense-reports/${report.id}/workflow`, { action: 'submit' }, { id: report.id })
    expect((await submitted.json()).status).toBe('submitted')
    // Validation is for administrators and accountants
    const refused = await call('employee', 'workflow', 'POST', `/api/expense-reports/${report.id}/workflow`, { action: 'validate' }, { id: report.id })
    expect(refused.status).toBe(403)
    expect((await refused.json()).error).toMatch(/Action non autorisée/)
    const edit = await call('employee', 'report', 'PATCH', `/api/expense-reports/${report.id}`, { periodStart: '2026-03-01', periodEnd: '2026-03-31', lines: [line()] }, { id: report.id })
    expect(edit.status).toBe(409)
  })

  it('lets a validator validate, post and reimburse, and refuses invalid input with 400', async () => {
    const created = await (await call('employee', 'reports', 'POST', '/api/expense-reports', { companyId: books.companyId, periodStart: '2026-03-01', periodEnd: '2026-03-31', lines: [line()] })).json()
    const params = { id: created.id }
    await call('employee', 'workflow', 'POST', `/api/expense-reports/${created.id}/workflow`, { action: 'submit' }, params)
    const validated = await call('boss', 'workflow', 'POST', `/api/expense-reports/${created.id}/workflow`, { action: 'validate' }, params)
    expect((await validated.json()).status).toBe('validated')
    const posted = await call('boss', 'post', 'POST', `/api/expense-reports/${created.id}/post`, undefined, params)
    expect(posted.status).toBe(201)
    const { entryId, journal } = await posted.json()
    expect(journal).toBe('OD')
    // The employee cannot post: entries:create
    expect((await call('employee', 'post', 'DELETE', `/api/expense-reports/${created.id}/post`, undefined, params)).status).toBe(403)

    await svc.validateEntries(books.companyId, [entryId])
    const payment = await svc.createEntry({
      companyId: books.companyId,
      journalId: books.journals.BQ,
      date: '2026-04-03',
      description: 'Virement remboursement',
      status: 'validated',
      lines: [
        { accountId: (await prisma.account.findFirstOrThrow({ where: { companyId: books.companyId, code: '421000' } })).id, debit: '110', credit: '0' },
        { accountId: books.accounts['512000'], debit: '0', credit: '110' },
      ],
    })
    const bankAccount = await prisma.bankAccount.findFirstOrThrow({ where: { bankConnection: { companyId: books.companyId } } })
    await prisma.bankTransaction.create({ data: { bankAccountId: bankAccount.id, externalTransactionId: 'remb-1', amount: 110, date: new Date('2026-04-03T00:00:00Z'), side: 'debit', reconciled: true, reconciledWith: payment.id } })
    const candidates = await (await call('boss', 'reimbursement', 'GET', `/api/expense-reports/${created.id}/reimbursement`, undefined, params)).json()
    expect(candidates.candidates).toHaveLength(1)
    expect(candidates.candidates[0]).toMatchObject({ amountCents: 11_000, exact: true })
    expect((await call('employee', 'reimbursement', 'GET', `/api/expense-reports/${created.id}/reimbursement`, undefined, params)).status).toBe(403)
    expect((await call('boss', 'reimbursement', 'POST', `/api/expense-reports/${created.id}/reimbursement`, { entryLineIds: [] }, params)).status).toBe(400)
    const lettered = await call('boss', 'reimbursement', 'POST', `/api/expense-reports/${created.id}/reimbursement`, { entryLineIds: [candidates.candidates[0].entryLineId] }, params)
    expect(lettered.status).toBe(200)
    const detail = await (await call('employee', 'report', 'GET', `/api/expense-reports/${created.id}`, undefined, params)).json()
    expect(detail).toMatchObject({ status: 'reimbursed', letteringCode: 'AA' })

    const invalid = await call('boss', 'reports', 'POST', '/api/expense-reports', { companyId: books.companyId, periodStart: 'hier', periodEnd: '2026-03-31', lines: [line({ amountInclTaxCents: -5 })] })
    expect(invalid.status).toBe(400)
    const unknownAction = await call('boss', 'workflow', 'POST', `/api/expense-reports/${created.id}/workflow`, { action: 'approve' }, params)
    expect(unknownAction.status).toBe(400)
  })

  it('hides another person’s report from a member who only submits, and every report from another company', async () => {
    const boss = await (await call('boss', 'reports', 'POST', '/api/expense-reports', { companyId: books.companyId, periodStart: '2026-03-01', periodEnd: '2026-03-31', lines: [line()] })).json()
    expect((await call('employee', 'report', 'GET', `/api/expense-reports/${boss.id}`, undefined, { id: boss.id })).status).toBe(404)
    expect((await call('employee', 'report', 'DELETE', `/api/expense-reports/${boss.id}`, undefined, { id: boss.id })).status).toBe(404)
    expect((await (await call('employee', 'reports', 'GET', `/api/expense-reports?companyId=${books.companyId}`)).json()).items).toEqual([])
    expect((await (await call('boss', 'reports', 'GET', `/api/expense-reports?companyId=${books.companyId}`)).json()).items).toHaveLength(1)
    for (const [route, method, path] of [
      ['report', 'GET', `/api/expense-reports/${boss.id}`],
      ['report', 'DELETE', `/api/expense-reports/${boss.id}`],
      ['post', 'POST', `/api/expense-reports/${boss.id}/post`],
      ['reimbursement', 'GET', `/api/expense-reports/${boss.id}/reimbursement`],
    ] as const) {
      expect((await call('outsider', route, method, path, undefined, { id: boss.id })).status, `${method} ${path}`).toBe(404)
    }
    expect((await call('outsider', 'reports', 'GET', `/api/expense-reports?companyId=${books.companyId}`)).status).toBe(404)
    // Deleting a draft: its author or a validator
    expect((await call('boss', 'report', 'DELETE', `/api/expense-reports/${boss.id}`, undefined, { id: boss.id })).status).toBe(204)
  })

  it('manages claimants and category rules (validators), lists receipts of the company only', async () => {
    const created = await call('boss', 'claimants', 'POST', '/api/expense-claimants', { companyId: books.companyId, kind: 'ASSOCIE', name: 'Alex Durand', accountCode: '4551' })
    expect(created.status).toBe(201)
    const claimant = await created.json()
    expect(claimant).toMatchObject({ kind: 'ASSOCIE', auxiliaryAccountNumber: 'A00001', accountCode: '4551' })
    expect((await call('boss', 'claimants', 'POST', '/api/expense-claimants', { companyId: books.companyId, kind: 'EMPLOYEE', name: 'X', accountCode: '601' })).status).toBe(400)
    expect((await call('employee', 'claimants', 'POST', '/api/expense-claimants', { companyId: books.companyId, kind: 'EMPLOYEE', name: 'X' })).status).toBe(403)
    const updated = await call('boss', 'claimant', 'PATCH', `/api/expense-claimants/${claimant.id}`, { name: 'Alex Durand-Petit' }, { id: claimant.id })
    expect((await updated.json()).name).toBe('Alex Durand-Petit')
    const options = await (await call('boss', 'options', 'GET', `/api/expense-claimants/options?companyId=${books.companyId}`)).json()
    expect(options.members.map((m: { userId: string }) => m.userId).sort()).toEqual(['u-boss', 'u-emp'])
    expect((await call('employee', 'options', 'GET', `/api/expense-claimants/options?companyId=${books.companyId}`)).status).toBe(403)
    expect((await (await call('employee', 'claimants', 'GET', `/api/expense-claimants?companyId=${books.companyId}`)).json()).claimants).toEqual([])
    expect((await call('boss', 'claimant', 'DELETE', `/api/expense-claimants/${claimant.id}`, undefined, { id: claimant.id })).status).toBe(204)

    const rule = await call('boss', 'rules', 'POST', '/api/expense-category-rules', { companyId: books.companyId, keyword: 'sncf', category: 'TRANSPORT' })
    expect(rule.status).toBe(201)
    const { id: ruleId } = await rule.json()
    expect((await call('boss', 'rules', 'POST', '/api/expense-category-rules', { companyId: books.companyId, keyword: 'x', category: 'NOPE' })).status).toBe(400)
    expect((await (await call('employee', 'rules', 'GET', `/api/expense-category-rules?companyId=${books.companyId}`)).json()).rules).toHaveLength(1)
    expect((await call('employee', 'rule', 'DELETE', `/api/expense-category-rules/${ruleId}`, undefined, { id: ruleId })).status).toBe(403)
    expect((await (await call('boss', 'rule', 'PATCH', `/api/expense-category-rules/${ruleId}`, { priority: 3 }, { id: ruleId })).json()).priority).toBe(3)
    expect((await call('boss', 'rule', 'DELETE', `/api/expense-category-rules/${ruleId}`, undefined, { id: ruleId })).status).toBe(204)

    await prisma.attachment.create({ data: { companyId: books.companyId, fileName: 'ticket-a.pdf' } })
    await prisma.attachment.create({ data: { companyId: other.companyId, fileName: 'ticket-b.pdf' } })
    const receipts = await (await call('employee', 'receipts', 'GET', `/api/expense-reports/receipts?companyId=${books.companyId}`)).json()
    expect(receipts.receipts.map((r: { fileName: string }) => r.fileName)).toEqual(['ticket-a.pdf'])
  })
})
