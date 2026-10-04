/**
 * The company layout is the access check of every company page: an
 * anonymous visitor goes to the sign-in page, a user without a role in the
 * company is sent to the companies list exactly like for a missing company
 * (ids of other companies are never confirmed), and a raw id is redirected
 * permanently to the slug URL.
 */

import { isValidElement, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; name: string | null; role: string | null },
  roles: [] as string[],
  path: null as string | null,
}))

vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn(async () => state.user) }))
vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/rbac/authorize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rbac/authorize')>()),
  getUserRolesForCompany: vi.fn(async () => state.roles),
}))
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers(state.path ? { 'x-kledg-path': state.path } : {})),
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  }),
  permanentRedirect: vi.fn((to: string) => {
    throw new Error(`NEXT_PERMANENT_REDIRECT ${to}`)
  }),
}))
vi.mock('@/components/features/companies/company-access', () => ({ CompanyAccessProvider: () => null }))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { getUserRolesForCompany } from '@/lib/rbac/authorize'
import CompanyLayout from '../layout'

const db = asPrismaMock(prisma)
const company = { id: 'cmp_123', slug: 'atelier-lumen' }

function layout(ref: string) {
  return CompanyLayout({ children: 'page', params: Promise.resolve({ companyId: ref }) })
}

type ProviderProps = { value: { granted: Record<string, string[]>; roleLabel: string }; children: unknown }

async function providerProps(ref: string): Promise<ProviderProps> {
  const element = (await layout(ref)) as ReactElement<ProviderProps>
  expect(isValidElement(element)).toBe(true)
  return element.props
}

beforeEach(() => {
  vi.clearAllMocks()
  state.user = { id: 'u1', email: 'u1@test.local', name: null, role: 'user' }
  state.roles = ['accountant']
  state.path = null
  db.company.findUnique.mockImplementation(async (args) =>
    args.where.slug === company.slug || args.where.id === company.id ? company : null,
  )
})

describe('company layout', () => {
  it('sends an anonymous visitor to the sign-in page without reading the company', async () => {
    state.user = null
    await expect(layout('atelier-lumen')).rejects.toThrow('NEXT_REDIRECT /login')
    expect(db.company.findUnique).not.toHaveBeenCalled()
  })

  it('sends a user without a role in the company to the companies list, like a missing company', async () => {
    state.roles = []
    await expect(layout('atelier-lumen')).rejects.toThrow('NEXT_REDIRECT /companies')
    expect(getUserRolesForCompany).toHaveBeenCalledWith('u1', 'cmp_123')
    await expect(layout('unknown-company')).rejects.toThrow('NEXT_REDIRECT /companies')
  })

  it('checks the role before redirecting an id, so a non-member never learns the slug', async () => {
    state.roles = []
    await expect(layout('cmp_123')).rejects.toThrow('NEXT_REDIRECT /companies')
  })

  it('hands the page what the role may do', async () => {
    const props = await providerProps('atelier-lumen')
    expect(props.children).toBe('page')
    expect(props.value.roleLabel).toBe('Comptable')
    expect(props.value.granted.entries).toEqual(['read', 'create', 'update', 'delete', 'validate'])
    expect(props.value.granted.settings).toEqual(['read'])
    expect(props.value.granted.members).toBeUndefined()
  })

  it('gives an instance administrator every permission without reading roles', async () => {
    state.user = { id: 'a1', email: 'a1@test.local', name: null, role: 'admin' }
    state.roles = []
    const props = await providerProps('atelier-lumen')
    expect(props.value.roleLabel).toBe("Administrateur de l'instance")
    expect(props.value.granted.members).toEqual(['manage'])
    expect(props.value.granted.settings).toEqual(['read', 'update'])
    expect(getUserRolesForCompany).not.toHaveBeenCalled()
  })

  it('redirects a raw id permanently to the same page under the slug', async () => {
    state.path = '/cmp_123/reports/balance-sheet?variant=simplified'
    await expect(layout('cmp_123')).rejects.toThrow('NEXT_PERMANENT_REDIRECT /atelier-lumen/reports/balance-sheet?variant=simplified')
    state.path = '/cmp_123?tab=2'
    await expect(layout('cmp_123')).rejects.toThrow('NEXT_PERMANENT_REDIRECT /atelier-lumen?tab=2')
    state.path = null
    await expect(layout('cmp_123')).rejects.toThrow(/^NEXT_PERMANENT_REDIRECT \/atelier-lumen$/)
  })

  it('does not carry over a path that does not start with the id', async () => {
    state.path = '/cmp_1234/entries'
    await expect(layout('cmp_123')).rejects.toThrow(/^NEXT_PERMANENT_REDIRECT \/atelier-lumen$/)
  })
})
