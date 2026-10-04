/**
 * The account layout frames the pages outside a company. The last-company
 * cookie is only a hint: the "Retour à" link names a company only when the
 * user can still open it.
 */

import { isValidElement, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; name: string | null; role: string | null },
  cookie: undefined as string | undefined,
  instanceLinks: null as null | Record<string, string>,
}))

vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn(async () => state.user) }))
vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => (name === 'kledg_last_company' && state.cookie ? { value: state.cookie } : undefined) })),
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  }),
}))
vi.mock('@/lib/updates/version', () => ({ getDeployedVersion: () => ({ version: '1.3.0', commit: 'abc1234' }) }))
vi.mock('@/components/instance/slots', () => ({ instanceSettingsLinks: vi.fn(async () => state.instanceLinks) }))
vi.mock('@/components/layout/app-shell', () => ({ AppShell: () => null }))
vi.mock('@/components/layout/settings-sidebar', () => ({ SettingsSidebar: () => null }))
vi.mock('@/components/layout/settings-breadcrumb', () => ({ SettingsBreadcrumb: () => null }))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { instanceSettingsLinks } from '@/components/instance/slots'
import AccountLayout from '../layout'

const db = asPrismaMock(prisma)

type SidebarProps = { lastCompany: { slug: string; name: string } | null; isAdmin: boolean; version: unknown; instanceLinks: unknown }
type ShellProps = { sidebar: ReactElement<SidebarProps>; breadcrumb: ReactElement<{ instanceLinks: unknown }>; isAdmin: boolean; children: unknown }

async function shell(): Promise<ShellProps> {
  const element = (await AccountLayout({ children: 'page' })) as ReactElement<ShellProps>
  expect(isValidElement(element)).toBe(true)
  return element.props
}

beforeEach(() => {
  vi.clearAllMocks()
  state.user = { id: 'u1', email: 'u1@test.local', name: null, role: 'user' }
  state.cookie = undefined
  state.instanceLinks = null
  db.company.findFirst.mockResolvedValue({ slug: 'alpha', name: 'Alpha SAS' })
})

describe('account layout', () => {
  it('sends an anonymous visitor to the sign-in page', async () => {
    state.user = null
    await expect(AccountLayout({ children: 'page' })).rejects.toThrow('NEXT_REDIRECT /login')
  })

  it('offers the way back to the last company only among the companies the member belongs to', async () => {
    state.cookie = 'alpha'
    const props = await shell()
    expect(props.sidebar.props.lastCompany).toEqual({ slug: 'alpha', name: 'Alpha SAS' })
    expect(db.company.findFirst).toHaveBeenCalledWith({
      where: { slug: 'alpha', organization: { members: { some: { userId: 'u1' } } } },
      select: { slug: true, name: true },
    })
    expect(props.children).toBe('page')
    expect(props.isAdmin).toBe(false)
    expect(props.sidebar.props.version).toEqual({ version: '1.3.0', commit: 'abc1234' })
  })

  it('names no company the user lost access to', async () => {
    state.cookie = 'beta'
    db.company.findFirst.mockResolvedValue(null)
    expect((await shell()).sidebar.props.lastCompany).toBeNull()
  })

  it('ignores a missing or malformed cookie without querying', async () => {
    expect((await shell()).sidebar.props.lastCompany).toBeNull()
    state.cookie = 'Alpha SAS; DROP'
    expect((await shell()).sidebar.props.lastCompany).toBeNull()
    expect(db.company.findFirst).not.toHaveBeenCalled()
  })

  it('looks up any company for an instance administrator, and asks no instance links', async () => {
    state.user = { id: 'a1', email: 'a1@test.local', name: null, role: 'admin' }
    state.cookie = 'alpha'
    const props = await shell()
    expect(db.company.findFirst).toHaveBeenCalledWith({ where: { slug: 'alpha' }, select: { slug: true, name: true } })
    expect(props.isAdmin).toBe(true)
    expect(props.sidebar.props.isAdmin).toBe(true)
    expect(instanceSettingsLinks).not.toHaveBeenCalled()
  })

  it('hands a member the instance links to the sidebar and breadcrumb', async () => {
    state.instanceLinks = { updates: 'https://instance.example/updates' }
    const props = await shell()
    expect(props.sidebar.props.instanceLinks).toEqual({ updates: 'https://instance.example/updates' })
    expect(props.breadcrumb.props.instanceLinks).toEqual({ updates: 'https://instance.example/updates' })
  })
})
