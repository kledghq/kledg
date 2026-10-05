import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({
  params: { companyId: 'alpha' } as Record<string, string>,
  pathname: '/alpha/entries/e1',
  push: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useParams: () => nav.params,
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, refresh: vi.fn() }),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import { SidebarProvider } from '@/components/ui/sidebar'
import { LAST_COMPANY_COOKIE } from '@/lib/last-company'
import { TeamSwitcher, type SwitcherCompany } from '../team-switcher'

const companies: SwitcherCompany[] = [
  { id: 'c1', slug: 'alpha', name: 'Alpha SAS', legalType: 'SAS', siret: '12345678900011' },
  { id: 'c2', slug: 'beta', name: 'Beta SARL', legalType: 'SARL' },
]

const fetchMock = vi.fn<typeof fetch>()
let cookies: string[]

function renderSwitcher(initial: SwitcherCompany[] | null = companies, holdingRefs?: string[]) {
  return render(
    <SidebarProvider>
      <TeamSwitcher initialCompanies={initial ?? undefined} holdingRefs={holdingRefs} />
    </SidebarProvider>,
  )
}

beforeEach(() => {
  nav.params = { companyId: 'alpha' }
  nav.pathname = '/alpha/entries/e1'
  fetchMock.mockImplementation(async () => Response.json(companies))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
  cookies = []
  vi.spyOn(document, 'cookie', 'set').mockImplementation((value: string) => {
    cookies.push(value)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  nav.push.mockReset()
})

const lastCompanyCookies = () => cookies.filter((c) => c.startsWith(`${LAST_COMPANY_COOKIE}=`))

describe('TeamSwitcher', () => {
  it('shows the current company at once from the layout list and remembers it in the last-company cookie', async () => {
    renderSwitcher()
    const trigger = screen.getByRole('button', { name: /Alpha/ })
    expect(trigger).toHaveTextContent('12345678900011')
    expect(trigger).toHaveTextContent('AS')
    await waitFor(() => expect(lastCompanyCookies()).toContainEqual(expect.stringMatching(/^kledg_last_company=alpha; path=\/; max-age=31536000; samesite=lax$/)))
    expect(fetchMock).toHaveBeenCalledWith('/api/companies', { cache: 'no-store' })
  })

  it('switches company keeping the page the user is on', async () => {
    const user = userEvent.setup()
    renderSwitcher()
    await user.click(screen.getByRole('button', { name: /Alpha/ }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('Alpha'),
      expect.stringContaining('Beta'),
      'Gérer les sociétés',
    ])
    await user.click(screen.getByRole('menuitem', { name: /Beta/ }))
    expect(nav.push).toHaveBeenCalledWith('/beta/entries/e1')
    expect(screen.getByRole('button', { name: /Chargement/ })).toHaveTextContent('Changement de société')
  })

  it('remembers the new company once its page is open', async () => {
    const view = renderSwitcher()
    await waitFor(() => expect(lastCompanyCookies()).toHaveLength(1))
    nav.params = { companyId: 'beta' }
    nav.pathname = '/beta'
    view.rerender(
      <SidebarProvider>
        <TeamSwitcher initialCompanies={companies} />
      </SidebarProvider>,
    )
    await waitFor(() => expect(lastCompanyCookies().at(-1)).toMatch(/^kledg_last_company=beta;/))
    expect(screen.getByRole('button', { name: /Beta/ })).toBeInTheDocument()
  })

  it('does nothing when the current company is chosen again', async () => {
    const user = userEvent.setup()
    renderSwitcher()
    await user.click(screen.getByRole('button', { name: /Alpha/ }))
    await user.click(await screen.findByRole('menuitem', { name: /Alpha/ }))
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('opens the company home from a page outside any company, and sets no cookie there', async () => {
    const user = userEvent.setup()
    nav.params = {}
    nav.pathname = '/settings/profile'
    renderSwitcher()
    const trigger = await screen.findByRole('button', { name: /Choisir une société/ })
    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: /Beta/ }))
    expect(nav.push).toHaveBeenCalledWith('/beta')
    expect(lastCompanyCookies()).toEqual([])
  })

  it('links to the companies page', async () => {
    const user = userEvent.setup()
    renderSwitcher()
    await user.click(screen.getByRole('button', { name: /Alpha/ }))
    expect(await screen.findByRole('menuitem', { name: 'Gérer les sociétés' })).toHaveAttribute('href', '/companies')
  })

  it('loads the list itself without a layout list, and reloads on companies:refresh', async () => {
    let answer: (response: Response) => void = () => {}
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
    renderSwitcher(null)
    expect(screen.getByText('Chargement...')).toBeInTheDocument()
    await act(async () => answer(Response.json(companies)))
    expect(await screen.findByRole('button', { name: /Alpha/ })).toBeInTheDocument()

    fetchMock.mockImplementation(async () => Response.json([{ ...companies[0], name: 'Alpha Conseil' }, companies[1]]))
    await act(async () => {
      window.dispatchEvent(new Event('companies:refresh'))
    })
    expect(await screen.findByRole('button', { name: /Alpha Conseil/ })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('lists the holdings under Groupes, each opening its group view, checked there', async () => {
    const user = userEvent.setup()
    renderSwitcher(companies, ['c1'])
    await user.click(screen.getByRole('button', { name: /Alpha/ }))
    expect(await screen.findByText('Groupes')).toBeInTheDocument()
    const group = screen.getAllByRole('menuitem').find((i) => i.getAttribute('href') === '/alpha/group')
    expect(group).toBeDefined()
    expect(group).toHaveTextContent('Alpha')
  })

  it('shows no Groupes section without holdings', async () => {
    const user = userEvent.setup()
    renderSwitcher(companies, [])
    await user.click(screen.getByRole('button', { name: /Alpha/ }))
    await screen.findAllByRole('menuitem')
    expect(screen.queryByText('Groupes')).toBeNull()
  })
})
