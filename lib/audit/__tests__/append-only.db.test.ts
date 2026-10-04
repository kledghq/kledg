/**
 * The audit log is append-only, enforced by PostgreSQL for every code path
 * (migration 20261011090000_audit_log_append_only): rows cannot be updated
 * or deleted, except
 * - the company link cleared by ON DELETE SET NULL when an empty company is
 *   deleted (the row and its metadata stay);
 * - the retention purge, through kledg_purge_audit_logs, and only for rows
 *   older than 10 years (Code de commerce art. L123-22).
 * Member changes are audited by the member routes.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('audit_append_only')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' as string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ sent: false })), isEmailConfigured: () => false }))

import { prepareTestDatabase, queryAsOwner, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { rlsMode } from '@/lib/rls/mode'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
let prisma: typeof import('@/lib/prisma').prisma

function call(handler: Handler, method: string, url: string, params: Record<string, string>, body?: unknown) {
  const request = new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return handler(request, { params: Promise.resolve(params) })
}

describe.skipIf(!available)('append-only audit log', () => {
  beforeAll(async () => {
    await prepareTestDatabase('audit_append_only')
    ;({ prisma } = await import('@/lib/prisma'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('audit_append_only')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('refuses to update or delete an audit row', async () => {
    const row = await prisma.auditLog.create({ data: { action: 'CLOSE_FISCAL_YEAR', message: 'Exercice 2025 clôturé' } })
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { message: 'rien à voir' } })).rejects.toThrow(/KLEDG_AUDIT_LOG_APPEND_ONLY/)
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/KLEDG_AUDIT_LOG_APPEND_ONLY/)
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow(/KLEDG_AUDIT_LOG_APPEND_ONLY/)
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } })).message).toBe('Exercice 2025 clôturé')
  })

  it('refuses the purge bypass for rows younger than 10 years', async () => {
    const row = await prisma.auditLog.create({ data: { action: 'X', message: 'récent' } })
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('kledg.audit_purge', 'on', true)`
        await tx.auditLog.delete({ where: { id: row.id } })
      }),
    ).rejects.toThrow(/KLEDG_AUDIT_LOG_APPEND_ONLY/)
  })

  it('purges only rows older than 10 years through kledg_purge_audit_logs', async () => {
    const old = new Date(Date.UTC(2010, 0, 1))
    // Rows are inserted with an old date (INSERT is allowed; only UPDATE and DELETE are guarded).
    await prisma.auditLog.create({ data: { action: 'OLD', message: 'ancien', createdAt: old } })
    await prisma.auditLog.create({ data: { action: 'NEW', message: 'récent' } })
    // The purge is the owner's (migration 20261029090000_definer_function_hardening).
    const [{ purged }] = await queryAsOwner<{ purged: number }>('audit_append_only', 'SELECT kledg_purge_audit_logs(now()) AS purged')
    expect(Number(purged)).toBe(1)
    expect((await prisma.auditLog.findMany()).map((r) => r.action)).toEqual(['NEW'])
  })

  it.runIf(rlsMode() === 'enforce')('[KLEDG-SEC-013] refuses the purge to the application role', async () => {
    await expect(prisma.$queryRaw`SELECT kledg_purge_audit_logs(now())`).rejects.toThrow(/permission denied/)
  })

  it('keeps the rows of a deleted company, only clearing their company link', async () => {
    const company = await prisma.company.create({ data: { name: 'Vide', slug: 'vide', siren: '999999999' } })
    await prisma.auditLog.create({ data: { action: 'CREATE_COMPANY', message: 'Société créée', companyId: company.id, metadata: { companyId: company.id } } })
    await prisma.company.delete({ where: { id: company.id } })
    const rows = await prisma.auditLog.findMany({ where: { action: 'CREATE_COMPANY' } })
    expect(rows).toHaveLength(1)
    expect(rows[0].companyId).toBeNull()
  })

  it('audits member additions, role changes and removals', async () => {
    await prisma.user.create({ data: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' } })
    await prisma.user.create({ data: { id: 'u-marie', email: 'marie@test.local', name: 'Marie', role: 'user', emailVerified: true } })
    const company = await prisma.company.create({ data: { name: 'Alpha', slug: 'alpha', siren: '111111111' } })
    await prisma.organization.create({ data: { id: 'org-a', name: 'Alpha', slug: 'org-alpha', createdAt: new Date(), companyId: company.id } })

    const members = (await import('@/app/api/companies/[id]/members/route')) as unknown as Record<string, Handler>
    const member = (await import('@/app/api/companies/[id]/members/[memberId]/route')) as unknown as Record<string, Handler>

    const added = await call(members.POST, 'POST', `/api/companies/${company.id}/members`, { id: company.id }, { email: 'marie@test.local', role: 'viewer' })
    expect(added.status).toBe(201)
    const { memberId } = (await added.json()) as { memberId: string }
    expect((await call(member.PATCH, 'PATCH', `/api/companies/${company.id}/members/${memberId}`, { id: company.id, memberId }, { role: 'accountant' })).status).toBe(200)
    expect((await call(member.DELETE, 'DELETE', `/api/companies/${company.id}/members/${memberId}`, { id: company.id, memberId })).status).toBe(200)

    const rows = await prisma.auditLog.findMany({ where: { companyId: company.id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.action)).toEqual(['MEMBER_ADDED', 'MEMBER_ROLE_CHANGED', 'MEMBER_REMOVED'])
    expect(rows[1].metadata).toMatchObject({ memberId, userId: 'u-marie', from: 'viewer', to: 'accountant' })
    expect(rows.every((r) => r.userId === 'admin@test.local')).toBe(true)
  })
})
