/**
 * The companies page authorizes by itself: a layout does not protect the
 * page it wraps (Next renders layouts and pages in parallel, and a client
 * navigation fetches the page segment without re-running the layout), so an
 * anonymous render must never query companies.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ user: null as null | { id: string; email: string; name: string | null; role: string | null } }))

vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn(async () => state.user) }))
vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  }),
}))
vi.mock('@/components/shared', () => ({ PageHeader: () => null }))
vi.mock('@/components/features/companies/companies-list', () => ({ CompaniesList: () => null }))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import CompaniesPage from '../page'

const db = asPrismaMock(prisma)

describe('companies page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.company.findMany.mockResolvedValue([{ id: 'c1', name: 'Alpha' }])
  })

  it('redirects an anonymous visitor to the sign-in page without listing any company', async () => {
    state.user = null
    await expect(CompaniesPage()).rejects.toThrow('NEXT_REDIRECT /login')
    expect(db.company.findMany).not.toHaveBeenCalled()
  })

  it('lists only the companies a member belongs to', async () => {
    state.user = { id: 'u1', email: 'u1@test.local', name: null, role: 'user' }
    await CompaniesPage()
    expect(db.company.findMany.mock.calls[0][0]?.where).toMatchObject({ organization: { members: { some: { userId: 'u1' } } } })
  })

  it('lists every company that is not archived to an instance administrator', async () => {
    state.user = { id: 'a1', email: 'a1@test.local', name: null, role: 'admin' }
    await CompaniesPage()
    expect(db.company.findMany.mock.calls[0][0]?.where).toEqual({ archivedAt: null })
  })
})
