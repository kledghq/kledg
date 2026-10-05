/**
 * The group's home per display mode (docs/vue-groupe.md): Pilotage in
 * expert mode, the simple group home in simple mode (except a link that
 * names a page), links to the former tabs of a view (?vue=) opening their
 * page, and the pages of the first group space redirecting to their page.
 */

import { isValidElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ mode: null as string | null }))

vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn(async () => ({ id: 'u1', email: 'u1@test.local', name: null, role: 'user' })) }))
vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  }),
  permanentRedirect: vi.fn((to: string) => {
    throw new Error(`NEXT_PERMANENT_REDIRECT ${to}`)
  }),
}))
vi.mock('@/components/features/group/pilotage-view', () => ({ GroupPilotageView: () => null }))
vi.mock('@/components/features/group/structure-view', () => ({ GroupStructureView: () => null }))
vi.mock('@/components/features/group/tax-view', () => ({ GroupTaxView: () => null }))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import GroupHome from '../page'
import CompaniesPage from '../companies/page'
import DeadlinesPage from '../deadlines/page'
import TransactionsPage from '../transactions/page'
import StructurePage from '../structure/page'
import TaxPage from '../tax/page'

const db = asPrismaMock(prisma)
const params = Promise.resolve({ companyId: 'lumen-holding' })

beforeEach(() => {
  vi.clearAllMocks()
  db.userPreference.findUnique.mockImplementation((async () => (state.mode ? { displayMode: state.mode } : null)) as never)
})

describe('group home', () => {
  it('shows Pilotage in expert mode and to a user who never chose', async () => {
    state.mode = null
    expect(isValidElement(await GroupHome({ params, searchParams: Promise.resolve({}) }))).toBe(true)
    state.mode = 'expert'
    expect(isValidElement(await GroupHome({ params, searchParams: Promise.resolve({}) }))).toBe(true)
  })

  it('opens the simple group home in simple mode, unless a page is named', async () => {
    state.mode = 'simple'
    await expect(GroupHome({ params, searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT /lumen-holding/group/simple')
    await expect(GroupHome({ params, searchParams: Promise.resolve({ vue: 'ratios' }) })).rejects.toThrow('NEXT_REDIRECT /lumen-holding/group/ratios')
  })

  it('opens the page of a former tab of a view (?vue=)', async () => {
    state.mode = 'expert'
    await expect(GroupHome({ params, searchParams: Promise.resolve({ vue: 'comparaison' }) })).rejects.toThrow('NEXT_REDIRECT /lumen-holding/group/comparison')
    await expect(StructurePage({ params, searchParams: Promise.resolve({ vue: 'societes' }) })).rejects.toThrow('NEXT_REDIRECT /lumen-holding/group/structure/companies')
    await expect(TaxPage({ params, searchParams: Promise.resolve({ vue: 'echeances' }) })).rejects.toThrow('NEXT_REDIRECT /lumen-holding/group/tax/deadlines')
    expect(isValidElement(await StructurePage({ params, searchParams: Promise.resolve({}) }))).toBe(true)
    expect(isValidElement(await TaxPage({ params, searchParams: Promise.resolve({ vue: 'impot' }) }))).toBe(true)
  })
})

describe('pages of the first group space', () => {
  it('redirect permanently to their page', async () => {
    await expect(CompaniesPage({ params })).rejects.toThrow('NEXT_PERMANENT_REDIRECT /lumen-holding/group/structure/companies')
    await expect(DeadlinesPage({ params })).rejects.toThrow('NEXT_PERMANENT_REDIRECT /lumen-holding/group/tax/deadlines')
    await expect(TransactionsPage({ params })).rejects.toThrow('NEXT_PERMANENT_REDIRECT /lumen-holding/group/operations')
  })
})
