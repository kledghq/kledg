import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ params: { companyId: 'alpha' } as Record<string, string>, pathname: '/alpha' }))
const session = vi.hoisted(() => ({
  data: { user: { name: 'Marie Dupont', email: 'marie@acme.fr', role: 'user' } } as { user: Record<string, string> } | null,
}))
const pwa = vi.hoisted(() => ({ canInstall: false, install: vi.fn(async () => {}), clearPwaCaches: vi.fn(async () => {}) }))
vi.mock('next/navigation', () => ({ useParams: () => nav.params, usePathname: () => nav.pathname }))
vi.mock('@/lib/auth-client', () => ({ authClient: { useSession: () => ({ data: session.data }) } }))
vi.mock('@/components/pwa/install', () => ({
  useInstallPrompt: () => ({ canInstall: pwa.canInstall, install: pwa.install }),
  clearPwaCaches: pwa.clearPwaCaches,
}))

import { SidebarProvider } from '@/components/ui/sidebar'
import { UserMenuProvider } from '../user-menu-context'
import { USER_MENU_ITEM_IDS } from '../user-menu'
import { navGroups } from '../nav-config'
import { NavMain } from '../nav-main'
import { NavUser } from '../nav-user'
import { SettingsSidebar } from '../settings-sidebar'
import { displayName, initials } from '../initials'
import { useIsMobile } from '@/hooks/ui/use-mobile'

let mobile = false
const mediaListeners = new Set<() => void>()

beforeEach(() => {
  nav.params = { companyId: 'alpha' }
  nav.pathname = '/alpha'
  session.data = { user: { name: 'Marie Dupont', email: 'marie@acme.fr', role: 'user' } }
  pwa.canInstall = false
  mobile = false
  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => (mobile ? 375 : 1280) })
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: mobile,
      media: query,
      addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
    })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  mediaListeners.clear()
  vi.clearAllMocks()
})

const inSidebar = (ui: React.ReactNode) => render(<SidebarProvider>{ui}</SidebarProvider>)

describe('NavMain', () => {
  it('prefixes every entry with the company and marks only the longest matching one', () => {
    nav.pathname = '/alpha/accounts/plan'
    inSidebar(<NavMain groups={navGroups} />)
    expect(screen.getByRole('link', { name: 'Tableau de bord' })).toHaveAttribute('href', '/alpha')
    expect(screen.getByRole('link', { name: 'Journaux' })).toHaveAttribute('href', '/alpha/journals')
    expect(screen.getByRole('link', { name: 'Plan de comptes' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Comptes' })).not.toHaveAttribute('aria-current')
    expect(screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')).toHaveLength(1)
    expect(screen.getByText('Banque')).toBeInTheDocument()
  })

  it('keeps the section of a detail page highlighted, and the dashboard on the company home', () => {
    nav.pathname = '/alpha/entries/e1'
    const { unmount } = inSidebar(<NavMain groups={navGroups} />)
    expect(screen.getByRole('link', { name: 'Écritures' })).toHaveAttribute('aria-current', 'page')
    unmount()
    nav.pathname = '/alpha'
    inSidebar(<NavMain groups={navGroups} />)
    expect(screen.getByRole('link', { name: 'Tableau de bord' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows Frais de gestion and Vue groupe in a holding only (lib/management-fees/holding.ts)', () => {
    const { unmount } = inSidebar(<NavMain groups={navGroups} holdingRefs={['beta']} />)
    expect(screen.queryByRole('link', { name: 'Frais de gestion' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Vue groupe' })).toBeNull()
    unmount()
    inSidebar(<NavMain groups={navGroups} holdingRefs={['alpha']} />)
    expect(screen.getByRole('link', { name: 'Frais de gestion' })).toHaveAttribute('href', '/alpha/management-fees')
    expect(screen.getByRole('link', { name: 'Vue groupe' })).toHaveAttribute('href', '/alpha/group')
  })
})

describe('NavUser', () => {
  it('shows who is signed in and keeps the menu short', async () => {
    const user = userEvent.setup()
    nav.pathname = '/settings/profile'
    inSidebar(<NavUser />)
    const trigger = screen.getByRole('button', { name: 'Compte de Marie Dupont' })
    expect(trigger).toHaveTextContent('MD')
    expect(trigger).toHaveTextContent('marie@acme.fr')
    await user.click(trigger)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Paramètres' })).toHaveAttribute('aria-current', 'page')
    expect(within(menu).getByRole('menuitem', { name: /Documentation/ })).toHaveAttribute('target', '_blank')
    expect(within(menu).queryByRole('menuitem', { name: /Installer/ })).toBeNull()
    expect(within(menu).queryByRole('menuitem', { name: 'Utilisateurs' })).toBeNull()
  })

  it('signs out with a same-origin POST after clearing the cached assets', async () => {
    const user = userEvent.setup()
    const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {})
    const { container } = inSidebar(<NavUser />)
    const form = container.querySelector('form')!
    expect(form).toHaveAttribute('method', 'post')
    expect(form).toHaveAttribute('action', '/auth/signout')
    await user.click(screen.getByRole('button', { name: 'Compte de Marie Dupont' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Se déconnecter' }))
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    expect(pwa.clearPwaCaches).toHaveBeenCalled()
    submit.mockRestore()
  })

  it('offers to install the application when the browser allows it', async () => {
    const user = userEvent.setup()
    pwa.canInstall = true
    inSidebar(<NavUser />)
    await user.click(screen.getByRole('button', { name: 'Compte de Marie Dupont' }))
    await user.click(await screen.findByRole('menuitem', { name: "Installer l'application" }))
    expect(pwa.install).toHaveBeenCalled()
  })

  it('names a user without a name by the local part of the email, and renders nothing signed out', () => {
    session.data = { user: { name: '', email: 'jean.martin@acme.fr' } }
    const { unmount } = inSidebar(<NavUser />)
    expect(screen.getByRole('button', { name: 'Compte de jean.martin' })).toHaveTextContent('JM')
    unmount()
    session.data = null
    const { container } = inSidebar(<NavUser />)
    expect(container.querySelector('[data-sidebar="menu"]')).toBeNull()
  })
})

describe('SettingsSidebar', () => {
  it('links back to the last company and highlights the current settings page', () => {
    nav.params = {}
    nav.pathname = '/settings/api-keys'
    inSidebar(<SettingsSidebar lastCompany={{ slug: 'alpha', name: 'Alpha SAS' }} isAdmin={false} />)
    const back = screen.getByRole('link', { name: /Retour à la société/ })
    expect(back).toHaveAttribute('href', '/alpha')
    expect(back).toHaveTextContent('Alpha SAS')
    const settings = screen.getByRole('navigation', { name: 'Paramètres' })
    expect(within(settings).getByRole('link', { name: 'Clés API' })).toHaveAttribute('aria-current', 'page')
    // The instance group is for administrators.
    expect(within(settings).queryByRole('link', { name: 'Utilisateurs' })).toBeNull()
  })

  it('goes back to the companies list without a last company', () => {
    nav.params = {}
    nav.pathname = '/companies'
    inSidebar(<SettingsSidebar lastCompany={null} isAdmin={false} />)
    const back = screen.getByRole('link', { name: /Choisir une société/ })
    expect(back).toHaveAttribute('href', '/companies')
    expect(back).toHaveTextContent('Mes sociétés')
  })

  it('shows the instance pages and the version linked to the updates page to an administrator', () => {
    nav.params = {}
    nav.pathname = '/settings/users'
    inSidebar(
      <SettingsSidebar lastCompany={null} isAdmin version={{ version: '1.3.0', commit: 'abcdef1234567' }} />,
    )
    const settings = screen.getByRole('navigation', { name: 'Paramètres' })
    expect(within(settings).getByRole('link', { name: 'Utilisateurs' })).toHaveAttribute('aria-current', 'page')
    expect(within(settings).getByRole('link', { name: 'Mises à jour' })).toHaveAttribute('href', '/settings/updates')
    const versionLink = screen.getByTitle('Mises à jour')
    expect(versionLink).toHaveAttribute('href', '/settings/updates')
    expect(versionLink).toHaveTextContent('Kledg v1.3.0 · abcdef1')
  })

  it('shows the version without a link to a member, and hides the pages the instance removed', () => {
    nav.params = {}
    nav.pathname = '/settings/profile'
    render(
      <SidebarProvider>
        <UserMenuProvider visible={USER_MENU_ITEM_IDS.filter((id) => id !== 'appearance')}>
          <SettingsSidebar lastCompany={null} isAdmin={false} version={{ version: '1.3.0', commit: null }} />
        </UserMenuProvider>
      </SidebarProvider>,
    )
    expect(screen.queryByTitle('Mises à jour')).toBeNull()
    expect(screen.getByText(/Kledg/, { selector: 'p' })).toHaveTextContent('Kledg v1.3.0')
    expect(screen.queryByRole('link', { name: 'Apparence' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Profil' })).toBeInTheDocument()
  })
})

describe('initials and displayName', () => {
  it.each([
    ['Marie Dupont', 'MD'],
    ['marie', 'M'],
    ['jean.martin@acme.fr', 'JM'],
    ['anne-sophie_leroy', 'AS'],
    ['  Paul   Émile  Martin ', 'PÉ'],
    ['', ''],
  ])('gives %j the initials %j', (name, expected) => {
    expect(initials(name)).toBe(expected)
  })

  it('falls back from the name to the email, then to Utilisateur', () => {
    expect(displayName({ name: ' Marie ', email: 'm@acme.fr' })).toBe('Marie')
    expect(displayName({ name: '  ', email: 'jean@acme.fr' })).toBe('jean')
    expect(displayName({ name: null, email: null })).toBe('Utilisateur')
  })
})

describe('useIsMobile', () => {
  it('follows the window width around 768px', () => {
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 767px)')
    mobile = true
    act(() => mediaListeners.forEach((listener) => listener()))
    expect(result.current).toBe(true)
  })

  it('stops listening once unmounted', () => {
    const { unmount } = renderHook(() => useIsMobile())
    expect(mediaListeners.size).toBe(1)
    unmount()
    expect(mediaListeners.size).toBe(0)
  })
})
