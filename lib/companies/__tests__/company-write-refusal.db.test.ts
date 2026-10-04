/**
 * Read-only companies decided by the instance policy (companyWriteRefusal,
 * lib/instance/policy.ts), checked by assertCompanyWritable on every write
 * of a company route and of an MCP tool (lib/mcp/company-access.ts), against
 * PostgreSQL with the real company route:
 * - Kledg's default never refuses: only archived companies are read-only;
 * - a refusal answers 409 with the policy's message and link on writes,
 *   while reads keep working.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('company_write_refusal')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  return { user: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))
vi.mock('@/lib/instance/policy', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/instance/policy')>()
  return { ...real, companyWriteRefusal: vi.fn(real.companyWriteRefusal) }
})

import * as policy from '@/lib/instance/policy'
import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { ARCHIVED_COMPANY_MESSAGE, assertCompanyWritable } from '../archive-company.service'
import { ConflictError } from '@/lib/accounting/errors'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
let prisma: typeof import('@/lib/prisma').prisma
let route: Record<'GET' | 'PATCH', Handler>
const ids = {} as Record<string, string>

const call = (method: 'GET' | 'PATCH', body?: unknown) =>
  route[method](
    new NextRequest(`http://localhost/api/companies/${ids.company}`, {
      method,
      ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    }),
    { params: Promise.resolve({ id: ids.company }) },
  )

describe.skipIf(!available)('read-only companies decided by the instance policy', () => {
  beforeAll(async () => {
    await prepareTestDatabase('company_write_refusal')
    ;({ prisma } = await import('@/lib/prisma'))
    route = (await import('@/app/api/companies/[id]/route')) as unknown as Record<'GET' | 'PATCH', Handler>
    await prisma.user.create({ data: { id: state.user.id, email: state.user.email, name: 'Admin', role: 'admin' } })
    ids.company = (await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '912345675' } })).id
    ids.archived = (await prisma.company.create({ data: { name: 'Ancienne', slug: 'ancienne', siren: '912345683', archivedAt: new Date() } })).id
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it("Kledg's default refuses nothing: only an archived company is read-only", async () => {
    await expect(assertCompanyWritable(ids.company)).resolves.toBeUndefined()
    await expect(assertCompanyWritable(ids.archived)).rejects.toEqual(new ConflictError(ARCHIVED_COMPANY_MESSAGE))
    expect(policy.companyWriteRefusal).toHaveBeenCalledWith(ids.company)
    expect((await call('PATCH', { name: 'Atelier Lumen' })).status).toBe(200)
  })

  it('a refusal answers writes with 409, its message and link, and keeps reads open', async () => {
    const refusal = {
      message: "L'abonnement de cette société a expiré : elle est en lecture seule.",
      link: { label: "Choisir une offre", href: '/settings/billing' },
    }
    vi.mocked(policy.companyWriteRefusal).mockResolvedValue(refusal)
    try {
      const write = await call('PATCH', { name: 'Refusée' })
      expect(write.status).toBe(409)
      expect(await write.json()).toEqual({ error: refusal.message, link: refusal.link })
      expect((await prisma.company.findUniqueOrThrow({ where: { id: ids.company } })).name).toBe('Atelier Lumen')

      const read = await call('GET')
      expect(read.status).toBe(200)
      expect(((await read.json()) as { name: string }).name).toBe('Atelier Lumen')
    } finally {
      vi.mocked(policy.companyWriteRefusal).mockReset()
    }
  })
})
