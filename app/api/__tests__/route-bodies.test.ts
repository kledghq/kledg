/**
 * Bodies of the routes the code review listed (addresses, bank account
 * selection, integration features; auto-reconcile and tasks/refresh are
 * covered by bank-refresh-routes.test.ts): each is validated by a zod schema
 * before the service runs, and nothing arbitrary is stored. The integration
 * feature `config` is bounded: a flat object of at most 20 short keys with
 * primitive values (Kledg reads none today).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/companies/archive-company.service', () => ({ assertCompanyWritable: async () => undefined }))
vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'user-1', email: 'u@test.local', name: null, role: null })),
}))
vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/rbac/authorize', async () => ({
  ...(await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')),
  getUserRolesForCompany: vi.fn(async () => ['companyAdmin']),
  isGlobalAdmin: vi.fn(() => false),
}))
vi.mock('@/lib/companies/slug', () => ({ resolveCompanyRef: vi.fn(async (ref: string) => ref) }))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import * as addresses from '../addresses/route'
import * as selectAccount from '../banking/select-account/route'
import * as features from '../integrations/[id]/features/route'

const db = asPrismaMock(prisma)

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

function call(handler: Handler, url: string, body: unknown, params: Record<string, string> = {}) {
  return handler(
    new NextRequest(`http://localhost${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params) },
  )
}

describe('validated route bodies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.integration.findUnique.mockResolvedValue({ companyId: 'c1' })
    db.integration.findFirst.mockResolvedValue({ id: 'int-1', companyId: 'c1' })
    db.integrationFeatureConfig.findMany.mockResolvedValue([])
  })

  it('POST /api/addresses refuses a missing street or an invalid country', async () => {
    expect((await call(addresses.POST, '/api/addresses', { companyId: 'c1', postalCode: '75001', city: 'Paris' })).status).toBe(400)
    expect((await call(addresses.POST, '/api/addresses', { companyId: 'c1', street: '1 rue', postalCode: '75001', city: 'Paris', country: 'FRANCE' })).status).toBe(400)
    expect(db.address.create).not.toHaveBeenCalled()
  })

  it('POST /api/banking/select-account refuses an oversized account id', async () => {
    expect((await call(selectAccount.POST, '/api/banking/select-account', { companyId: 'c1', accountId: 'x'.repeat(500) })).status).toBe(400)
  })

  it('POST /api/integrations/[id]/features refuses nested or oversized configuration', async () => {
    const send = (config: unknown) =>
      call(features.POST, '/api/integrations/int-1/features', { features: [{ feature: 'BANKING_ACCOUNTS', config }] }, { id: 'int-1' })
    expect((await send({ nested: { deep: { deeper: 1 } } })).status).toBe(400)
    expect((await send({ note: 'x'.repeat(10_000) })).status).toBe(400)
    expect((await send(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i])))).status).toBe(400)
    expect(db.integrationFeatureConfig.upsert).not.toHaveBeenCalled()
    expect((await send({ syncFrom: '2026-01-01', enabled: true, max: 3 })).status).toBe(200)
  })
})
