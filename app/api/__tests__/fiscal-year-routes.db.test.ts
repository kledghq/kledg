/**
 * Fiscal year routes against PostgreSQL (session and roles mocked): create,
 * read, change dates and delete, closing and its simulation (blocking
 * reasons in `details`), depreciation generation and result allocation
 * inputs. Skipped without the test database server.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const member = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('fiscal_year_routes')
  return { companyId: '' }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'compta@example.com', name: null, role: null }),
}))
vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return {
    ...actual,
    getUserRolesForCompany: vi.fn(async (_userId: string, companyId: string) => (companyId === member.companyId ? ['accountant'] : [])),
    isGlobalAdmin: vi.fn().mockReturnValue(false),
  }
})
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Handler = (request: NextRequest, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Routes = Record<string, Handler>
let prisma: typeof import('@/lib/prisma').prisma
const r = {} as Record<'fiscalYears' | 'fiscalYear' | 'close' | 'simulate' | 'depreciation' | 'allocation', Routes>
const ids = {} as Record<string, string>

function call(handler: Handler, method: string, path: string, body?: unknown, params?: Record<string, string>) {
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  return handler(request, params ? { params: Promise.resolve(params) } : undefined)
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown> & { error?: string }
}

const base = () => `/api/companies/${ids.company}/fiscal-years`
const yearParams = (fiscalYearId: string) => ({ id: ids.company, fiscalYearId })

describe.skipIf(!available)('fiscal year routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('fiscal_year_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    Object.assign(r, {
      fiscalYears: await import('@/app/api/companies/[id]/fiscal-years/route'),
      fiscalYear: await import('@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/route'),
      close: await import('@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/close/route'),
      simulate: await import('@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/close/simulate/route'),
      depreciation: await import('@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/depreciation/route'),
      allocation: await import('@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/result-allocation/route'),
    })
  })

  beforeEach(async () => {
    await prepareTestDatabase('fiscal_year_routes')
    const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789', closingDay: 30, closingMonth: 6 } })
    const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '987654321' } })
    member.companyId = company.id
    const fy = await prisma.fiscalYear.create({
      data: { companyId: company.id, year: 2025, startDate: new Date('2024-07-01T00:00:00Z'), endDate: new Date('2025-06-30T00:00:00Z') },
    })
    const otherFy = await prisma.fiscalYear.create({
      data: { companyId: other.id, year: 2025, startDate: new Date('2025-01-01T00:00:00Z'), endDate: new Date('2025-12-31T00:00:00Z') },
    })
    Object.assign(ids, { company: company.id, other: other.id, fy: fy.id, otherFy: otherFy.id })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('creates a fiscal year with its PCG chart and the closing day of the company', async () => {
    const response = await call(r.fiscalYears.POST, 'POST', base(), { year: 2026, startDate: '2025-07-01', endDate: '2026-06-30' }, { id: ids.company })
    expect(response.status).toBe(201)
    const created = await json(response)
    expect(created).toMatchObject({
      year: 2026,
      closingDay: 30,
      closingMonth: 6,
      startDate: '2025-07-01T00:00:00.000Z',
      endDate: '2026-06-30T00:00:00.000Z',
      isClosed: false,
    })
    expect(await prisma.account.count({ where: { fiscalYearId: created.id as string, isPCG: true } })).toBeGreaterThan(100)

    const list = (await (await call(r.fiscalYears.GET, 'GET', base(), undefined, { id: ids.company })).json()) as Array<{ year: number }>
    expect(list.map((y) => y.year)).toEqual([2026, 2025])
  }, 60_000)

  it('refuses a duplicate year (409), bad dates and a missing year (400)', async () => {
    const post = (body: unknown) => call(r.fiscalYears.POST, 'POST', base(), body, { id: ids.company })
    const duplicate = await post({ year: 2025, startDate: '2024-07-01', endDate: '2025-06-30' })
    expect(duplicate.status).toBe(409)
    expect((await json(duplicate)).error).toBe("Un exercice pour l'année 2025 existe déjà")

    expect((await json(await post({ startDate: '2025-07-01', endDate: '2026-06-30' }))).error).toBe("year: L'année est requise")
    expect((await json(await post({ year: 2026, startDate: '2025-07-01' }))).error).toBe('endDate: La date de fin est requise')
    expect((await json(await post({ year: 2026, startDate: '01/07/2025', endDate: '2026-06-30' }))).error).toBe(
      'Date de début invalide : utilisez le format AAAA-MM-JJ.',
    )
    expect((await json(await post({ year: 2026, startDate: '2026-06-30', endDate: '2025-07-01' }))).error).toBe(
      'La date de début doit précéder la date de fin.',
    )
    expect(await prisma.fiscalYear.count({ where: { companyId: ids.company } })).toBe(1)
  })

  it('reads a fiscal year of the company only', async () => {
    const got = await call(r.fiscalYear.GET, 'GET', `${base()}/${ids.fy}`, undefined, yearParams(ids.fy))
    expect(await json(got)).toMatchObject({ id: ids.fy, year: 2025 })
    const foreign = await call(r.fiscalYear.GET, 'GET', `${base()}/${ids.otherFy}`, undefined, yearParams(ids.otherFy))
    expect(foreign.status).toBe(404)
    expect((await json(foreign)).error).toBe('Exercice introuvable pour cette société.')
  })

  it('changes the dates of an open year, not of a closed one nor over another open year', async () => {
    await prisma.fiscalYear.create({
      data: { companyId: ids.company, year: 2026, startDate: new Date('2025-07-01T00:00:00Z'), endDate: new Date('2026-06-30T00:00:00Z') },
    })
    const patch = (body: unknown) => call(r.fiscalYear.PATCH, 'PATCH', `${base()}/${ids.fy}`, body, yearParams(ids.fy))

    const updated = await patch({ startDate: '2024-07-01', endDate: '2025-06-29' })
    expect(updated.status).toBe(200)
    expect(await json(updated)).toMatchObject({ endDate: '2025-06-29T00:00:00.000Z' })

    const overlap = await patch({ startDate: '2024-07-01', endDate: '2025-08-31' })
    expect(overlap.status).toBe(400)
    expect((await json(overlap)).error).toBe("Ces dates chevauchent l'exercice ouvert 2026.")
    expect((await patch({ startDate: '2024-07-01' })).status).toBe(400)

    await prisma.fiscalYear.update({ where: { id: ids.fy }, data: { isClosed: true } })
    const closed = await patch({ startDate: '2024-07-01', endDate: '2025-06-30' })
    expect(closed.status).toBe(409)
    expect((await json(closed)).error).toBe("L'exercice 2025 est clôturé : ses dates ne peuvent plus être modifiées.")
  })

  it('deletes an empty open fiscal year (204), never a closed one or one of another company', async () => {
    const del = (fiscalYearId: string) => call(r.fiscalYear.DELETE, 'DELETE', `${base()}/${fiscalYearId}`, undefined, yearParams(fiscalYearId))
    expect((await del(ids.otherFy)).status).toBe(404)
    const closed = await prisma.fiscalYear.create({
      data: { companyId: ids.company, year: 2024, startDate: new Date('2023-07-01T00:00:00Z'), endDate: new Date('2024-06-30T00:00:00Z'), isClosed: true },
    })
    expect((await del(closed.id)).status).toBe(409)
    const deleted = await del(ids.fy)
    expect(deleted.status).toBe(204)
    expect(await prisma.fiscalYear.findUnique({ where: { id: ids.fy } })).toBeNull()
  })

  it('lists the reasons a closing is refused in details (400), and 409 on a closed year', async () => {
    const journal = await prisma.journal.create({ data: { companyId: ids.company, code: 'OD', label: 'Opérations diverses' } })
    await prisma.accountingEntry.create({
      data: { companyId: ids.company, fiscalYearId: ids.fy, journalId: journal.id, entryNumber: 'BR-1', date: new Date('2025-01-10T00:00:00Z'), status: 'draft' },
    })

    const simulation = await call(r.simulate.GET, 'GET', `${base()}/${ids.fy}/close/simulate`, undefined, yearParams(ids.fy))
    expect(simulation.status).toBe(400)
    const refused = await json(simulation)
    expect(refused.error).toBe("L'exercice ne peut pas encore être clôturé")
    expect(Array.isArray(refused.details) && refused.details.length).toBeGreaterThan(0)
    expect(Array.isArray(refused.warnings)).toBe(true)
    // The simulation comes with the reasons, so the dialog shows both
    expect(refused.simulation).toMatchObject({ nextFiscalYear: expect.any(Object), closingEntries: expect.any(Object) })

    const close = await call(r.close.POST, 'POST', `${base()}/${ids.fy}/close`, undefined, yearParams(ids.fy))
    expect(close.status).toBe(400)
    const closeError = await json(close)
    expect(closeError.error).toBe("Impossible de clôturer l'exercice")
    expect(closeError.details).toEqual(refused.details)

    await prisma.fiscalYear.update({ where: { id: ids.fy }, data: { isClosed: true } })
    const again = await call(r.close.POST, 'POST', `${base()}/${ids.fy}/close`, undefined, yearParams(ids.fy))
    expect(again.status).toBe(409)
    expect(await json(again)).toMatchObject({ error: 'Cet exercice est déjà clôturé', details: expect.any(Array) })

    const foreign = await call(r.close.POST, 'POST', `${base()}/${ids.otherFy}/close`, undefined, yearParams(ids.otherFy))
    expect(foreign.status).toBe(404)
  })

  it('reports and books no depreciation for a year without fixed assets', async () => {
    const pending = await call(r.depreciation.GET, 'GET', `${base()}/${ids.fy}/depreciation`, undefined, yearParams(ids.fy))
    expect(await json(pending)).toEqual({ count: 0, amount: 0, items: [] })
    const booked = await call(r.depreciation.POST, 'POST', `${base()}/${ids.fy}/depreciation`, undefined, yearParams(ids.fy))
    expect(await json(booked)).toEqual({ count: 0, amount: 0 })
    expect((await call(r.depreciation.GET, 'GET', `${base()}/${ids.otherFy}/depreciation`, undefined, yearParams(ids.otherFy))).status).toBe(404)
  })

  it('checks the amounts and the date of a result allocation', async () => {
    const preview = await call(r.allocation.GET, 'GET', `${base()}/${ids.fy}/result-allocation?dividends=100,50`, undefined, yearParams(ids.fy))
    expect(preview.status).toBe(200)
    // Nothing to distribute: the plan explains why the 100,50 € of dividends are refused
    const plan = (await json(preview)).plan as { dividends: number; errors: string[] }
    expect(plan.dividends).toBe(0)
    expect(plan.errors.length).toBeGreaterThan(0)

    const negative = await call(r.allocation.GET, 'GET', `${base()}/${ids.fy}/result-allocation?dividends=-5`, undefined, yearParams(ids.fy))
    expect(negative.status).toBe(400)
    expect((await json(negative)).error).toBe('dividends: montant invalide (positif, deux décimales au plus)')

    const noDate = await call(r.allocation.POST, 'POST', `${base()}/${ids.fy}/result-allocation`, { dividends: 0 }, yearParams(ids.fy))
    expect(noDate.status).toBe(400)
    expect((await json(noDate)).error).toBe("date: Date de l'assemblée obligatoire (AAAA-MM-JJ)")

    const thirdDecimal = await call(r.allocation.POST, 'POST', `${base()}/${ids.fy}/result-allocation`, { date: '2025-03-01', otherReserves: '1.005' }, yearParams(ids.fy))
    expect(thirdDecimal.status).toBe(400)
  })
})
