import { describe, it, expect, beforeEach, vi } from 'vitest'
import { POST } from '../integrations/verify/route'
import { NextRequest } from 'next/server'

// Mock dependencies
// Archived companies are read-only (lib/companies/archive-company.service.ts): none here.
vi.mock('@/lib/companies/archive-company.service', () => ({ assertCompanyWritable: async () => undefined }))
vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    id: 'user-1',
    email: 'test@example.com',
    name: null,
    role: null,
  }),
}))

vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return {
    ...actual,
    getUserRolesForCompany: vi.fn().mockResolvedValue(['companyAdmin']),
    isGlobalAdmin: vi.fn().mockReturnValue(false),
  }
})

vi.mock('@/lib/companies/slug', () => ({
  resolveCompanyRef: vi.fn(async (ref: string) => ref),
}))

const rateLimit = vi.hoisted(() => ({ enforceRateLimit: vi.fn<(name: string, subject: string) => Promise<void>>(async () => {}) }))
vi.mock('@/lib/rate-limit', () => rateLimit)

vi.mock('@/lib/banking/providers', () => ({
  createBankProvider: vi.fn(),
}))

import { createBankProvider } from '@/lib/banking/providers'

const createProvider = vi.mocked(createBankProvider)

describe('API /api/integrations/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('counts the call against the bank API limit of the company', async () => {
    const { RateLimitError } = await import('@/lib/accounting/errors')
    rateLimit.enforceRateLimit.mockRejectedValueOnce(new RateLimitError('Trop de requêtes vers la banque. Patientez une minute.'))
    const request = new NextRequest('http://localhost:3000/api/integrations/verify', {
      method: 'POST',
      body: JSON.stringify({ companyId: 'company-1', provider: 'QONTO', credentials: { login: 'l', secretKey: 's' } }),
    })
    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(429)
    expect(rateLimit.enforceRateLimit).toHaveBeenCalledWith('bank-api', 'company-1')
    expect(createProvider).not.toHaveBeenCalled()
  })

  it('should verify valid Qonto credentials', async () => {
    const mockProvider = {
      listAccounts: vi.fn().mockResolvedValue([{ externalId: 'FR76', iban: 'FR76', name: 'Main', currency: 'EUR', balance: 1 }]),
    }

    createProvider.mockReturnValue(mockProvider as unknown as ReturnType<typeof createBankProvider>)

    const request = new NextRequest('http://localhost/api/integrations/verify', {
      method: 'POST',
      body: JSON.stringify({
        companyId: 'company-1',
        provider: 'QONTO',
        credentials: {
          login: 'test@example.com',
          secretKey: 'secret-key',
        },
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.valid).toBe(true)
    expect(data.organization.bankAccountsCount).toBe(1)
    expect(createProvider).toHaveBeenCalledWith(
      'QONTO',
      { login: 'test@example.com', secretKey: 'secret-key' }
    )
  })

  it('should reject invalid credentials', async () => {
    const mockProvider = {
      listAccounts: vi.fn().mockRejectedValue(new Error('Invalid credentials')),
    }

    createProvider.mockReturnValue(mockProvider as unknown as ReturnType<typeof createBankProvider>)

    const request = new NextRequest('http://localhost/api/integrations/verify', {
      method: 'POST',
      body: JSON.stringify({
        companyId: 'company-1',
        provider: 'QONTO',
        credentials: {
          login: 'test@example.com',
          secretKey: 'wrong-key',
        },
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.valid).toBe(false)
    expect(data.error).toBeDefined()
  })

  it('answers a French reason, never the message of the provider', async () => {
    const mockProvider = {
      listAccounts: vi.fn().mockRejectedValue(new Error('upstream 500: internal stack detail')),
    }
    createProvider.mockReturnValue(mockProvider as unknown as ReturnType<typeof createBankProvider>)

    const request = new NextRequest('http://localhost/api/integrations/verify', {
      method: 'POST',
      body: JSON.stringify({ companyId: 'company-1', provider: 'ponto', credentials: { clientId: 'c', clientSecret: 's' } }),
    })
    const response = await POST(request, { params: Promise.resolve({}) })
    const text = await response.text()

    expect(response.status).toBe(400)
    expect(text).not.toContain('internal stack detail')
    expect(JSON.parse(text)).toEqual({
      valid: false,
      error: 'Une erreur inattendue a interrompu la synchronisation. Réessayez dans quelques minutes.',
    })
    expect(createProvider).toHaveBeenCalledWith('PONTO', { clientId: 'c', clientSecret: 's' })
  })

  it('should return 400 if provider is missing', async () => {
    const request = new NextRequest('http://localhost/api/integrations/verify', {
      method: 'POST',
      body: JSON.stringify({
        companyId: 'company-1',
        credentials: {
          login: 'test@example.com',
          secretKey: 'secret-key',
        },
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('provider: Choisissez le fournisseur : Qonto ou Ponto.')
  })

  it('should return 400 if credentials are missing', async () => {
    const request = new NextRequest('http://localhost/api/integrations/verify', {
      method: 'POST',
      body: JSON.stringify({
        companyId: 'company-1',
        provider: 'QONTO',
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('credentials: Saisissez les identifiants de la connexion.')
  })

  it('should return 400 for unsupported provider', async () => {
    const request = new NextRequest('http://localhost/api/integrations/verify', {
      method: 'POST',
      body: JSON.stringify({
        companyId: 'company-1',
        provider: 'UNSUPPORTED',
        credentials: {
          login: 'test@example.com',
          secretKey: 'secret-key',
        },
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('Fournisseur non pris en charge')
  })
  it('should return 403 for a role without banking manage', async () => {
    const { getUserRolesForCompany } = await import('@/lib/rbac/authorize')
    vi.mocked(getUserRolesForCompany).mockResolvedValueOnce(['accountant'])

    const request = new NextRequest('http://localhost/api/integrations/verify', {
      method: 'POST',
      body: JSON.stringify({
        companyId: 'company-1',
        provider: 'QONTO',
        credentials: { login: 'test@example.com', secretKey: 'secret-key' },
      }),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(403)
    expect(createProvider).not.toHaveBeenCalled()
  })
})
