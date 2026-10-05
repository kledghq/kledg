/**
 * Navigation per display mode (docs/mode-simple.md): the simple sidebar,
 * its count, the Simple / Expert switch and the breadcrumb of each mode.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

const nav = vi.hoisted(() => ({ params: { companyId: 'alpha' } as Record<string, string>, pathname: '/alpha/simple' }))
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useParams: () => nav.params, usePathname: () => nav.pathname, useRouter: () => router }))
vi.mock('@/lib/auth-client', () => ({ authClient: { useSession: () => ({ data: null }) } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { SidebarProvider } from '@/components/ui/sidebar'
import { findNavEntry, navGroups, navGroupsFor, simpleNavGroups } from '../nav-config'
import { NavMain } from '../nav-main'
import { DisplayModeSwitch } from '../display-mode-switch'
import { DashboardBreadcrumb } from '../dashboard-breadcrumb'
import { AppSidebar, SIMPLE_COUNTS_REFRESH_EVENT } from '../app-sidebar'

const fetchMock = vi.fn()

beforeEach(() => {
  nav.params = { companyId: 'alpha' }
  nav.pathname = '/alpha/simple'
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

const inSidebar = (ui: React.ReactNode) => render(<SidebarProvider>{ui}</SidebarProvider>)

describe('simple navigation', () => {
  const items = simpleNavGroups.flatMap((group) => group.items)

  it('lists the seven entries of the mockup, each with its own icon and URL', () => {
    expect(items.map((item) => item.title)).toEqual(['Accueil', 'Dépenses', 'Recettes', 'Factures', 'Banque', 'Justificatifs', 'Mon comptable'])
    expect(new Set(items.map((item) => item.icon)).size).toBe(items.length)
    expect(new Set(items.map((item) => item.url)).size).toBe(items.length)
  })

  it('opens existing pages, and leaves the expert pages out of the sidebar only', () => {
    expect(Object.fromEntries(items.map((item) => [item.title, item.url]))).toEqual({
      Accueil: '/simple',
      Dépenses: '/simple/depenses',
      Recettes: '/invoices/sales',
      Factures: '/invoices/purchases',
      Banque: '/banking',
      Justificatifs: '/banking/missing-receipts',
      'Mon comptable': '/members',
    })
    expect(navGroupsFor('simple')).toBe(simpleNavGroups)
    expect(navGroupsFor('expert')).toBe(navGroups)
    // Expert pages keep their own entry for the expert mode
    expect(findNavEntry('/entries', simpleNavGroups)).toBeNull()
    expect(findNavEntry('/entries')?.title).toBe('Écritures')
    expect(findNavEntry('/banking/missing-receipts', simpleNavGroups)?.title).toBe('Justificatifs')
    expect(findNavEntry('/simple/depenses', simpleNavGroups)?.title).toBe('Dépenses')
  })

  it('renders the simple entries with the company prefix, the active one and the count to check', () => {
    inSidebar(<NavMain groups={simpleNavGroups} counts={{ expensesToCheck: 5 }} />)
    expect(screen.getByRole('link', { name: 'Accueil' })).toHaveAttribute('aria-current', 'page')
    const expenses = screen.getByRole('link', { name: /Dépenses/ })
    expect(expenses).toHaveAttribute('href', '/alpha/simple/depenses')
    expect(expenses).toHaveAccessibleName('Dépenses, 5 à vérifier')
    expect(screen.getByText('5', { selector: '[data-sidebar="menu-badge"]' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Mon comptable' })).toHaveAttribute('href', '/alpha/members')
    expect(screen.queryByRole('link', { name: 'Écritures' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Tableau de bord' })).toBeNull()
  })

  it('shows no count when there is nothing to check', () => {
    inSidebar(<NavMain groups={simpleNavGroups} counts={{ expensesToCheck: 0 }} />)
    expect(screen.getByRole('link', { name: 'Dépenses' })).toBeInTheDocument()
    expect(document.querySelector('[data-sidebar="menu-badge"]')).toBeNull()
  })
})

describe('AppSidebar per mode', () => {
  it('shows the expert navigation by default and fetches no count', () => {
    nav.pathname = '/alpha'
    inSidebar(<AppSidebar companies={[]} />)
    expect(screen.getByRole('link', { name: 'Tableau de bord' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Accueil' })).toBeNull()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/simple/counts'))).toBe(false)
  })

  it('shows the simple navigation with the count of the company, refreshed on demand', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/simple/counts') ? Response.json({ expensesToCheck: 3 }) : Response.json([]),
    )
    inSidebar(<AppSidebar companies={[]} mode="simple" />)
    expect(screen.queryByRole('link', { name: 'Tableau de bord' })).toBeNull()
    expect(await screen.findByRole('link', { name: 'Dépenses, 3 à vérifier' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/companies/alpha/simple/counts')
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/simple/counts') ? Response.json({ expensesToCheck: 1 }) : Response.json([]),
    )
    window.dispatchEvent(new Event(SIMPLE_COUNTS_REFRESH_EVENT))
    expect(await screen.findByRole('link', { name: 'Dépenses, 1 à vérifier' })).toBeInTheDocument()
    // The display mode switch is in the header now, not in the sidebar.
    expect(screen.queryByRole('group', { name: 'Affichage' })).toBeNull()
  })
})

describe('DisplayModeSwitch', () => {
  it('saves the mode and opens the home of the chosen mode in the current company', async () => {
    fetchMock.mockResolvedValue(Response.json({ mode: 'simple', chosen: true }))
    const user = userEvent.setup()
    nav.pathname = '/alpha/journals'
    inSidebar(<DisplayModeSwitch mode="expert" />)
    const group = screen.getByRole('group', { name: 'Affichage' })
    expect(within(group).getByRole('radio', { name: 'Expert' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(group).getByRole('radio', { name: 'Simple' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/alpha/simple'))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/account/display-mode')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'simple' })
    expect(router.refresh).toHaveBeenCalled()
  })

  it('goes back to the dashboard in expert mode, and does nothing for the current mode', async () => {
    fetchMock.mockResolvedValue(Response.json({ mode: 'expert', chosen: true }))
    const user = userEvent.setup()
    inSidebar(<DisplayModeSwitch mode="simple" />)
    await user.click(screen.getByRole('radio', { name: 'Simple' }))
    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('radio', { name: 'Expert' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/alpha'))
  })

  it('keeps the previous mode and says why when saving fails', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Requête refusée.' }, { status: 403 }))
    const user = userEvent.setup()
    inSidebar(<DisplayModeSwitch mode="expert" />)
    await user.click(screen.getByRole('radio', { name: 'Simple' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Requête refusée.'))
    expect(screen.getByRole('radio', { name: 'Expert' })).toHaveAttribute('aria-checked', 'true')
    expect(router.push).not.toHaveBeenCalled()
  })
})

describe('DashboardBreadcrumb per mode', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(Response.json({ name: 'Alpha', legalType: null }))
  })

  it('names the simple home Accueil and uses the simple titles', async () => {
    nav.pathname = '/alpha/simple'
    const { unmount } = render(<DashboardBreadcrumb mode="simple" />)
    await waitFor(() => expect(document.title).toBe('Accueil · Alpha · Kledg'))
    unmount()
    nav.pathname = '/alpha/banking/missing-receipts'
    render(<DashboardBreadcrumb mode="simple" />)
    expect(await screen.findByText('Justificatifs')).toBeInTheDocument()
    expect(screen.queryByText('Justificatifs manquants')).toBeNull()
  })

  it('keeps the expert titles in expert mode', async () => {
    nav.pathname = '/alpha/banking/missing-receipts'
    render(<DashboardBreadcrumb />)
    expect(await screen.findByText('Justificatifs manquants')).toBeInTheDocument()
  })
})
