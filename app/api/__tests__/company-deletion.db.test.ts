/**
 * Company deletion and archiving against PostgreSQL, through the real route
 * handlers with only the session mocked.
 *
 * French law keeps the books 10 years (Code de commerce art. L123-22): a
 * company with a validated entry or a closed fiscal year can never be
 * deleted, by anyone, on any code path (database trigger of migration
 * 20261011100000_company_archiving). It can be archived instead: read-only,
 * hidden from the lists, restorable. Deleting, archiving and restoring are
 * reserved to instance administrators and always audited.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('company_deletion')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
let prisma: typeof import('@/lib/prisma').prisma
let company: Record<string, Handler>
let archive: Record<string, Handler>
let listCompaniesForUser: typeof import('@/lib/companies/manage-company.service').listCompaniesForUser

const USERS = {
  admin: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' },
  companyAdmin: { id: 'u-cadmin', email: 'cadmin@test.local', name: 'Company admin', role: 'user' },
} as const

async function call(who: keyof typeof USERS, handler: Handler, method: string, id: string, body?: unknown) {
  state.user = { ...USERS[who] }
  const request = new NextRequest(`http://localhost/api/companies/${id}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  return handler(request, { params: Promise.resolve({ id }) })
}

let n = 0
async function seedCompany(books: 'empty' | 'validated' | 'closed') {
  n += 1
  const c = await prisma.company.create({ data: { name: `Société ${n}`, slug: `societe-${n}`, siren: String(100000000 + n) } })
  await prisma.organization.create({ data: { id: `org-${n}`, name: c.name, slug: `org-${n}`, createdAt: new Date(), companyId: c.id } })
  await prisma.member.create({ data: { id: `m-${n}`, userId: USERS.companyAdmin.id, organizationId: `org-${n}`, role: 'companyAdmin', createdAt: new Date() } })
  const fy = await prisma.fiscalYear.create({
    data: { companyId: c.id, year: 2025, startDate: new Date('2025-01-01T00:00:00Z'), endDate: new Date('2025-12-31T00:00:00Z') },
  })
  if (books !== 'empty') {
    const journal = await prisma.journal.create({ data: { companyId: c.id, code: 'OD', label: 'Opérations diverses' } })
    await prisma.accountingEntry.create({
      data: { companyId: c.id, fiscalYearId: fy.id, journalId: journal.id, entryNumber: '1', date: new Date('2025-03-01T00:00:00Z'), description: 'Vente', status: 'validated' },
    })
  }
  if (books === 'closed') {
    await prisma.fiscalYear.update({ where: { id: fy.id }, data: { isClosed: true, closedAt: new Date() } })
  }
  return c.id
}

describe.skipIf(!available)('company deletion and archiving', () => {
  beforeAll(async () => {
    await prepareTestDatabase('company_deletion')
    ;({ prisma } = await import('@/lib/prisma'))
    company = (await import('@/app/api/companies/[id]/route')) as unknown as Record<string, Handler>
    ;({ listCompaniesForUser } = await import('@/lib/companies/manage-company.service'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('company_deletion')
    for (const user of Object.values(USERS)) {
      await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
    }
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('refuses deletion to a company administrator, even of an empty company', async () => {
    const id = await seedCompany('empty')
    expect((await call('companyAdmin', company.DELETE, 'DELETE', id)).status).toBe(403)
    expect(await prisma.company.count({ where: { id } })).toBe(1)
  })

  it('refuses to delete a company holding validated entries or a closed year, even to an instance administrator', async () => {
    for (const books of ['validated', 'closed'] as const) {
      const id = await seedCompany(books)
      const response = await call('admin', company.DELETE, 'DELETE', id)
      expect(response.status, books).toBe(409)
      expect(((await response.json()) as { error: string }).error).toMatch(/archiv/i)
      expect(await prisma.company.count({ where: { id } }), books).toBe(1)
      expect(await prisma.accountingEntry.count({ where: { companyId: id, status: 'validated' } }), books).toBe(1)
    }
  })

  it('refuses the deletion in the database too, whatever the code path', async () => {
    const id = await seedCompany('validated')
    await expect(prisma.company.delete({ where: { id } })).rejects.toThrow(/KLEDG_COMPANY_HAS_BOOKS/)
  })

  it('lets a transaction that sets kledg.company_purge delete a company with books (throwaway companies of a fork), and only that transaction', async () => {
    const kept = await seedCompany('validated')
    const purged = await seedCompany('validated')
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('kledg.company_purge', 'on', true)`
      await tx.$executeRaw`SELECT set_config('kledg.closed_year_bypass', 'on', true)`
      await tx.company.delete({ where: { id: purged } })
    })
    expect(await prisma.company.count({ where: { id: purged } })).toBe(0)
    // Transaction scoped: the next deletion is refused again.
    await expect(prisma.company.delete({ where: { id: kept } })).rejects.toThrow(/KLEDG_COMPANY_HAS_BOOKS/)
  })

  it('lets an instance administrator delete an empty company, and audits it', async () => {
    const id = await seedCompany('empty')
    expect((await call('admin', company.DELETE, 'DELETE', id)).status).toBe(200)
    expect(await prisma.company.count({ where: { id } })).toBe(0)
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'COMPANY_DELETED' } })
    expect(audit.metadata).toMatchObject({ companyId: id, siren: expect.any(String) })
    expect(audit.userId).toBe(USERS.admin.email)
  })

  it('archives a company: read-only, hidden from lists, restorable by an instance administrator, audited', async () => {
    archive = (await import('@/app/api/companies/[id]/archive/route')) as unknown as Record<string, Handler>
    const id = await seedCompany('closed')
    expect((await call('companyAdmin', archive.POST, 'POST', id)).status).toBe(403)
    expect((await call('admin', archive.POST, 'POST', id)).status).toBe(200)

    expect((await listCompaniesForUser(USERS.companyAdmin)).map((c) => c.id)).not.toContain(id)
    expect((await listCompaniesForUser(USERS.admin)).map((c) => c.id)).not.toContain(id)
    // Still readable, never writable
    expect((await call('companyAdmin', company.GET, 'GET', id)).status).toBe(200)
    const write = await call('companyAdmin', company.PATCH, 'PATCH', id, { name: 'Renommée' })
    expect(write.status).toBe(409)
    expect(((await write.json()) as { error: string }).error).toMatch(/archivée/)

    expect((await call('companyAdmin', archive.DELETE, 'DELETE', id)).status).toBe(403)
    expect((await call('admin', archive.DELETE, 'DELETE', id)).status).toBe(200)
    expect((await listCompaniesForUser(USERS.companyAdmin)).map((c) => c.id)).toContain(id)
    expect((await call('companyAdmin', company.PATCH, 'PATCH', id, { name: 'Renommée' })).status).toBe(200)

    const actions = (await prisma.auditLog.findMany({ where: { companyId: id }, orderBy: { createdAt: 'asc' } })).map((r) => r.action)
    expect(actions).toEqual(['COMPANY_ARCHIVED', 'COMPANY_RESTORED'])
  })
})
