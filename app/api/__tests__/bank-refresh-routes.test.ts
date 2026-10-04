/**
 * POST /api/tasks/refresh and POST /api/banking/reconciliation/auto-reconcile:
 * zod bodies (French 400), the reconcile permission, and the values handed to
 * the services.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Archived companies are read-only (lib/companies/archive-company.service.ts): none here.
vi.mock('@/lib/companies/archive-company.service', () => ({ assertCompanyWritable: async () => undefined }))
vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'compta@example.com', name: null, role: null }),
}))
vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return { ...actual, getUserRolesForCompany: vi.fn().mockResolvedValue(['companyAdmin']), isGlobalAdmin: vi.fn().mockReturnValue(false) }
})
vi.mock('@/lib/companies/slug', () => ({ resolveCompanyRef: vi.fn(async (ref: string) => ref) }))
vi.mock('@/lib/banking/guard', () => ({ limitBankCalls: vi.fn(async () => {}) }))
vi.mock('@/lib/tasks/refresh-company', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tasks/refresh-company')>('@/lib/tasks/refresh-company')
  return { ...actual, refreshCompany: vi.fn(async () => ({ bankSync: { success: true } })) }
})
vi.mock('@/lib/services/banking/reconciliation-service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/banking/reconciliation-service')>(
    '@/lib/services/banking/reconciliation-service',
  )
  return { ...actual, autoReconcile: vi.fn(async () => ({ success: true, matched: 0 })) }
})

import { POST as refresh } from '../tasks/refresh/route'
import { POST as autoReconcileRoute } from '../banking/reconciliation/auto-reconcile/route'
import { refreshCompany } from '@/lib/tasks/refresh-company'
import { autoReconcile } from '@/lib/services/banking/reconciliation-service'
import { getUserRolesForCompany } from '@/lib/rbac/authorize'
import { limitBankCalls } from '@/lib/banking/guard'

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/tasks/refresh', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refreshes with the default window when maxDays is absent', async () => {
    const response = await refresh(post('/api/tasks/refresh', { companyId: 'company-1' }))
    expect(response.status).toBe(200)
    expect(limitBankCalls).toHaveBeenCalledWith('company-1')
    expect(refreshCompany).toHaveBeenCalledWith('company-1', undefined)
  })

  it('passes a valid maxDays and refuses an invalid one in French', async () => {
    await refresh(post('/api/tasks/refresh', { companyId: 'company-1', maxDays: 90 }))
    expect(refreshCompany).toHaveBeenCalledWith('company-1', 90)

    const response = await refresh(post('/api/tasks/refresh', { companyId: 'company-1', maxDays: '90' }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('Le nombre de jours doit être un nombre')
    expect(refreshCompany).toHaveBeenCalledTimes(1)
  })

  it('refuses a viewer (403) before reading the body', async () => {
    vi.mocked(getUserRolesForCompany).mockResolvedValueOnce(['viewer'])
    const response = await refresh(post('/api/tasks/refresh', { companyId: 'company-1', maxDays: 'x' }))
    expect(response.status).toBe(403)
    expect(refreshCompany).not.toHaveBeenCalled()
  })
})

describe('POST /api/banking/reconciliation/auto-reconcile', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes the period of the page to the service', async () => {
    const response = await autoReconcileRoute(
      post('/api/banking/reconciliation/auto-reconcile', {
        companyId: 'company-1',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-03-31T23:59:59.999Z',
      }),
    )
    expect(response.status).toBe(200)
    expect(autoReconcile).toHaveBeenCalledWith({
      companyId: 'company-1',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-03-31T23:59:59.999Z',
    })
  })

  it('reconciles without a period and refuses an unreadable date', async () => {
    await autoReconcileRoute(post('/api/banking/reconciliation/auto-reconcile', { companyId: 'company-1' }))
    expect(autoReconcile).toHaveBeenCalledWith({ companyId: 'company-1' })

    const response = await autoReconcileRoute(
      post('/api/banking/reconciliation/auto-reconcile', { companyId: 'company-1', startDate: '31/01/2026' }),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('Date invalide')
    expect(autoReconcile).toHaveBeenCalledTimes(1)
  })
})
