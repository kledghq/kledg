/**
 * The standard display mode (docs/modes-et-menu.md): the expert pages, words
 * and home, with a sidebar of the day-to-day pages only. Hidden pages keep
 * their title; the switch offers the three modes.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ params: { companyId: 'alpha' } as Record<string, string>, pathname: '/alpha' }))
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useParams: () => nav.params, usePathname: () => nav.pathname, useRouter: () => router }))
vi.mock('@/lib/auth-client', () => ({ authClient: { useSession: () => ({ data: null }) } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { SidebarProvider } from '@/components/ui/sidebar'
import { findNavEntry, navGroups, navGroupsFor, simpleNavGroups, STANDARD_NAV_URLS, standardNavGroups, titleNavGroupsFor } from '../nav-config'
import { groupNavGroups, groupNavGroupsFor, GROUP_HOME, groupHomePath, simpleGroupNavGroups, standardGroupNavGroups } from '../group-nav-config'
import { NavMain } from '../nav-main'
import { GroupNav } from '../group-nav'
import { AppSidebar } from '../app-sidebar'
import { DashboardBreadcrumb } from '../dashboard-breadcrumb'
import { DisplayModeSwitch } from '../display-mode-switch'

const fetchMock = vi.fn()

beforeEach(() => {
  nav.params = { companyId: 'alpha' }
  nav.pathname = '/alpha'
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async () => Response.json({ name: 'Alpha', legalType: null }))
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
const outline = (groups: typeof navGroups) => groups.map((group) => [group.label ?? '', group.items.map((item) => item.title)])

describe('standard navigation', () => {
  it('lists exactly the day-to-day pages, in the expert order and groups', () => {
    expect(outline(standardNavGroups)).toEqual([
      ['', ['Tableau de bord']],
      ['Banque', ['Comptes bancaires', 'Transactions', 'Rapprochement', 'Justificatifs']],
      ['Factures', ["Factures d'achat", 'Factures de vente', 'Tiers', 'Notes de frais', 'Mes notes de frais']],
      ['Saisie', ['Écritures']],
      ['États', ['Bilan', 'Compte de résultat', 'Échéances', 'Déclarations de TVA', 'Impôt sur les sociétés']],
      ['Société', ['Informations', 'Membres']],
    ])
  })

  it('is data: the expert entries whose URL is listed, so a new expert page stays out until added', () => {
    const expertUrls = new Set(navGroups.flatMap((group) => group.items.map((item) => item.url)))
    // Every listed URL is an expert entry (no stale URL)
    expect([...STANDARD_NAV_URLS].filter((url) => !expertUrls.has(url))).toEqual([])
    // Each standard entry is the expert entry itself (same title, icon, filters)
    for (const item of standardNavGroups.flatMap((group) => group.items)) {
      expect(navGroups.flatMap((group) => group.items)).toContain(item)
    }
    // Same group ids as the expert groups they come from
    expect(standardNavGroups.map((group) => group.id)).toEqual(['accueil', 'banque', 'factures', 'saisie', 'etats', 'societe'])
  })

  it('uses its own sidebar and the expert titles', () => {
    expect(navGroupsFor('standard')).toBe(standardNavGroups)
    expect(navGroupsFor('expert')).toBe(navGroups)
    expect(navGroupsFor('simple')).toBe(simpleNavGroups)
    expect(titleNavGroupsFor('standard')).toBe(navGroups)
    expect(titleNavGroupsFor('expert')).toBe(navGroups)
    expect(titleNavGroupsFor('simple')).toBe(simpleNavGroups)
  })

  it('still finds the title of every expert page it does not list', () => {
    const listed = new Set(standardNavGroups.flatMap((group) => group.items.map((item) => item.url)))
    const hidden = navGroups.flatMap((group) => group.items).filter((item) => !listed.has(item.url))
    expect(hidden.length).toBeGreaterThan(20)
    for (const item of hidden) expect(findNavEntry(item.url, titleNavGroupsFor('standard'))?.title, item.url).toBe(item.title)
    // The standard sidebar alone would name a hidden page after a shorter neighbour
    expect(findNavEntry('/banking/statements', standardNavGroups)?.title).toBe('Comptes bancaires')
    expect(findNavEntry('/banking/statements', titleNavGroupsFor('standard'))?.title).toBe('Relevés')
  })

  it('keeps the holding and feature filters: no holding or feature page in standard, even for a holding', () => {
    inSidebar(<NavMain groups={standardNavGroups} titleGroups={navGroups} holdingRefs={['alpha']} featureRefs={{ training: ['alpha'], vatCoefficient: ['alpha'] }} />)
    expect(screen.queryByRole('link', { name: 'Frais de gestion' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Vue groupe' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Coefficient de déduction de TVA' })).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(18)
  })
})

describe('AppSidebar in standard mode', () => {
  it('shows the standard entries, the dashboard home and no simple count', () => {
    inSidebar(<AppSidebar companies={[]} mode="standard" />)
    expect(screen.getByRole('link', { name: 'Tableau de bord' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Écritures' })).toHaveAttribute('href', '/alpha/entries')
    expect(screen.queryByRole('link', { name: 'Journaux' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Accueil' })).toBeNull()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/simple/counts'))).toBe(false)
  })

  it('highlights nothing on a page it does not list, rather than a shorter neighbour', () => {
    nav.pathname = '/alpha/banking/statements'
    inSidebar(<AppSidebar companies={[]} mode="standard" />)
    expect(screen.getByRole('link', { name: 'Comptes bancaires' })).not.toHaveAttribute('aria-current')
    expect(screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')).toHaveLength(0)
    // Not the user's choice: no "Page masquée du menu"
    expect(screen.queryByText('Page masquée du menu')).toBeNull()
  })

  it('keeps the section of a detail page of a listed entry', () => {
    nav.pathname = '/alpha/entries/e1'
    inSidebar(<AppSidebar companies={[]} mode="standard" />)
    expect(screen.getByRole('link', { name: 'Écritures' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('DashboardBreadcrumb in standard mode', () => {
  it('names a page the menu does not list with its expert section and title', async () => {
    nav.pathname = '/alpha/banking/statements'
    render(<DashboardBreadcrumb mode="standard" />)
    await waitFor(() => expect(document.title).toBe('Relevés · Alpha · Kledg'))
    expect(screen.getByText('Banque')).toBeInTheDocument()
  })

  it('names the dashboard Tableau de bord, and the forecast with its expert title', async () => {
    nav.pathname = '/alpha'
    const { unmount } = render(<DashboardBreadcrumb mode="standard" />)
    await waitFor(() => expect(document.title).toBe('Tableau de bord · Alpha · Kledg'))
    unmount()
    nav.pathname = '/alpha/prevision-tresorerie'
    render(<DashboardBreadcrumb mode="standard" />)
    await waitFor(() => expect(document.title).toBe('Prévision de trésorerie · Alpha · Kledg'))
  })
})

describe('group space in standard mode', () => {
  it('keeps the expert pages with a sidebar of five', () => {
    expect(groupNavGroupsFor('standard')).toBe(standardGroupNavGroups)
    expect(groupNavGroupsFor('expert')).toBe(groupNavGroups)
    expect(groupNavGroupsFor('simple')).toBe(simpleGroupNavGroups)
    expect(outline(standardGroupNavGroups)).toEqual([
      ['Pilotage', ['Synthèse']],
      ['Structure', ['Organigramme']],
      ['Trésorerie', ['Soldes et perspectives']],
      ['Fiscalité', ['Impôt sur les sociétés', 'Échéances']],
    ])
    expect(GROUP_HOME.standard).toBe('/')
    expect(groupHomePath('lumen', 'standard')).toBe('/lumen/group')
  })

  it('renders the five pages and highlights nothing on a page it does not list', () => {
    nav.pathname = '/alpha/group/treasury/flows'
    inSidebar(<GroupNav mode="standard" />)
    const menu = screen.getByRole('navigation', { name: 'Navigation du groupe' })
    expect(within(menu).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/alpha/group',
      '/alpha/group/structure',
      '/alpha/group/treasury',
      '/alpha/group/tax',
      '/alpha/group/tax/deadlines',
    ])
    expect(within(menu).getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')).toHaveLength(0)
  })
})

describe('DisplayModeSwitch with three modes', () => {
  it('lists Simple, Standard and Expert with their one-line description', async () => {
    const user = userEvent.setup()
    inSidebar(<DisplayModeSwitch mode="standard" />)
    await user.click(screen.getByRole('button', { name: 'Affichage : Standard' }))
    const items = await screen.findAllByRole('menuitemradio')
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual(['Simple', 'Standard', 'Expert'])
    expect(screen.getByRole('menuitemradio', { name: 'Standard' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Simple' })).toHaveAccessibleDescription('Sans jargon comptable')
    expect(screen.getByRole('menuitemradio', { name: 'Standard' })).toHaveAccessibleDescription('Les pages du quotidien')
    expect(screen.getByRole('menuitemradio', { name: 'Expert' })).toHaveAccessibleDescription('Toutes les pages')
  })

  it('saves standard and opens the dashboard, or the group home from the group space', async () => {
    fetchMock.mockImplementation(async () => Response.json({ mode: 'standard', chosen: true }))
    const user = userEvent.setup()
    nav.pathname = '/alpha/journals'
    const { unmount } = inSidebar(<DisplayModeSwitch mode="simple" />)
    await user.click(screen.getByRole('button', { name: 'Affichage : Simple' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Standard' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/alpha'))
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ mode: 'standard' })
    unmount()
    nav.pathname = '/alpha/group/simple'
    inSidebar(<DisplayModeSwitch mode="simple" />)
    await user.click(screen.getByRole('button', { name: 'Affichage : Simple' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Standard' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/alpha/group'))
  })
})
