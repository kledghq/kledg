/**
 * Entry routes against PostgreSQL (session and roles mocked): a validated
 * entry cannot be edited, deleted or put back to draft through any route
 * (409, PCG art. 1031-3); POST /api/entries/[id]/reverse creates the
 * contre-passation. Skipped without the test database server.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('entry_routes')
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'compta@example.com', name: null, role: null }),
}))
vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return { ...actual, getUserRolesForCompany: vi.fn().mockResolvedValue(['companyAdmin']), isGlobalAdmin: vi.fn().mockReturnValue(false) }
})
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Handler = (request: NextRequest, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
let prisma: typeof import('@/lib/prisma').prisma
let routes: {
  entries: Record<string, Handler>
  entry: Record<string, Handler>
  reverse: Record<string, Handler>
  bulkValidate: Record<string, Handler>
  bulkDelete: Record<string, Handler>
}
const ids = {} as Record<string, string>

function call(handler: Handler, method: string, path: string, body?: unknown, params?: Record<string, string>) {
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  return handler(request, params ? { params: Promise.resolve(params) } : undefined)
}

describe.skipIf(!available)('entry routes: validated entries are definitive', () => {
  beforeAll(async () => {
    await prepareTestDatabase('entry_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    routes = {
      entries: (await import('@/app/api/entries/route')) as unknown as Record<string, Handler>,
      entry: (await import('@/app/api/entries/[id]/route')) as unknown as Record<string, Handler>,
      reverse: (await import('@/app/api/entries/[id]/reverse/route')) as unknown as Record<string, Handler>,
      bulkValidate: (await import('@/app/api/entries/bulk-validate/route')) as unknown as Record<string, Handler>,
      bulkDelete: (await import('@/app/api/entries/bulk-delete/route')) as unknown as Record<string, Handler>,
    }
  })

  beforeEach(async () => {
    await prepareTestDatabase('entry_routes')
    const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
    const fy = await prisma.fiscalYear.create({
      data: { companyId: company.id, year: 2025, startDate: new Date('2025-01-01T00:00:00Z'), endDate: new Date('2025-12-31T00:00:00Z') },
    })
    const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'Opérations diverses' } })
    const bank = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '512000', label: 'Banque' } })
    const sales = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '706000', label: 'Ventes' } })
    Object.assign(ids, { company: company.id, journal: journal.id, bank: bank.id, sales: sales.id })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  const createBody = (status: 'draft' | 'validated') => ({
    companyId: ids.company,
    journalId: ids.journal,
    date: '2025-12-31',
    description: 'Vente',
    status,
    lines: [
      { accountId: ids.bank, debit: '0.1', credit: 0 },
      { accountId: ids.bank, debit: 0.2, credit: 0 },
      { accountId: ids.sales, debit: 0, credit: '0,30' },
    ],
  })

  it('validates through the API and then refuses every change (409)', async () => {
    const created = await call(routes.entries.POST, 'POST', '/api/entries', createBody('draft'))
    expect(created.status).toBe(201)
    const entry = (await created.json()) as { id: string; entryNumber: string; date: string }
    expect(entry.entryNumber).toMatch(/^BR-/)
    expect(entry.date).toBe('2025-12-31T00:00:00.000Z')

    // Drafts stay editable
    const edited = await call(routes.entry.PATCH, 'PATCH', `/api/entries/${entry.id}`, { description: 'Vente comptoir' }, { id: entry.id })
    expect(edited.status).toBe(200)

    const validated = await call(routes.entry.PATCH, 'PATCH', `/api/entries/${entry.id}`, { status: 'validated' }, { id: entry.id })
    expect(validated.status).toBe(200)
    expect(await validated.json()).toMatchObject({ status: 'validated', entryNumber: '1' })

    const refusals = await Promise.all([
      call(routes.entry.PATCH, 'PATCH', `/api/entries/${entry.id}`, { description: 'Changée' }, { id: entry.id }),
      call(routes.entry.PATCH, 'PATCH', `/api/entries/${entry.id}`, { status: 'draft' }, { id: entry.id }),
      call(routes.entry.DELETE, 'DELETE', `/api/entries/${entry.id}`, undefined, { id: entry.id }),
    ])
    for (const response of refusals) {
      expect(response.status).toBe(409)
      expect((await response.json()).error).toContain('contre-passation')
    }
    const bulk = await call(routes.bulkValidate.POST, 'POST', '/api/entries/bulk-validate', { companyId: ids.company, entryIds: [entry.id], status: 'draft' })
    expect(await bulk.json()).toMatchObject({ validated: 0, failed: 1, errors: [{ error: expect.stringContaining('PCG art. 1031-3') }] })
    const bulkDelete = await call(routes.bulkDelete.POST, 'POST', '/api/entries/bulk-delete', { companyId: ids.company, entryIds: [entry.id] })
    expect(await bulkDelete.json()).toMatchObject({ deleted: 0, failed: 1 })

    const stored = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { lines: true } })
    expect(stored).toMatchObject({ status: 'validated', description: 'Vente comptoir', entryNumber: '1' })
    expect(stored.lines.map((l) => l.debit.toString())).toEqual(['0.1', '0.2', '0'])
  })

  it('reverses a validated entry (contre-passation) once', async () => {
    const created = await call(routes.entries.POST, 'POST', '/api/entries', createBody('validated'))
    const entry = (await created.json()) as { id: string }
    const reversal = await call(routes.reverse.POST, 'POST', `/api/entries/${entry.id}/reverse`, { date: '2025-12-31' }, { id: entry.id })
    expect(reversal.status).toBe(201)
    expect(await reversal.json()).toMatchObject({ status: 'validated', entryNumber: '2', reversalOfId: entry.id, reversalOf: { entryNumber: '1' } })
    const again = await call(routes.reverse.POST, 'POST', `/api/entries/${entry.id}/reverse`, {}, { id: entry.id })
    expect(again.status).toBe(409)

    const original = await call(routes.entry.GET, 'GET', `/api/entries/${entry.id}`, undefined, { id: entry.id })
    expect(await original.json()).toMatchObject({ reversedBy: { entryNumber: '2' } })
  })

  it('refuses a draft entry in a closed fiscal year, and a reversal there', async () => {
    const created = await call(routes.entries.POST, 'POST', '/api/entries', createBody('validated'))
    const entry = (await created.json()) as { id: string }
    await prisma.fiscalYear.updateMany({ where: { companyId: ids.company }, data: { isClosed: true } })
    const refused = await call(routes.entries.POST, 'POST', '/api/entries', createBody('draft'))
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toBe("L'exercice 2025 est clôturé : aucune écriture ne peut y être créée.")
    const reversal = await call(routes.reverse.POST, 'POST', `/api/entries/${entry.id}/reverse`, {}, { id: entry.id })
    expect(reversal.status).toBe(409)
  })
})
