import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GET, POST } from '../accounts/route'
import { NextRequest } from 'next/server'

// Mock dependencies
vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    id: 'user-1',
    email: 'test@example.com',
    name: null,
    role: null,
  }),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return {
    ...actual,
    getUserRolesForCompany: vi.fn().mockResolvedValue(['companyAdmin']),
    isGlobalAdmin: vi.fn().mockReturnValue(false),
  }
})

// Company references resolve to themselves (no slug lookup)
vi.mock('@/lib/companies/slug', () => ({
  resolveCompanyRef: vi.fn(async (ref: string) => ref),
}))

vi.mock('@/lib/accounting/fiscal-year-utils', () => ({
  getOrCreateActiveFiscalYear: vi.fn().mockResolvedValue({ id: 'fy-1' }),
}))

vi.mock('@/lib/audit', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'

const db = asPrismaMock(prisma)

describe('API /api/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('should return accounts for a company', async () => {
      const mockAccounts = [
        { id: 'acc-1', code: '101', label: 'Capital', companyId: 'company-1' },
        { id: 'acc-2', code: '411', label: 'Clients', companyId: 'company-1' },
      ]

      db.account.findMany.mockResolvedValue(mockAccounts)

      const request = new NextRequest('http://localhost/api/accounts?companyId=company-1')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual(mockAccounts)
      expect(db.account.findMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', fiscalYearId: 'fy-1' },
        orderBy: { code: 'asc' },
      })
    })

    it('should return 400 if companyId is missing', async () => {
      const request = new NextRequest('http://localhost/api/accounts')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('companyId est requis')
    })

    it('should return 404 when the user is not a member of the company', async () => {
      const { getUserRolesForCompany } = await import('@/lib/rbac/authorize')
      vi.mocked(getUserRolesForCompany).mockResolvedValueOnce([])

      const request = new NextRequest('http://localhost/api/accounts?companyId=company-2')
      const response = await GET(request)

      expect(response.status).toBe(404)
      expect(db.account.findMany).not.toHaveBeenCalled()
    })

    it('should return 401 if user is not authenticated', async () => {
      const { getCurrentUser } = await import('@/lib/session')
      vi.mocked(getCurrentUser).mockResolvedValueOnce(null)

      const request = new NextRequest('http://localhost/api/accounts?companyId=company-1')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Non authentifié')
    })
  })

  describe('POST', () => {
    it('should create a new account', async () => {
      const mockAccount = {
        id: 'acc-1',
        code: '101100',
        label: 'Capital souscrit',
        companyId: 'company-1',
        fiscalYearId: 'fy-1',
        parentId: 'acc-101',
        isPCG: true,
      }

      db.account.findUnique.mockResolvedValueOnce(null) // no duplicate code
      db.account.findFirst.mockResolvedValueOnce({
        id: 'acc-101',
        code: '101',
        companyId: 'company-1',
        fiscalYearId: 'fy-1',
        isPCG: true,
      })
      db.account.create.mockResolvedValue(mockAccount)

      const request = new NextRequest('http://localhost/api/accounts', {
        method: 'POST',
        body: JSON.stringify({
          companyId: 'company-1',
          code: '101100',
          label: 'Capital souscrit',
          parentId: 'acc-101',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(201)
      expect(data).toEqual(mockAccount)
      expect(db.account.findFirst).toHaveBeenCalledWith({
        where: { id: 'acc-101', companyId: 'company-1' },
      })
      expect(db.account.create).toHaveBeenCalledWith({
        data: {
          code: '101100',
          label: 'Capital souscrit',
          companyId: 'company-1',
          fiscalYearId: 'fy-1',
          parentId: 'acc-101',
          isPCG: true,
        },
      })
    })

    it('should reject a parent account of another company', async () => {
      db.account.findUnique.mockResolvedValueOnce(null)
      db.account.findFirst.mockResolvedValueOnce(null) // not found with companyId

      const request = new NextRequest('http://localhost/api/accounts', {
        method: 'POST',
        body: JSON.stringify({
          companyId: 'company-1',
          code: '101100',
          label: 'Capital souscrit',
          parentId: 'acc-of-company-2',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Compte parent invalide')
      expect(db.account.create).not.toHaveBeenCalled()
    })

    it('should reject a fiscal year of another company', async () => {
      db.fiscalYear.findFirst.mockResolvedValueOnce(null)

      const request = new NextRequest('http://localhost/api/accounts', {
        method: 'POST',
        body: JSON.stringify({
          companyId: 'company-1',
          code: '101100',
          label: 'Capital souscrit',
          parentId: 'acc-101',
          fiscalYearId: 'fy-of-company-2',
        }),
      })

      const response = await POST(request)

      expect(response.status).toBe(404)
      expect(db.fiscalYear.findFirst).toHaveBeenCalledWith({
        where: { id: 'fy-of-company-2', companyId: 'company-1' },
        select: { id: true },
      })
      expect(db.account.create).not.toHaveBeenCalled()
    })

    it('should return 400 if parentId is missing', async () => {
      const request = new NextRequest('http://localhost/api/accounts', {
        method: 'POST',
        body: JSON.stringify({ companyId: 'company-1', code: '101100', label: 'Capital souscrit' }),
      })

      const response = await POST(request)

      expect(response.status).toBe(400)
      expect(db.account.create).not.toHaveBeenCalled()
    })

    it('should return 409 if account code already exists', async () => {
      db.account.findUnique.mockResolvedValue({
        id: 'acc-existing',
        code: '101100',
      })

      const request = new NextRequest('http://localhost/api/accounts', {
        method: 'POST',
        body: JSON.stringify({
          companyId: 'company-1',
          code: '101100',
          label: 'Capital souscrit',
          parentId: 'acc-101',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(409)
      expect(data.error).toBeDefined()
      expect(db.account.create).not.toHaveBeenCalled()
    })
  })
})
