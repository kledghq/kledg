import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ params: { companyId: 'alpha' } as Record<string, string>, pathname: '/alpha' }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
const theme = vi.hoisted(() => ({ theme: 'dark' as string | undefined, setTheme: vi.fn() }))
vi.mock('next/navigation', () => ({ useParams: () => nav.params, usePathname: () => nav.pathname }))
vi.mock('sonner', () => ({ toast }))
vi.mock('next-themes', () => ({ useTheme: () => theme }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import { TasksIndicator } from '../tasks-indicator'
import { DashboardBreadcrumb } from '../dashboard-breadcrumb'
import { ThemeToggle } from '../theme-toggle'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  nav.params = { companyId: 'alpha' }
  nav.pathname = '/alpha'
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

describe('TasksIndicator', () => {
  const refreshResult = (overrides: Record<string, unknown> = {}) => ({
    bankSync: { success: true, message: '12 transactions importées' },
    rulesExecution: { success: true, message: '8 transactions affectées', transactionsFailed: 0 },
    ...overrides,
  })

  function routes(refresh: () => Response = () => Response.json(refreshResult())) {
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === 'POST') return refresh()
      return Response.json({ unreconciledTransactions: 7, totalTasks: 7 })
    })
  }

  it('renders nothing outside a company', () => {
    nav.params = {}
    const { container } = render(<TasksIndicator />)
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the count of transactions to reconcile with a link to the reconciliation page', async () => {
    const user = userEvent.setup()
    routes()
    render(<TasksIndicator />)
    const trigger = await screen.findByRole('button', { name: /^Tâches à faire\s:\s7$/ })
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/count?companyId=alpha')
    await user.click(trigger)
    const link = await screen.findByRole('link', { name: /Transactions à rapprocher/ })
    expect(link).toHaveAttribute('href', '/alpha/reconciliation')
    expect(link).toHaveTextContent('7')
  })

  it('caps the badge at 99+ and says when there is nothing to do', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(Response.json({ unreconciledTransactions: 150, totalTasks: 150 }))
    const { unmount } = render(<TasksIndicator />)
    const trigger = await screen.findByRole('button', { name: /^Tâches à faire\s:\s150$/ })
    expect(trigger).toHaveTextContent('99+')
    unmount()

    fetchMock.mockResolvedValueOnce(Response.json({ unreconciledTransactions: 0, totalTasks: 0 }))
    render(<TasksIndicator />)
    await user.click(await screen.findByRole('button', { name: /^Tâches à faire\s:\saucune$/ }))
    expect(await screen.findByText('Rien à traiter pour le moment.')).toBeInTheDocument()
  })

  it('refreshes the count every two minutes', async () => {
    vi.useFakeTimers()
    routes()
    render(<TasksIndicator />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(120_000))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('synchronizes the bank and applies the rules, then reloads the count', async () => {
    const user = userEvent.setup()
    routes()
    render(<TasksIndicator />)
    await screen.findByRole('button', { name: /^Tâches à faire\s:\s7$/ })
    await user.click(screen.getByRole('button', { name: "Synchroniser la banque et appliquer les règles d'affectation" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('8 transactions affectées'))
    expect(toast.success).toHaveBeenCalledWith('12 transactions importées')
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(post[0]).toBe('/api/tasks/refresh')
    expect(JSON.parse(String(post[1]?.body))).toEqual({ companyId: 'alpha' })
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/tasks/count'))).toHaveLength(2))
  })

  it('warns with the first reason when some rules failed, and reports a failed sync', async () => {
    const user = userEvent.setup()
    routes(() =>
      Response.json(
        refreshResult({
          bankSync: { success: false, message: 'Connexion bancaire expirée' },
          rulesExecution: {
            success: true,
            message: '2 échecs sur 10',
            transactionsFailed: 2,
            failures: [{ error: 'Compte 401 introuvable' }],
          },
        }),
      ),
    )
    render(<TasksIndicator />)
    await screen.findByRole('button', { name: /^Tâches à faire\s:\s7$/ })
    await user.click(screen.getByRole('button', { name: "Synchroniser la banque et appliquer les règles d'affectation" }))
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith("Règles d'affectation\u00a0: 2 échecs sur 10", {
        description: 'Compte 401 introuvable',
        duration: 8000,
      }),
    )
    expect(toast.error).toHaveBeenCalledWith('Synchronisation\u00a0: Connexion bancaire expirée')
  })

  it('toasts the error of a refused synchronization', async () => {
    const user = userEvent.setup()
    routes(() => Response.json({ error: 'Trop de synchronisations, réessayez dans une minute' }, { status: 429 }))
    render(<TasksIndicator />)
    await screen.findByRole('button', { name: /^Tâches à faire\s:\s7$/ })
    await user.click(screen.getByRole('button', { name: "Synchroniser la banque et appliquer les règles d'affectation" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Trop de synchronisations, réessayez dans une minute'))
  })
})

describe('DashboardBreadcrumb', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async () => Response.json({ name: 'Atelier Lumen SAS', legalType: 'SAS' }))
  })

  it('names the company on its home page and in the tab title', async () => {
    render(<DashboardBreadcrumb />)
    expect(screen.getByLabelText('Chargement')).toBeInTheDocument()
    expect(await screen.findByText('Atelier Lumen')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/companies/alpha')
    await waitFor(() => expect(document.title).toBe('Tableau de bord · Atelier Lumen · Kledg'))
  })

  it('shows company, group and page for a sidebar page', async () => {
    nav.pathname = '/alpha/journals'
    render(<DashboardBreadcrumb />)
    expect(await screen.findByRole('link', { name: /Atelier Lumen/ })).toHaveAttribute('href', '/alpha')
    expect(screen.getByText('Société')).toBeInTheDocument()
    expect(screen.getByText('Journaux')).toHaveAttribute('aria-current', 'page')
    await waitFor(() => expect(document.title).toBe('Journaux · Atelier Lumen · Kledg'))
  })

  it('links the section and names a sub page or a detail page', async () => {
    nav.pathname = '/alpha/entries/e1/edit'
    const { unmount } = render(<DashboardBreadcrumb />)
    await screen.findByRole('link', { name: /Atelier Lumen/ })
    expect(screen.getByRole('link', { name: 'Écritures' })).toHaveAttribute('href', '/alpha/entries')
    expect(screen.getByText("Modifier l'écriture")).toHaveAttribute('aria-current', 'page')
    unmount()

    nav.pathname = '/alpha/accounts/411000'
    render(<DashboardBreadcrumb />)
    await screen.findByRole('link', { name: /Atelier Lumen/ })
    expect(screen.getByRole('link', { name: 'Comptes' })).toHaveAttribute('href', '/alpha/accounts')
    expect(screen.getByText('Détail')).toBeInTheDocument()
  })

  it('shows only Kledg outside a company', () => {
    nav.params = {}
    nav.pathname = '/settings/profile'
    render(<DashboardBreadcrumb />)
    expect(screen.getByText('Kledg')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ThemeToggle', () => {
  it('offers light, dark and system themes with the current one checked, and applies the choice', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    const trigger = screen.getByRole('button', { name: 'Changer de thème' })
    await waitFor(() => expect(trigger).toBeEnabled())
    await user.click(trigger)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitemradio', { name: 'Sombre' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Clair' }))
    expect(theme.setTheme).toHaveBeenCalledWith('light')
  })

  it('checks System when no theme is stored yet', async () => {
    const user = userEvent.setup()
    theme.theme = undefined
    render(<ThemeToggle />)
    await user.click(screen.getByRole('button', { name: 'Changer de thème' }))
    expect(await screen.findByRole('menuitemradio', { name: 'Système' })).toHaveAttribute('aria-checked', 'true')
    theme.theme = 'dark'
  })
})
