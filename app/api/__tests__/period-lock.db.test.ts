/**
 * Period closing (clôture de période) against PostgreSQL, through the real
 * route with the session and roles mocked. Skipped without the test
 * database server.
 *
 * PCG art. 1031-4 (règlement ANC n° 2014-03 as amended by n° 2022-06): "une
 * procédure de clôture destinée à figer la chronologie et à garantir
 * l'intangibilité des enregistrements est mise en œuvre au plus tard avant
 * l'expiration de la période suivante"; an operation dated in a closed period
 * is booked on the first day of the open period, with its real date stated.
 * BOI-BIC-DECLA-30-10-20-40 § 130 and 140 (clôture des périodes).
 *
 * - POST /api/companies/[id]/fiscal-years/[fiscalYearId]/period-lock closes
 *   the period up to a day: never backwards, never the last day of the year
 *   (that is the closing of the year), refused while drafts are dated in it;
 * - no entry dated in a closed period can be created or validated, by the
 *   services (409 naming the first open day) or by the database (trigger);
 * - entries already validated stay as they are, lettering stays free.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const member = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('period_lock')
  return { companyId: '', roles: ['accountant'] as string[] }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'compta@example.com', name: null, role: null }),
}))
vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return {
    ...actual,
    getUserRolesForCompany: vi.fn(async (_userId: string, companyId: string) => (companyId === member.companyId ? member.roles : [])),
    isGlobalAdmin: vi.fn().mockReturnValue(false),
  }
})
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'

const available = await testDatabaseAvailable()

type Handler = (request: NextRequest, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
let prisma: typeof import('@/lib/prisma').prisma
let route: Record<'POST', Handler>
let lifecycle: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let handleError: typeof import('@/lib/accounting/errors').handleError
const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function lock(through: unknown, fiscalYearId = ids.fy) {
  const request = new NextRequest(`http://localhost/api/companies/${ids.company}/fiscal-years/${fiscalYearId}/period-lock`, {
    method: 'POST',
    body: JSON.stringify({ through }),
    headers: { 'content-type': 'application/json' },
  })
  return route.POST(request, { params: Promise.resolve({ id: ids.company, fiscalYearId }) })
}

function draft(date: string) {
  return lifecycle.createEntry({
    companyId: ids.company,
    journalId: ids.journal,
    date,
    description: 'Vente',
    lines: [
      { accountId: ids.bank, debit: 100, credit: 0 },
      { accountId: ids.sales, debit: 0, credit: 100 },
    ],
  })
}

describe.skipIf(!available)('period closing (PCG art. 1031-4)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('period_lock')
    ;({ prisma } = await import('@/lib/prisma'))
    route = (await import('@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/period-lock/route')) as unknown as Record<'POST', Handler>
    lifecycle = await import('@/lib/accounting/services/entry-lifecycle.service')
    ;({ handleError } = await import('@/lib/accounting/errors'))
  })

  beforeEach(async () => {
    await prepareTestDatabase('period_lock')
    member.roles = ['accountant']
    const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
    await seedMembership(prisma, 'user-1', company.id)
    member.companyId = company.id
    const fy = await prisma.fiscalYear.create({
      data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') },
    })
    const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'VE', label: 'Ventes' } })
    const bank = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '512000', label: 'Banque' } })
    const sales = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '706000', label: 'Prestations' } })
    Object.assign(ids, { company: company.id, fy: fy.id, journal: journal.id, bank: bank.id, sales: sales.id })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('closes a period, then refuses any entry dated in it and names the first open day', async () => {
    const january = await draft('2026-01-15')
    await lifecycle.validateEntries(ids.company, [january.id])

    const response = await lock('2026-01-31')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ periodLockedThrough: '2026-01-31' })
    const stored = await prisma.fiscalYear.findUniqueOrThrow({ where: { id: ids.fy } })
    expect(stored.periodLockedThrough?.toISOString()).toBe('2026-01-31T00:00:00.000Z')
    expect(stored.periodLockedById).toBe('user-1')

    const refused = await draft('2026-01-20').catch((e: unknown) => e)
    expect(handleError(refused)).toMatchObject({ statusCode: 409, message: expect.stringContaining('01/02/2026') })
    await expect(draft('2026-02-01')).resolves.toMatchObject({ status: 'draft' })

    // The database refuses it too, whatever the code path
    const direct = await prisma.accountingEntry
      .create({ data: { companyId: ids.company, journalId: ids.journal, fiscalYearId: ids.fy, entryNumber: 'BR-X', date: day('2026-01-10') } })
      .catch((e: unknown) => e)
    expect(handleError(direct)).toMatchObject({ statusCode: 409, message: expect.stringContaining('clôturée') })

    // Validated entries of the period stay; lettering is not part of the entry
    await prisma.entryLine.updateMany({ where: { accountingEntryId: january.id }, data: { letteringCode: 'AA' } })
    expect(await prisma.accountingEntry.count({ where: { id: january.id, status: 'validated' } })).toBe(1)
  })

  it('refuses to close a period holding drafts, to go backwards and to lock the last day of the year', async () => {
    const pending = await draft('2026-03-10')
    const withDraft = await lock('2026-03-31')
    expect(withDraft.status).toBe(409)
    expect((await withDraft.json()).error).toContain('brouillon')
    await lifecycle.deleteDraftEntry(ids.company, pending.id)

    expect((await lock('2026-03-31')).status).toBe(200)
    expect((await lock('2026-02-28')).status).toBe(409)
    expect((await lock('2026-12-31')).status).toBe(400)
    expect((await lock('2025-12-31')).status).toBe(400)
    expect((await lock('pas une date')).status).toBe(400)

    // The year's dates cannot leave the closed day outside it
    const shrink = await prisma.fiscalYear.update({ where: { id: ids.fy }, data: { endDate: day('2026-03-31') } }).catch((e: unknown) => e)
    expect(handleError(shrink)).toMatchObject({ statusCode: 409 })

    // Backwards through the database as well
    const direct = await prisma.fiscalYear.update({ where: { id: ids.fy }, data: { periodLockedThrough: null } }).catch((e: unknown) => e)
    expect(handleError(direct)).toMatchObject({ statusCode: 409 })
  })

  it('never leaves a draft inside a closed period, even through the database', async () => {
    const pending = await draft('2026-04-10')
    // A lock written behind the service's back cannot leave a draft in the closed period
    const direct = await prisma.fiscalYear.update({ where: { id: ids.fy }, data: { periodLockedThrough: day('2026-04-30') } }).catch((e: unknown) => e)
    expect(handleError(direct)).toMatchObject({ statusCode: 409 })
    const result = await lifecycle.validateEntries(ids.company, [pending.id])
    expect(result.errors).toEqual([])
    expect(result.validated).toHaveLength(1)
  })

  it('needs the closing right: a viewer gets 403', async () => {
    member.roles = ['viewer']
    expect((await lock('2026-01-31')).status).toBe(403)
  })
})

describe.skipIf(!available)('automatic period closing (deadline settings, off by default)', () => {
  it('reaches the end of the latest month whose delay has run', async () => {
    const { monthlyLockTarget } = await import('@/lib/accounting/period-lock/auto-lock.service')
    expect(monthlyLockTarget('2026-03-20', 20)).toBe('2026-02-28')
    expect(monthlyLockTarget('2026-03-19', 20)).toBe('2026-01-31')
    expect(monthlyLockTarget('2026-01-05', 1)).toBe('2025-12-31')
  })

  it('closes the companies in monthly mode only, through the cron route, and reports a period with drafts', async () => {
    await prepareTestDatabase('period_lock')
    const auto = await import('@/lib/accounting/period-lock/auto-lock.service')
    const make = async (slug: string, siren: string, settings: { periodAutoLock: string; periodAutoLockDelayDays: number } | null) => {
      const company = await prisma.company.create({ data: { name: slug, slug, siren, ...(settings ? { deadlineSettings: settings } : {}) } })
      const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
      return { company: company.id, fy: fy.id }
    }
    const monthly = await make('mensuelle', '111111111', { periodAutoLock: 'monthly', periodAutoLockDelayDays: 10 })
    const off = await make('sans', '222222222', null)
    const blocked = await make('brouillons', '333333333', { periodAutoLock: 'monthly', periodAutoLockDelayDays: 10 })
    const journal = await prisma.journal.create({ data: { companyId: blocked.company, code: 'OD', label: 'OD' } })
    await prisma.accountingEntry.create({ data: { companyId: blocked.company, journalId: journal.id, fiscalYearId: blocked.fy, entryNumber: 'BR-1', date: day('2026-02-10') } })

    const result = await auto.runMonthlyPeriodLocks(new Date('2026-03-15T08:00:00Z'))
    expect(result).toEqual({ companies: 2, locked: 1, skipped: 1 })
    const lockOf = async (id: string) => (await prisma.fiscalYear.findUniqueOrThrow({ where: { id } })).periodLockedThrough?.toISOString() ?? null
    expect(await lockOf(monthly.fy)).toBe('2026-02-28T00:00:00.000Z')
    expect(await lockOf(off.fy)).toBeNull()
    expect(await lockOf(blocked.fy)).toBeNull()
    expect((await prisma.fiscalYear.findUniqueOrThrow({ where: { id: monthly.fy } })).periodLockedById).toBe(auto.AUTO_LOCK_USER)

    // The cron route: refused without the bearer token when CRON_SECRET is set
    process.env.CRON_SECRET = 'cron-secret-for-tests'
    const { GET } = await import('@/app/api/cron/period-locks/route')
    expect((await GET(new Request('http://localhost/api/cron/period-locks'))).status).toBe(401)
    const ran = await GET(new Request('http://localhost/api/cron/period-locks', { headers: { authorization: 'Bearer cron-secret-for-tests' } }))
    expect(ran.status).toBe(200)
    expect(await ran.json()).toMatchObject({ success: true, companies: 2 })
    delete process.env.CRON_SECRET
  })
})
