/**
 * Personal sidebar menus (docs/modes-et-menu.md): ids are cleaned against the
 * navigation, the editor hides entries and groups and resets, the home and
 * the editor entry can never be hidden, the sidebar applies the choice in
 * each mode, and a hidden current page says so with a way back.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

const nav = vi.hoisted(() => ({ params: { companyId: 'alpha' } as Record<string, string>, pathname: '/alpha' }))
vi.mock('next/navigation', () => ({ useParams: () => nav.params, usePathname: () => nav.pathname, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/lib/auth-client', () => ({ authClient: { useSession: () => ({ data: null }) } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { NOTHING_HIDDEN, SidebarPreferencesBody, type SidebarHidden } from '@/lib/navigation/sidebar-preferences'
import { navGroups, simpleNavGroups, standardNavGroups } from '../nav-config'
import {
  applySidebarHidden,
  HIDEABLE_GROUP_IDS,
  HIDEABLE_ITEM_URLS,
  revealItem,
  sanitizeSidebarHidden,
  toggleGroup,
  toggleItem,
} from '../sidebar-menu'
import { SidebarMenuEditor } from '../sidebar-menu-editor'
import { AppSidebar } from '../app-sidebar'

const fetchMock = vi.fn()
let mobile = false

beforeEach(() => {
  nav.params = { companyId: 'alpha' }
  nav.pathname = '/alpha'
  mobile = false
  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => (mobile ? 375 : 1280) })
  vi.stubGlobal('fetch', fetchMock)
  // The switcher lists companies (GET), a save echoes its body (PUT).
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => Response.json(init?.body ? JSON.parse(init.body as string) : []))
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: mobile, media: query, addEventListener: () => {}, removeEventListener: () => {} })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

const inSidebar = (ui: React.ReactNode) => render(<SidebarProvider>{ui}</SidebarProvider>)
const hidden = (hiddenItems: string[] = [], hiddenGroups: string[] = []): SidebarHidden => ({ hiddenItems, hiddenGroups })
const puts = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    .map(([url, init]) => [url, JSON.parse((init as RequestInit).body as string)])

describe('sidebar menu ids', () => {
  it('lets every entry but the homes, and every group but the one holding the home, be hidden', () => {
    expect(HIDEABLE_ITEM_URLS.has('/')).toBe(false)
    expect(HIDEABLE_ITEM_URLS.has('/simple')).toBe(false)
    expect(HIDEABLE_ITEM_URLS.has('/banking/statements')).toBe(true)
    expect(HIDEABLE_ITEM_URLS.has('/simple/depenses')).toBe(true)
    expect([...HIDEABLE_GROUP_IDS]).toEqual(['banque', 'factures', 'saisie', 'etats', 'societe'])
  })

  it('gives each group a stable id, never its label', () => {
    for (const group of [...navGroups, ...simpleNavGroups]) {
      expect(group.id).toMatch(/^[a-z]+$/)
      expect(SidebarPreferencesBody.shape.hiddenGroups.element.safeParse(group.id).success).toBe(true)
    }
    expect(new Set(navGroups.map((group) => group.id)).size).toBe(navGroups.length)
  })

  it('accepts the URL of every entry in the request body', () => {
    for (const url of HIDEABLE_ITEM_URLS) expect(SidebarPreferencesBody.safeParse(hidden([url])).success, url).toBe(true)
  })

  it('validates the shape of ids and nothing else in the body', () => {
    expect(SidebarPreferencesBody.safeParse(hidden(['journals'])).success).toBe(false)
    expect(SidebarPreferencesBody.safeParse(hidden(['/Journals'])).success).toBe(false)
    expect(SidebarPreferencesBody.safeParse(hidden(['/a/../b'])).success).toBe(false)
    expect(SidebarPreferencesBody.safeParse(hidden([], ['Saisie'])).success).toBe(false)
    expect(SidebarPreferencesBody.safeParse(hidden(Array.from({ length: 121 }, () => '/journals'))).success).toBe(false)
    expect(SidebarPreferencesBody.safeParse({ ...hidden(), userId: 'u-other' }).success).toBe(false)
    expect(SidebarPreferencesBody.safeParse({ hiddenItems: [] }).success).toBe(false)
  })

  it('drops unknown ids, the homes and duplicates, keeping the order', () => {
    expect(
      sanitizeSidebarHidden(hidden(['/journals', '/nowhere', '/', '/simple', '/journals', '/banking'], ['saisie', 'accueil', 'simple', 'inconnu', 'saisie', 'banque'])),
    ).toEqual(hidden(['/journals', '/banking'], ['saisie', 'banque']))
  })

  it('applies the choice to a menu, leaving out emptied groups, never the home', () => {
    const result = applySidebarHidden(standardNavGroups, hidden(['/entries', '/', '/informations'], ['etats', 'accueil']))
    expect(result.map((group) => group.label ?? '')).toEqual(['', 'Banque', 'Factures', 'Société'])
    expect(result.flatMap((group) => group.items.map((item) => item.url))).not.toContain('/entries')
    expect(result[0].items.map((item) => item.title)).toEqual(['Tableau de bord'])
    expect(result.at(-1)?.items.map((item) => item.title)).toEqual(['Membres'])
    expect(applySidebarHidden(simpleNavGroups, hidden(['/simple', '/members'], ['simple']))[0].items.map((item) => item.title)).toEqual([
      'Accueil',
      'Dépenses',
      'Recettes',
      'Factures',
      'Banque',
      'Justificatifs',
    ])
  })

  it('toggles and reveals', () => {
    expect(toggleItem(NOTHING_HIDDEN, '/journals', true)).toEqual(hidden(['/journals']))
    expect(toggleItem(hidden(['/journals']), '/journals', false)).toEqual(hidden())
    expect(toggleItem(NOTHING_HIDDEN, '/', true)).toBe(NOTHING_HIDDEN)
    expect(toggleGroup(NOTHING_HIDDEN, 'saisie', true)).toEqual(hidden([], ['saisie']))
    expect(toggleGroup(NOTHING_HIDDEN, 'accueil', true)).toBe(NOTHING_HIDDEN)
    expect(revealItem(hidden(['/journals', '/tiers'], ['societe', 'saisie']), navGroups, '/journals')).toEqual(hidden(['/tiers'], ['saisie']))
  })
})

describe('SidebarMenuEditor', () => {
  function Editor({ initial = NOTHING_HIDDEN, onChange = vi.fn(), currentUrl }: { initial?: SidebarHidden; onChange?: (next: SidebarHidden) => void; currentUrl?: string }) {
    return <SidebarMenuEditor open onOpenChange={() => {}} groups={standardNavGroups} hidden={initial} onChange={onChange} currentUrl={currentUrl} companyName="Atelier Lumen" />
  }

  it('lists each group with a switch and each entry with a box, for this company', () => {
    render(<Editor />)
    const dialog = screen.getByRole('dialog', { name: 'Personnaliser le menu' })
    expect(within(dialog).getByText(/Pour cette société : Atelier Lumen/)).toBeInTheDocument()
    expect(within(dialog).getAllByRole('switch').map((s) => s.getAttribute('aria-label'))).toEqual([
      'Afficher le groupe Banque',
      'Afficher le groupe Factures',
      'Afficher le groupe Saisie',
      'Afficher le groupe États',
      'Afficher le groupe Société',
    ])
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(18)
    // The editor entry is not an entry of the menu: it cannot be hidden
    expect(within(dialog).queryByText('Personnaliser le menu', { selector: 'label *' })).toBeNull()
  })

  it('cannot hide the home: its box is checked and disabled, its group has no switch', () => {
    render(<Editor />)
    const home = screen.getByRole('checkbox', { name: /Tableau de bord/ })
    expect(home).toBeChecked()
    expect(home).toBeDisabled()
    expect(screen.getByText('Toujours affiché')).toBeInTheDocument()
  })

  it('hides an entry and a group, each change at once', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<Editor onChange={onChange} />)
    await user.click(screen.getByRole('checkbox', { name: /Tiers/ }))
    expect(onChange).toHaveBeenLastCalledWith(hidden(['/tiers']))
    rerender(<Editor onChange={onChange} initial={hidden(['/tiers'])} />)
    expect(screen.getByRole('checkbox', { name: /Tiers/ })).not.toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Afficher le groupe États' }))
    expect(onChange).toHaveBeenLastCalledWith(hidden(['/tiers'], ['etats']))
    rerender(<Editor onChange={onChange} initial={hidden(['/tiers'], ['etats'])} />)
    expect(screen.getByRole('switch', { name: 'Afficher le groupe États' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('checkbox', { name: /^Bilan/ })).toBeDisabled()
    expect(screen.getByText('Groupe masqué du menu.')).toBeInTheDocument()
  })

  it('shows everything again with Afficher tout, disabled when nothing is hidden', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<Editor onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Afficher tout' })).toBeDisabled()
    rerender(<Editor onChange={onChange} initial={hidden(['/tiers'], ['etats'])} />)
    await user.click(screen.getByRole('button', { name: 'Afficher tout' }))
    expect(onChange).toHaveBeenLastCalledWith(hidden())
  })

  it('marks the current page and explains that hiding it keeps it open', () => {
    const { rerender } = render(<Editor currentUrl="/entries" />)
    expect(within(screen.getByText('Écritures').closest('label')!).getByText('Page actuelle')).toBeInTheDocument()
    expect(screen.queryByText(/Vous êtes sur cette page/)).toBeNull()
    rerender(<Editor currentUrl="/entries" initial={hidden([], ['saisie'])} />)
    expect(screen.getByText(/Vous êtes sur cette page : elle reste ouverte/)).toBeInTheDocument()
  })
})

describe('AppSidebar with a personal menu', () => {
  const links = () => screen.getAllByRole('link').map((link) => link.textContent)

  it('hides the entries and groups of the company in expert mode, and only in that company', () => {
    const prefs = { alpha: hidden(['/journals', '/budget'], ['saisie']) }
    const { unmount } = inSidebar(<AppSidebar companies={[]} sidebarPreferences={prefs} />)
    expect(links()).not.toContain('Journaux')
    expect(links()).not.toContain('Budget')
    expect(links()).not.toContain('Écritures')
    expect(screen.queryByText('Saisie')).toBeNull()
    expect(links()).toContain('Tableau de bord')
    expect(links()).toContain('Plan de comptes')
    unmount()
    nav.params = { companyId: 'beta' }
    nav.pathname = '/beta'
    inSidebar(<AppSidebar companies={[]} sidebarPreferences={prefs} />)
    expect(links()).toContain('Journaux')
    expect(links()).toContain('Écritures')
  })

  it('applies on top of the standard and simple menus', () => {
    const prefs = { alpha: hidden(['/tiers', '/members'], ['etats']) }
    const { unmount } = inSidebar(<AppSidebar companies={[]} mode="standard" sidebarPreferences={prefs} />)
    expect(links()).toEqual(['Tableau de bord', 'Comptes bancaires', 'Transactions', 'Rapprochement', 'Justificatifs', "Factures d'achat", 'Factures de vente', 'Notes de frais', 'Mes notes de frais', 'Écritures', 'Informations'])
    unmount()
    nav.pathname = '/alpha/simple'
    fetchMock.mockImplementation(async (url: string) => Response.json(String(url).includes('/simple/counts') ? {} : []))
    inSidebar(<AppSidebar companies={[]} mode="simple" sidebarPreferences={prefs} />)
    expect(links()).toEqual(['Accueil', 'Dépenses', 'Recettes', 'Factures', 'Banque', 'Justificatifs'])
  })

  it('opens the editor from the bottom of the menu; changes apply live and are saved for this company', async () => {
    const user = userEvent.setup()
    inSidebar(<AppSidebar companies={[{ id: 'c-alpha', slug: 'alpha', name: 'Alpha' }]} mode="standard" />)
    await user.click(screen.getByRole('button', { name: 'Personnaliser le menu' }))
    const dialog = await screen.findByRole('dialog', { name: 'Personnaliser le menu' })
    expect(within(dialog).getByText(/Pour cette société : Alpha/)).toBeInTheDocument()
    // The menu behind the modal editor is hidden from the accessibility tree while it is open: query it anyway.
    expect(screen.getByRole('link', { name: 'Tiers', hidden: true })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: /Tiers/ }))
    expect(screen.queryByRole('link', { name: 'Tiers', hidden: true })).toBeNull()
    await user.click(within(dialog).getByRole('switch', { name: 'Afficher le groupe Société' }))
    expect(screen.queryByRole('link', { name: 'Membres', hidden: true })).toBeNull()
    await waitFor(() =>
      expect(puts()).toEqual([
        ['/api/companies/alpha/sidebar-preferences', hidden(['/tiers'])],
        ['/api/companies/alpha/sidebar-preferences', hidden(['/tiers'], ['societe'])],
      ]),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Afficher tout' }))
    expect(screen.getByRole('link', { name: 'Tiers', hidden: true })).toBeInTheDocument()
    await waitFor(() => expect(puts().at(-1)).toEqual(['/api/companies/alpha/sidebar-preferences', hidden()]))
    // The editor entry stays, whatever is hidden
    expect(screen.getByRole('button', { name: 'Personnaliser le menu', hidden: true })).toBeInTheDocument()
  })

  it('puts the menu back and says why when saving fails', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? Response.json({ error: 'Trop de modifications du menu en une minute. Patientez une minute.' }, { status: 429 }) : Response.json([]),
    )
    const user = userEvent.setup()
    inSidebar(<AppSidebar companies={[]} />)
    await user.click(screen.getByRole('button', { name: 'Personnaliser le menu' }))
    await user.click(await screen.findByRole('checkbox', { name: /Journaux/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Trop de modifications du menu en une minute. Patientez une minute.'))
    expect(screen.getByRole('link', { name: 'Journaux', hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Journaux/ })).toBeChecked()
  })

  it('on a hidden current page, highlights nothing and offers to show it again', async () => {
    nav.pathname = '/alpha/journals/j1'
    const user = userEvent.setup()
    inSidebar(<AppSidebar companies={[]} sidebarPreferences={{ alpha: hidden(['/journals', '/tiers'], ['societe']) }} />)
    expect(screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent('Page masquée du menu')
    await user.click(screen.getByRole('button', { name: 'Réafficher' }))
    expect(screen.getByRole('link', { name: 'Journaux' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByText('Page masquée du menu')).toBeNull()
    await waitFor(() => expect(puts()).toEqual([['/api/companies/alpha/sidebar-preferences', hidden(['/tiers'])]]))
  })

  it('reveals the group too when the page was hidden with its group', async () => {
    nav.pathname = '/alpha/entries'
    const user = userEvent.setup()
    inSidebar(<AppSidebar companies={[]} mode="standard" sidebarPreferences={{ alpha: hidden([], ['saisie']) }} />)
    expect(screen.queryByRole('link', { name: 'Écritures' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Réafficher' }))
    expect(screen.getByRole('link', { name: 'Écritures' })).toHaveAttribute('aria-current', 'page')
  })

  it('has no editor in the group space', () => {
    nav.pathname = '/alpha/group'
    fetchMock.mockImplementation(async () => Response.json(null, { status: 404 }))
    inSidebar(<AppSidebar companies={[]} sidebarPreferences={{ alpha: hidden(['/journals']) }} />)
    expect(screen.queryByRole('button', { name: 'Personnaliser le menu' })).toBeNull()
  })

  it('works the same in the phone drawer: the drawer closes and the editor opens', async () => {
    mobile = true
    const user = userEvent.setup()
    inSidebar(
      <>
        <SidebarTrigger />
        <AppSidebar companies={[]} sidebarPreferences={{ alpha: hidden(['/journals']) }} />
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Afficher ou masquer le menu' }))
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' })
    expect(within(drawer).queryByRole('link', { name: 'Journaux' })).toBeNull()
    await user.click(within(drawer).getByRole('button', { name: 'Personnaliser le menu' }))
    expect(await screen.findByRole('dialog', { name: 'Personnaliser le menu' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull())
    await user.click(screen.getByRole('checkbox', { name: /Journaux/ }))
    await waitFor(() => expect(puts()).toEqual([['/api/companies/alpha/sidebar-preferences', hidden()]]))
  })
})
