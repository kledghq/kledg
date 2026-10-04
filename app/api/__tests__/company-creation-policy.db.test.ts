/**
 * Company creation through the instance policy (companyCreationRefusal and
 * afterCompanyCreated, lib/instance/policy.ts), against PostgreSQL with the
 * real routes and only the session and the policy's two hooks replaced:
 * - Kledg's default: instance administrators only, users get the policy's
 *   French 403 on creation and on the SIREN prefill;
 * - a policy opening creation to users: the creator becomes the company
 *   administrator (member row "companyAdmin"), the hook hears about it;
 * - a refusal with a link answers it in the details of the 403.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('company_creation_policy')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

// The real default policy, with its two creation hooks spied on so a test can replace them.
vi.mock('@/lib/instance/policy', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/instance/policy')>()
  return { ...real, companyCreationRefusal: vi.fn(real.companyCreationRefusal), afterCompanyCreated: vi.fn(real.afterCompanyCreated) }
})

import * as policy from '@/lib/instance/policy'
import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { CreateCompanyInput } from '@/lib/companies/company-wizard'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
let prisma: typeof import('@/lib/prisma').prisma
const routes: Record<string, Record<string, Handler>> = {}

const USERS = {
  admin: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' },
  user: { id: 'u-user', email: 'user@test.local', name: 'User', role: 'user' },
} as const

const company = (siren: string, name: string): CreateCompanyInput => ({
  name,
  siren,
  legalType: 'SASU',
  firstFiscalYear: { startDate: '2026-01-01', endDate: '2026-12-31', isFirst: false },
  vatRegime: 'simplified',
  corporateTaxRegime: 'simplified',
})

async function call(who: keyof typeof USERS, route: string, method: 'GET' | 'POST', path: string, body?: unknown) {
  state.user = { ...USERS[who] }
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
  return routes[route][method](request, { params: Promise.resolve({}) })
}

describe.skipIf(!available)('company creation through the instance policy', () => {
  beforeAll(async () => {
    await prepareTestDatabase('company_creation_policy')
    ;({ prisma } = await import('@/lib/prisma'))
    routes.companies = (await import('@/app/api/companies/route')) as unknown as Record<string, Handler>
    routes.lookup = (await import('@/app/api/companies/lookup/route')) as unknown as Record<string, Handler>
    for (const user of Object.values(USERS)) {
      await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
    }
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  beforeEach(() => {
    vi.mocked(policy.companyCreationRefusal).mockClear()
    vi.mocked(policy.afterCompanyCreated).mockClear()
  })

  it("Kledg's default: users get the French 403, administrators create without becoming members", async () => {
    const refused = await call('user', 'companies', 'POST', '/api/companies', company('912345600', 'Refusée'))
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: "La création de sociétés est réservée aux administrateurs de l'instance." })
    expect((await call('user', 'lookup', 'GET', '/api/companies/lookup?siren=912345600')).status).toBe(403)
    expect(await prisma.company.count({ where: { siren: '912345600' } })).toBe(0)

    const created = await call('admin', 'companies', 'POST', '/api/companies', company('912345618', 'Par l’administrateur'))
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }
    expect(await prisma.member.count({ where: { organization: { companyId: id } } })).toBe(0)
    expect(policy.afterCompanyCreated).toHaveBeenCalledWith(id, { id: 'u-admin', email: 'admin@test.local', role: 'admin' })
  })

  it('a policy opening creation to users makes the creator the company administrator', async () => {
    vi.mocked(policy.companyCreationRefusal).mockResolvedValue(null)
    try {
      const response = await call('user', 'companies', 'POST', '/api/companies', company('912345626', 'Atelier Ouvert'))
      expect(response.status).toBe(201)
      const { id } = (await response.json()) as { id: string }
      const members = await prisma.member.findMany({ where: { organization: { companyId: id } }, select: { userId: true, role: true } })
      expect(members).toEqual([{ userId: 'u-user', role: 'companyAdmin' }])
      expect(policy.companyCreationRefusal).toHaveBeenCalledWith({ id: 'u-user', email: 'user@test.local', role: 'user' })
      expect(policy.afterCompanyCreated).toHaveBeenCalledWith(id, { id: 'u-user', email: 'user@test.local', role: 'user' })
      // The prefill opens with creation.
      expect((await call('user', 'lookup', 'GET', '/api/companies/lookup?siren=12')).status).toBe(400)
    } finally {
      vi.mocked(policy.companyCreationRefusal).mockReset()
    }
  })

  // KLEDG-SEC-012 (kledg-cloud KLEDG-CLOUD-006): the hook used to run after the
  // company was kept, so a failure (billing, ownership) left a company the
  // instance never assigned, unbilled and unrestricted.
  it('[KLEDG-SEC-012] removes the company when the after-creation hook fails, and keeps nothing of it', async () => {
    vi.mocked(policy.companyCreationRefusal).mockResolvedValue(null)
    vi.mocked(policy.afterCompanyCreated).mockRejectedValueOnce(new Error('billing service down'))
    const start = new Date()
    try {
      const response = await call('user', 'companies', 'POST', '/api/companies', company('912345642', 'Sans Abonnement'))
      expect(response.status).toBe(500)
      expect(policy.afterCompanyCreated).toHaveBeenCalledTimes(1)
      expect(await prisma.company.count({ where: { siren: '912345642' } })).toBe(0)
      expect(await prisma.member.count({ where: { userId: 'u-user', organization: { name: 'Sans Abonnement' } } })).toBe(0)
      expect(await prisma.organization.count({ where: { name: 'Sans Abonnement' } })).toBe(0)
      expect(await prisma.auditLog.count({ where: { action: 'CREATE_COMPANY', createdAt: { gte: start } } })).toBe(0)

      // Nothing blocks a new attempt once the hook works again.
      const retried = await call('user', 'companies', 'POST', '/api/companies', company('912345642', 'Sans Abonnement'))
      expect(retried.status).toBe(201)
    } finally {
      vi.mocked(policy.companyCreationRefusal).mockReset()
    }
  })

  it('answers a refusal with its link in the details, and creates nothing', async () => {
    vi.mocked(policy.companyCreationRefusal).mockResolvedValueOnce({
      message: 'Votre offre est limitée à une société.',
      link: { label: "Changer d'offre", href: '/settings/billing' },
    })
    const response = await call('user', 'companies', 'POST', '/api/companies', company('912345634', 'Au-delà'))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Votre offre est limitée à une société.',
      link: { label: "Changer d'offre", href: '/settings/billing' },
    })
    expect(await prisma.company.count({ where: { siren: '912345634' } })).toBe(0)
    expect(policy.afterCompanyCreated).not.toHaveBeenCalled()
  })
})
