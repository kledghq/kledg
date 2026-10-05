/**
 * The group space replaces the company sidebar (docs/vue-groupe.md): in
 * /<holding>/group/... the menu lists only the group views of the user's
 * display mode (five in expert mode, four plain pages in simple mode), the
 * old pages of the first group space redirect to their view, the switcher
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
import { findGroupNavEntry, groupHomePath, groupNavGroups, groupRelativePath, groupTabUrl, LEGACY_GROUP_PAGES, legacyGroupUrl, simpleGroupNavGroups } from '../group-nav-config'

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
  shareholders: [
    { name: 'Claire Vasseur', photo: PHOTO, percentBp: 6000, kind: 'person' },
    { name: 'Marc Vasseur', photo: null, percentBp: 4000, kind: 'person' },
  ],
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

const GROUP_VIEWS_TITLES = ['Pilotage', 'Structure', 'Trésorerie', 'Fiscalité', 'Opérations']
const GROUP_PAGES = [
  'Synthèse', 'N et N-1', 'Évolution', 'Ratios',
  'Organigramme', 'Associés et dirigeants', 'Participations', 'Sociétés',
  'Soldes et perspectives', 'Flux entre sociétés',
  'Impôt sur les sociétés', 'Intégration fiscale', 'Échéances',
  'Transactions', 'Grand livre combiné', 'Éliminations',
]
const SIMPLE_GROUP_PAGES = ['Accueil du groupe', 'Mes sociétés', 'Qui possède quoi', 'Argent entre mes sociétés']

describe('group navigation', () => {
  it('groups the pages of the five views in expert mode and lists the four plain pages in simple mode, each with its own URL and icon', () => {
    expect(groupNavGroups.map((g) => g.label)).toEqual(GROUP_VIEWS_TITLES)
    const items = groupNavGroups.flatMap((g) => g.items)
    expect(items.map((i) => i.title)).toEqual(GROUP_PAGES)
    expect(new Set(items.map((i) => i.url)).size).toBe(GROUP_PAGES.length)
    expect(new Set(items.map((i) => i.icon)).size).toBe(GROUP_PAGES.length)
    const simple = simpleGroupNavGroups.flatMap((g) => g.items)
    expect(simple.map((i) => i.title)).toEqual(SIMPLE_GROUP_PAGES)
    expect(simple.every((i) => i.url.startsWith('/simple'))).toBe(true)
    expect(groupHomePath('alpha', 'expert')).toBe('/alpha/group')
    expect(groupHomePath('alpha', 'simple')).toBe('/alpha/group/simple')
  })

  it('sends every page of the first group space that moved to its page now', () => {
    expect(Object.keys(LEGACY_GROUP_PAGES).sort()).toEqual(['/companies', '/deadlines', '/eliminations', '/ledger', '/participations', '/persons', '/transactions'])
    expect(legacyGroupUrl('alpha', '/companies')).toBe('/alpha/group/structure/companies')
    expect(legacyGroupUrl('alpha', '/deadlines')).toBe('/alpha/group/tax/deadlines')
    expect(legacyGroupUrl('alpha', '/ledger')).toBe('/alpha/group/operations/ledger')
    expect(legacyGroupUrl('alpha', '/transactions')).toBe('/alpha/group/operations')
    expect(legacyGroupUrl('alpha', '/unknown')).toBe('/alpha/group')
    // Every target is a page of the sidebar.
    const urls = groupNavGroups.flatMap((g) => g.items.map((i) => i.url))
    for (const target of Object.values(LEGACY_GROUP_PAGES)) expect(urls).toContain(target)
  })

  it('sends a link to a former tab of a view (?vue=) to its page', () => {
    expect(groupTabUrl('alpha', 'pilotage', 'ratios')).toBe('/alpha/group/ratios')
    expect(groupTabUrl('alpha', 'structure', 'societes')).toBe('/alpha/group/structure/companies')
    expect(groupTabUrl('alpha', 'tax', 'integration')).toBe('/alpha/group/tax/integration')
    expect(groupTabUrl('alpha', 'operations', 'grand-livre')).toBe('/alpha/group/operations/ledger')
    // The first page is the view itself; an unknown or missing tab stays there.
    expect(groupTabUrl('alpha', 'treasury', 'soldes')).toBeNull()
    expect(groupTabUrl('alpha', 'treasury', 'nope')).toBeNull()
    expect(groupTabUrl('alpha', 'treasury', undefined)).toBeNull()
  })

  it('knows the group space paths', () => {
    expect(groupRelativePath('/group')).toBe('/')
    expect(groupRelativePath('/group/treasury')).toBe('/treasury')
    expect(groupRelativePath('/groupe')).toBeNull()
    expect(groupRelativePath('/entries')).toBeNull()
    expect(findGroupNavEntry('/operations')).toMatchObject({ group: 'Opérations', title: 'Transactions' })
    expect(findGroupNavEntry('/operations/ledger')).toMatchObject({ group: 'Opérations', title: 'Grand livre combiné' })
    expect(findGroupNavEntry('/')).toMatchObject({ group: 'Pilotage', title: 'Synthèse' })
    expect(findGroupNavEntry('/ratios')?.title).toBe('Ratios')
    expect(findGroupNavEntry('/simple')?.title).toBe('Accueil du groupe')
    expect(findGroupNavEntry('/simple/societes')?.title).toBe('Mes sociétés')
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
    for (const title of GROUP_VIEWS_TITLES) expect(within(menu).getByText(title)).toBeInTheDocument()
    // One entry is active: the view's first page, not the pages nested under it.
    expect(within(menu).getByRole('link', { name: 'Soldes et perspectives' })).toHaveAttribute('aria-current', 'page')
    expect(within(menu).getByRole('link', { name: 'Flux entre sociétés' })).not.toHaveAttribute('aria-current')
    expect(within(menu).getByRole('link', { name: 'Synthèse' })).toHaveAttribute('href', '/alpha/group')
    expect(within(menu).getByRole('link', { name: 'Grand livre combiné' })).toHaveAttribute('href', '/alpha/group/operations/ledger')
    // No company page: neither Banque, Saisie nor États.
    for (const name of ['Tableau de bord', 'Comptes bancaires', 'Écritures', 'Bilan', 'Informations']) expect(screen.queryByRole('link', { name })).toBeNull()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/group/summary?companyId=alpha', { cache: 'no-store' }))
  })

  it('shows the plain group pages in simple mode', () => {
    nav.pathname = '/alpha/group/simple/societes'
    render(
      <SidebarProvider>
        <AppSidebar companies={companies} holdingRefs={['c1', 'alpha']} mode="simple" />
      </SidebarProvider>,
    )
    const menu = screen.getByRole('navigation', { name: 'Navigation du groupe' })
    expect(within(menu).getAllByRole('link').map((l) => l.textContent)).toEqual(SIMPLE_GROUP_PAGES)
    expect(within(menu).getByRole('link', { name: 'Mes sociétés' })).toHaveAttribute('aria-current', 'page')
    expect(within(menu).getByRole('link', { name: 'Accueil du groupe' })).toHaveAttribute('href', '/alpha/group/simple')
    expect(within(menu).queryByRole('link', { name: 'Transactions' })).toBeNull()
  })

  it("shows the group as the current selection of the switcher, with the holding's shareholders", async () => {
    render(
      <SidebarProvider>
        <AppSidebar companies={companies} holdingRefs={['c1', 'alpha']} />
      </SidebarProvider>,
    )
    const trigger = await screen.findByRole('button', { name: /Groupe Alpha Holding/ })
    expect(trigger).toHaveTextContent('3 sociétés')
    const stack = within(trigger).getByRole('group', { name: 'Associés de la holding' })
    expect(within(stack).getByRole('img', { name: 'Claire Vasseur, 60\u00a0%' }).querySelector('img')).toHaveAttribute('src', PHOTO)
    expect(within(stack).getByRole('img', { name: 'Marc Vasseur, 40\u00a0%' })).toHaveTextContent('MV')
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
    await user.click(screen.getByRole('link', { name: 'Échéances' }))
    expect(screen.getByRole('button', { name: 'Menu fermé' })).toBeInTheDocument()
  })
})

describe('breadcrumb of the group space', () => {
  it('reads Groupe <holding> > <view> > <page> and names the tab after the page', async () => {
    nav.pathname = '/alpha/group/treasury/flows'
    render(<DashboardBreadcrumb />)
    expect(await screen.findByRole('link', { name: 'Groupe Alpha Holding' })).toHaveAttribute('href', '/alpha/group')
    expect(screen.getByText('Trésorerie')).toBeInTheDocument()
    expect(screen.getByText('Flux entre sociétés')).toHaveAttribute('aria-current', 'page')
    await waitFor(() => expect(document.title).toBe('Flux entre sociétés · Groupe Alpha Holding · Kledg'))
  })

  it('names the simple pages and links the group to its simple home', async () => {
    nav.pathname = '/alpha/group/simple/argent-entre-societes'
    render(<DashboardBreadcrumb mode="simple" />)
    expect(await screen.findByRole('link', { name: 'Groupe Alpha Holding' })).toHaveAttribute('href', '/alpha/group/simple')
    expect(screen.getByText('Argent entre mes sociétés')).toBeInTheDocument()
  })

  it("shows only the group's name on the group's home", async () => {
    nav.pathname = '/alpha/group'
    render(<DashboardBreadcrumb />)
    const current = await screen.findByText('Groupe Alpha Holding')
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).not.toHaveAttribute('href')
  })
})
