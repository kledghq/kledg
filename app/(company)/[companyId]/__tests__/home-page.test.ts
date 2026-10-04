/**
 * The company's home per display mode (docs/mode-simple.md): the dashboard
 * in expert mode (and for users who never chose), the simple home in simple
 * mode, except for links with parameters that target the dashboard (the
 * getting started guide).
 */

import { isValidElement, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ mode: null as string | null }))

vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn(async () => ({ id: 'u1', email: 'u1@test.local', name: null, role: 'user' })) }))
vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  }),
}))
vi.mock('@/components/features/dashboard/dashboard', () => ({ Dashboard: () => null }))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import HomePage from '../page'

const db = asPrismaMock(prisma)

function home(query: Record<string, string> = {}) {
  return HomePage({ params: Promise.resolve({ companyId: 'atelier-lumen' }), searchParams: Promise.resolve(query) })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.userPreference.findUnique.mockImplementation((async () => (state.mode ? { displayMode: state.mode } : null)) as never)
})

describe('company home', () => {
  it('shows the dashboard to a user who never chose a mode', async () => {
    state.mode = null
    const element = (await home()) as ReactElement<{ companyId: string }>
    expect(isValidElement(element)).toBe(true)
    expect(element.props.companyId).toBe('atelier-lumen')
    expect(db.userPreference.findUnique).toHaveBeenCalledWith({ where: { userId: 'u1' }, select: { displayMode: true } })
  })

  it('shows the dashboard in expert mode', async () => {
    state.mode = 'expert'
    expect(isValidElement(await home())).toBe(true)
  })

  it('opens the simple home in simple mode', async () => {
    state.mode = 'simple'
    await expect(home()).rejects.toThrow('NEXT_REDIRECT /atelier-lumen/simple')
  })

  it('keeps the dashboard for a link with parameters, in simple mode too', async () => {
    state.mode = 'simple'
    expect(isValidElement(await home({ guide: '1' }))).toBe(true)
  })
})
