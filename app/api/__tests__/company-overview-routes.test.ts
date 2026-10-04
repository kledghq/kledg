/**
 * Tasks indicator (GET /api/tasks/count) route with a mocked session and Prisma: query parsing,
 * company scoping, response shapes kept for the UI, and membership (404).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@example.com', name: null, role: null }),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return { ...actual, getUserRolesForCompany: vi.fn().mockResolvedValue(['viewer']) }
})

vi.mock('@/lib/companies/slug', () => ({
  resolveCompanyRef: vi.fn(async (ref: string) => ref),
}))

import { GET as tasksCountRoute } from '../tasks/count/route'
import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { getUserRolesForCompany } from '@/lib/rbac/authorize'
const db = asPrismaMock(prisma)

describe('GET /api/tasks/count', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("counts the company's unreconciled bank transactions", async () => {
    db.bankTransaction.count.mockResolvedValue(7)
    const response = await tasksCountRoute(new NextRequest('http://localhost/api/tasks/count?companyId=company-1'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ unreconciledTransactions: 7, totalTasks: 7 })
    expect(db.bankTransaction.count).toHaveBeenCalledWith({
      where: { bankAccount: { bankConnection: { companyId: 'company-1' } }, reconciled: false },
    })
  })

  it('answers 404 to a non member without counting', async () => {
    vi.mocked(getUserRolesForCompany).mockResolvedValueOnce([])
    const response = await tasksCountRoute(new NextRequest('http://localhost/api/tasks/count?companyId=company-2'))
    expect(response.status).toBe(404)
    expect(db.bankTransaction.count).not.toHaveBeenCalled()
  })
})
