/**
 * Routes of lettering, the third-party reports, the missing receipts and
 * the payment terms against PostgreSQL, with only the session mocked:
 * status codes (201, 200, 400, 404, 409), French messages, input
 * validation and the Excel downloads. Who may call them is the
 * authorization matrix (lib/api/__tests__/authorization-matrix.test.ts).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('third_party_routes')
  return { user: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' } as { id: string; email: string; name: string; role: string } | null }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { bookLedger, type Ledger } from '@/lib/lettering/__tests__/helpers/ledger'

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

describe.skipIf(!available)('third-party routes (PostgreSQL)', () => {
  let ledger: Ledger
  let pair: string[]

  beforeAll(async () => {
    await prepareTestDatabase('third_party_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    Object.assign(routes, {
      lettering: await import('@/app/api/lettering/route'),
      accounts: await import('@/app/api/lettering/accounts/route'),
      suggestions: await import('@/app/api/lettering/suggestions/route'),
      unletter: await import('@/app/api/lettering/unletter/route'),
      auto: await import('@/app/api/lettering/auto/route'),
      aged: await import('@/app/api/reports/aged-balance/route'),
      agedExcel: await import('@/app/api/reports/aged-balance/export-excel/route'),
      auxiliary: await import('@/app/api/reports/auxiliary-balance/route'),
      auxiliaryExcel: await import('@/app/api/reports/auxiliary-balance/export-excel/route'),
      receipts: await import('@/app/api/banking/missing-receipts/route'),
      terms: await import('@/app/api/companies/[id]/payment-terms/route'),
    })
  })

  beforeEach(async () => {
    await prepareTestDatabase('third_party_routes')
    await prisma.user.create({ data: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' } })
    ledger = await bookLedger(prisma, svc, { siren: '930000001', slug: 'routes-tiers' })
    const sale = await ledger.entry('VE', '2026-02-02', 'Facture', [{ code: '411000', debit: '250.00', aux: ['C001', 'Martin SA'] }, { code: '706000', credit: '250.00' }])
    const payment = await ledger.entry('BQ', '2026-03-02', 'Règlement', [{ code: '512000', debit: '250.00' }, { code: '411000', credit: '250.00', aux: ['C001', 'Martin SA'] }])
    pair = [sale.line('411000'), payment.line('411000')]
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('letters with 201, refuses the same lines again with 409 and unletters with 200', async () => {
    const accountId = ledger.accounts['411000']
    const created = await call('lettering', 'POST', '/api/lettering', { companyId: ledger.companyId, accountId, lineIds: pair })
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ code: 'AA', lineIds: pair, amountCents: 25_000 })

    const again = await call('lettering', 'POST', '/api/lettering', { companyId: ledger.companyId, accountId, lineIds: pair })
    expect(again.status).toBe(409)
    expect((await again.json()).error).toMatch(/viennent d'être lettrées \(AA\)/)

    const list = await call('lettering', 'GET', `/api/lettering?companyId=${ledger.companyId}&accountId=${accountId}&status=lettered`)
    expect(list.status).toBe(200)
    expect((await list.json()).lines.map((l: { letteringCode: string }) => l.letteringCode)).toEqual(['AA', 'AA'])

    const removed = await call('unletter', 'POST', '/api/lettering/unletter', { companyId: ledger.companyId, accountId, code: 'AA' })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ code: 'AA', lineCount: 2 })
  })

  it('answers 400 with a French message for an unbalanced selection or an invalid body', async () => {
    const accountId = ledger.accounts['411000']
    const extra = await ledger.entry('VE', '2026-02-10', 'Facture 2', [{ code: '411000', debit: '10.00', aux: ['C001', 'Martin SA'] }, { code: '706000', credit: '10.00' }])
    const unbalanced = await call('lettering', 'POST', '/api/lettering', { companyId: ledger.companyId, accountId, lineIds: [...pair, extra.line('411000')] })
    expect(unbalanced.status).toBe(400)
    expect((await unbalanced.json()).error).toMatch(/écart de 10,00 €/)

    const empty = await call('lettering', 'POST', '/api/lettering', { companyId: ledger.companyId, accountId, lineIds: [] })
    expect(empty.status).toBe(400)
    expect((await empty.json()).error).toMatch(/Sélectionnez les lignes à lettrer/)

    const noAccount = await call('lettering', 'GET', `/api/lettering?companyId=${ledger.companyId}`)
    expect(noAccount.status).toBe(400)

    const badStatus = await call('lettering', 'GET', `/api/lettering?companyId=${ledger.companyId}&accountId=${accountId}&status=x`)
    expect(badStatus.status).toBe(400)

    const unknownAccount = await call('lettering', 'GET', `/api/lettering?companyId=${ledger.companyId}&accountId=nope`)
    expect(unknownAccount.status).toBe(404)

    const bank = await call('suggestions', 'GET', `/api/lettering/suggestions?companyId=${ledger.companyId}&accountId=${ledger.accounts['512000']}`)
    expect(bank.status).toBe(409)
  })

  it('lists accounts and proposals, then applies the proposals', async () => {
    const accounts = await call('accounts', 'GET', `/api/lettering/accounts?companyId=${ledger.companyId}&fiscalYearId=${ledger.fiscalYearId}`)
    expect(accounts.status).toBe(200)
    expect((await accounts.json()).accounts).toMatchObject([{ code: '411000', openCount: 2, openBalanceCents: 0 }])

    const proposals = await call('suggestions', 'GET', `/api/lettering/suggestions?companyId=${ledger.companyId}&accountId=${ledger.accounts['411000']}`)
    expect((await proposals.json()).suggestions).toMatchObject([{ lineIds: pair, reason: 'same-third-party' }])

    const auto = await call('auto', 'POST', '/api/lettering/auto', { companyId: ledger.companyId, accountId: ledger.accounts['411000'] })
    expect(auto.status).toBe(200)
    expect((await auto.json()).message).toBe('1 lettrage effectué\u00a0: AA.')
  })

  it('serves the aged and auxiliary balances as JSON and as Excel downloads', async () => {
    const aged = await call('aged', 'GET', `/api/reports/aged-balance?companyId=${ledger.companyId}&fiscalYearId=${ledger.fiscalYearId}&asOf=2026-02-28`)
    expect(aged.status).toBe(200)
    expect(aged.headers.get('cache-control')).toMatch(/no-store/)
    const report = await aged.json()
    expect(report).toMatchObject({ asOf: '2026-02-28', terms: { days: 30, endOfMonth: false } })
    expect(report.customers.tiers).toMatchObject([{ code: 'C001', buckets: { notDue: 25_000 } }])

    const invalid = await call('aged', 'GET', `/api/reports/aged-balance?companyId=${ledger.companyId}&asOf=31-02-2026`)
    expect(invalid.status).toBe(400)
    const outside = await call('aged', 'GET', `/api/reports/aged-balance?companyId=${ledger.companyId}&fiscalYearId=${ledger.fiscalYearId}&asOf=2025-12-31`)
    expect(outside.status).toBe(400)

    const excel = await call('agedExcel', 'GET', `/api/reports/aged-balance/export-excel?companyId=${ledger.companyId}&fiscalYearId=${ledger.fiscalYearId}&asOf=2026-02-28`)
    expect(excel.status).toBe(200)
    expect(excel.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(excel.headers.get('content-disposition')).toContain('Balance_agee_routes_tiers_2026-02-28.xlsx')

    const auxiliary = await call('auxiliary', 'GET', `/api/reports/auxiliary-balance?companyId=${ledger.companyId}&fiscalYearId=${ledger.fiscalYearId}`)
    expect(auxiliary.status).toBe(200)
    expect((await auxiliary.json()).customers.tiers).toMatchObject([{ code: 'C001', debitCents: 25_000, creditCents: 25_000, closingCents: 0, unletteredCents: 0 }])
    const auxExcel = await call('auxiliaryExcel', 'GET', `/api/reports/auxiliary-balance/export-excel?companyId=${ledger.companyId}&fiscalYearId=${ledger.fiscalYearId}`)
    expect(auxExcel.status).toBe(200)
  })

  it('reads and saves the payment terms within L441-10', async () => {
    const params = { id: ledger.companyId }
    const read = await call('terms', 'GET', `/api/companies/${ledger.companyId}/payment-terms`, undefined, params)
    expect(await read.json()).toEqual({ days: 30, endOfMonth: false })
    const tooLong = await call('terms', 'PUT', `/api/companies/${ledger.companyId}/payment-terms`, { days: 61, endOfMonth: false }, params)
    expect(tooLong.status).toBe(400)
    expect((await tooLong.json()).error).toMatch(/L441-10/)
    const eomTooLong = await call('terms', 'PUT', `/api/companies/${ledger.companyId}/payment-terms`, { days: 50, endOfMonth: true }, params)
    expect(eomTooLong.status).toBe(400)
    const saved = await call('terms', 'PUT', `/api/companies/${ledger.companyId}/payment-terms`, { days: 45, endOfMonth: true }, params)
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ days: 45, endOfMonth: true })
  })

  it('lists missing receipts with its filters validated', async () => {
    const ok = await call('receipts', 'GET', `/api/banking/missing-receipts?companyId=${ledger.companyId}&fiscalYearId=${ledger.fiscalYearId}&minAmount=10&side=debit`)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ count: 0, transactions: [], thresholdCents: 1_000 })
    const bad = await call('receipts', 'GET', `/api/banking/missing-receipts?companyId=${ledger.companyId}&minAmount=abc`)
    expect(bad.status).toBe(400)
    const badSide = await call('receipts', 'GET', `/api/banking/missing-receipts?companyId=${ledger.companyId}&side=out`)
    expect(badSide.status).toBe(400)
  })

  it('answers 401 without a session', async () => {
    state.user = null
    try {
      expect((await call('aged', 'GET', `/api/reports/aged-balance?companyId=${ledger.companyId}`)).status).toBe(401)
      expect((await call('lettering', 'POST', '/api/lettering', { companyId: ledger.companyId, accountId: 'x', lineIds: ['a'] })).status).toBe(401)
    } finally {
      state.user = { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' }
    }
  })
})
