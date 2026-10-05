/**
 * The group space replaces the company sidebar (docs/vue-groupe.md): in
 * /<holding>/group/... the menu lists only the group pages, the switcher
 * shows the group as the current selection, choosing a company opens its
 * own pages, the breadcrumb reads "Groupe <holding> > <page>", and on phones
 * the drawer closes after navigating, as in the company navigation.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ params: { companyId: 'alpha' } as Record<string, string>, pathname: '/alpha/group/treasury' }))
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useParams: () => nav.params, usePathname: () => nav.pathname, useRouter: () => router }))
vi.mock('@/lib/auth-client', () => ({ authClient: { useSession: () => ({ data: null }) } }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import type { GroupSummary } from '@/lib/group/get-group-summary.service'
import { AppSidebar } from '../app-sidebar'
import { DashboardBreadcrumb } from '../dashboard-breadcrumb'
import { GroupNav } from '../group-nav'
import { findGroupNavEntry, groupNavGroups, groupRelativePath } from '../group-nav-config'

const PHOTO = 'data:image/png;base64,iVBORw0KGgo='
const companies = [
  { id: 'c1', slug: 'alpha', name: 'Alpha Holding', legalType: 'SAS' },
  { id: 'c2', slug: 'beta', name: 'Beta', legalType: 'SARL' },
]
const summary: GroupSummary = {
  holding: { id: 'c1', slug: 'alpha', name: 'Alpha Holding', legalType: 'SAS', logo: null },
  name: 'Groupe Alpha Holding',
  readableCount: 2,
  unreadableCount: 1,
  mainShareholder: { name: 'Claire Vasseur', photo: PHOTO, percentBp: 6000, kind: 'person' },
}

const fetchMock = vi.fn<typeof fetch>()
let mobile = false

beforeEach(() => {
  nav.params = { companyId: 'alpha' }
  nav.pathname = '/alpha/group/treasury'
  mobile = false
  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => (mobile ? 375 : 1280) })
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/group/summary')) return Response.json(summary)
    if (url.startsWith('/api/companies/')) return Response.json({ name: 'Alpha Holding', legalType: null })
    return Response.json(companies)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: mobile, media: query, addEventListener: () => {}, removeEventListener: () => {} })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

const GROUP_PAGES = [
  "Vue d'ensemble",
  'Sociétés',
  'Comparaison',
  'Évolution',
  'Trésorerie',
  'Ratios',
  'Éliminations',
  'Participations',
  'Associés et dirigeants',
  'Impôts et échéances',
  'Transactions',
  'Grand livre combiné',
]

describe('group navigation', () => {
  it('lists the twelve group pages, in order, each with its own URL and icon', () => {
    const items = groupNavGroups.flatMap((g) => g.items)
    expect(items.map((i) => i.title)).toEqual(GROUP_PAGES)
    expect(new Set(items.map((i) => i.url)).size).toBe(12)
    expect(new Set(items.map((i) => i.icon)).size).toBe(12)
  })

  it('knows the group space paths', () => {
    expect(groupRelativePath('/group')).toBe('/')
    expect(groupRelativePath('/group/treasury')).toBe('/treasury')
    expect(groupRelativePath('/groupe')).toBeNull()
    expect(groupRelativePath('/entries')).toBeNull()
    expect(findGroupNavEntry('/ledger')?.title).toBe('Grand livre combiné')
    expect(findGroupNavEntry('/')?.title).toBe("Vue d'ensemble")
  })
})

describe('AppSidebar in the group space', () => {
  it('replaces the company menu with the group pages only', async () => {
    render(
      <SidebarProvider>
        <AppSidebar companies={companies} holdingRefs={['c1', 'alpha']} />
      </SidebarProvider>,
    )
    const menu = screen.getByRole('navigation', { name: 'Navigation du groupe' })
    expect(within(menu).getAllByRole('link').map((l) => l.textContent)).toEqual(GROUP_PAGES)
    expect(within(menu).getByRole('link', { name: 'Trésorerie' })).toHaveAttribute('aria-current', 'page')
    expect(within(menu).getByRole('link', { name: "Vue d'ensemble" })).toHaveAttribute('href', '/alpha/group')
    expect(within(menu).getByRole('link', { name: 'Grand livre combiné' })).toHaveAttribute('href', '/alpha/group/ledger')
    // No company page: neither Banque, Saisie nor États.
    for (const name of ['Tableau de bord', 'Comptes bancaires', 'Écritures', 'Bilan', 'Informations']) expect(screen.queryByRole('link', { name })).toBeNull()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/group/summary?companyId=alpha', { cache: 'no-store' }))
  })

  it('shows the group as the current selection of the switcher, with the main shareholder photo', async () => {
    const { container } = render(
      <SidebarProvider>
        <AppSidebar companies={companies} holdingRefs={['c1', 'alpha']} />
      </SidebarProvider>,
    )
    const trigger = await screen.findByRole('button', { name: /Groupe Alpha Holding/ })
    expect(trigger).toHaveTextContent('3 sociétés')
    expect(container.querySelector('[data-slot="person-avatar"] img')).toHaveAttribute('src', PHOTO)
  })

  it('checks the group, not the company, and opens a company with its own pages', async () => {
    const user = userEvent.setup()
    render(
      <SidebarProvider>
        <AppSidebar companies={companies} holdingRefs={['c1', 'alpha']} />
      </SidebarProvider>,
    )
    await user.click(await screen.findByRole('button', { name: /Groupe Alpha Holding/ }))
    const items = await screen.findAllByRole('menuitem')
    const group = items.find((i) => i.getAttribute('href') === '/alpha/group')
    const holdingCompany = items.find((i) => i.textContent?.includes('Alpha') && i.getAttribute('href') === null)
    expect(group?.querySelector('svg.lucide-check')).not.toBeNull()
    expect(holdingCompany?.querySelector('svg.lucide-check')).toBeNull()
    await user.click(items.find((i) => i.textContent?.includes('Beta'))!)
    expect(router.push).toHaveBeenCalledWith('/beta')
  })

  it('opens the holding itself, out of the group, from the switcher', async () => {
    const user = userEvent.setup()
    render(
      <SidebarProvider>
        <AppSidebar companies={companies} holdingRefs={['c1', 'alpha']} />
      </SidebarProvider>,
    )
    await user.click(await screen.findByRole('button', { name: /Groupe Alpha Holding/ }))
    const items = await screen.findAllByRole('menuitem')
    await user.click(items.find((i) => i.textContent?.includes('Alpha') && i.getAttribute('href') === null)!)
    expect(router.push).toHaveBeenCalledWith('/alpha')
  })

  it('keeps the company navigation outside the group space', () => {
    nav.pathname = '/alpha/entries'
    render(
      <SidebarProvider>
        <AppSidebar companies={companies} holdingRefs={['c1', 'alpha']} />
      </SidebarProvider>,
    )
    expect(screen.queryByRole('navigation', { name: 'Navigation du groupe' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Écritures' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/group/summary'), expect.anything())
  })
})

describe('group navigation on phones', () => {
  function OpenDrawer() {
    const { setOpenMobile, openMobile } = useSidebar()
    return (
      <button type="button" onClick={() => setOpenMobile(true)}>
        {openMobile ? 'Menu ouvert' : 'Menu fermé'}
      </button>
    )
  }

  it('closes the drawer after choosing a page', async () => {
    mobile = true
    const user = userEvent.setup()
    render(
      <SidebarProvider>
        <OpenDrawer />
        <GroupNav />
      </SidebarProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Menu fermé' }))
    expect(screen.getByRole('button', { name: 'Menu ouvert' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Ratios' }))
    expect(screen.getByRole('button', { name: 'Menu fermé' })).toBeInTheDocument()
  })
})

describe('breadcrumb of the group space', () => {
  it('reads Groupe <holding> > <page> and names the tab after it', async () => {
    render(<DashboardBreadcrumb />)
    expect(await screen.findByRole('link', { name: 'Groupe Alpha Holding' })).toHaveAttribute('href', '/alpha/group')
    expect(screen.getByText('Trésorerie')).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Trésorerie · Groupe Alpha Holding · Kledg'))
  })

  it("shows only the group's name on the overview", async () => {
    nav.pathname = '/alpha/group'
    render(<DashboardBreadcrumb />)
    const current = await screen.findByText('Groupe Alpha Holding')
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).not.toHaveAttribute('href')
  })
})
