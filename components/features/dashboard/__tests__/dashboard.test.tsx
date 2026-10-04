import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

import type { LayoutItem } from '@/lib/dashboard/widgets'
import { DEFAULT_LAYOUTS, WIDGETS } from '@/lib/dashboard/widgets'

const replaceMock = vi.hoisted(() => vi.fn())
const searchParams = vi.hoisted(() => ({ current: new URLSearchParams() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => searchParams.current,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

// The grid and its widgets have their own tests: here they only show which
// items the dashboard gives them, and the fiscal year it passes down.
vi.mock('../dashboard-data', () => ({
  DashboardDataProvider: ({ fiscalYearId, children }: { fiscalYearId: string; children: React.ReactNode }) => (
    <div data-testid="data" data-fiscal-year={fiscalYearId}>
      {children}
    </div>
  ),
}))
vi.mock('../dashboard-grid', () => ({
  DashboardGrid: ({ items }: { items: LayoutItem[] }) => (
    <ul aria-label="Widgets">
      {items.map((i) => (
        <li key={i.id}>{`${i.id}:${i.size}`}</li>
      ))}
    </ul>
  ),
  EditableDashboardGrid: ({
    items,
    onChange,
  }: {
    items: LayoutItem[]
    onChange: (items: LayoutItem[], message: string) => void
  }) => (
    <ul aria-label="Widgets en édition">
      {items.map((i) => (
        <li key={i.id}>
          {`${i.id}:${i.size}`}
          <button type="button" onClick={() => onChange(items.filter((x) => x.id !== i.id), `${i.id} retiré.`)}>
            {`Retirer ${i.id}`}
          </button>
        </li>
      ))}
    </ul>
  ),
}))

import { Dashboard } from '../dashboard'

const fetchMock = vi.fn()

const FISCAL_YEARS = [
  { id: 'fy-2027', year: 2027, startDate: '2027-01-01', endDate: '2027-12-31' },
  { id: 'fy-2026', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' },
]

const SAVED: LayoutItem[] = [
  { id: 'kpi-resultat', size: 'S' },
  { id: 'list-brouillons', size: 'L' },
]

interface Routes {
  fiscalYears?: unknown
  layout?: () => Response
  onboarding?: unknown
  save?: (init: RequestInit) => Response
}

function route(routes: Routes = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/companies/c1/fiscal-years') return Response.json(routes.fiscalYears ?? FISCAL_YEARS)
    if (url === '/api/companies/c1/onboarding') {
      if (init?.method === 'POST') return Response.json({ ok: true })
      return routes.onboarding ? Response.json(routes.onboarding) : Response.json({ error: 'x' }, { status: 403 })
    }
    if (url === '/api/dashboard/layout?companyId=c1') {
      if (init?.method === 'PUT' || init?.method === 'DELETE') {
        return routes.save ? routes.save(init) : Response.json({ items: [], isDefault: false, profile: 'owner' })
      }
      return routes.layout ? routes.layout() : Response.json({ items: SAVED, isDefault: false, profile: 'owner' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  })
}

function shownItems(name = 'Widgets'): string[] {
  return within(screen.getByRole('list', { name })).getAllByRole('listitem').map((li) => li.firstChild?.textContent ?? '')
}

function layoutCalls(method: string): RequestInit[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => url === '/api/dashboard/layout?companyId=c1' && (init as RequestInit | undefined)?.method === method)
    .map(([, init]) => init as RequestInit)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'))
  vi.stubGlobal('fetch', fetchMock)
  searchParams.current = new URLSearchParams()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

const guide = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  dismissed: false,
  canManage: true,
  steps: [],
  done: 1,
  total: 5,
  complete: false,
  counts: { entries: 0, bankTransactions: 0 },
  ...overrides,
})

describe('Dashboard', () => {
  it('shows the saved layout on the fiscal year that contains today', async () => {
    route()
    render(<Dashboard companyId="c1" />)
    expect(screen.getByLabelText('Chargement du tableau de bord')).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => expect(shownItems()).toEqual(['kpi-resultat:S', 'list-brouillons:L']))
    // fy-2027 is listed first, but 2026-03-15 falls in fy-2026.
    expect(screen.getByTestId('data')).toHaveAttribute('data-fiscal-year', 'fy-2026')
    expect(screen.getByRole('combobox', { name: 'Exercice' })).toHaveTextContent('Exercice 2026')
  })

  it('falls back to the first fiscal year listed when none contains today', async () => {
    route({ fiscalYears: [{ id: 'fy-2024', year: 2024, startDate: '2024-01-01', endDate: '2024-12-31' }] })
    render(<Dashboard companyId="c1" />)
    await waitFor(() => expect(screen.getByTestId('data')).toHaveAttribute('data-fiscal-year', 'fy-2024'))
  })

  it('switches the fiscal year from the header', async () => {
    route()
    const user = userEvent.setup()
    render(<Dashboard companyId="c1" />)
    await screen.findByRole('list', { name: 'Widgets' })
    await user.click(screen.getByRole('combobox', { name: 'Exercice' }))
    await user.click(await screen.findByRole('option', { name: 'Exercice 2027' }))
    expect(screen.getByTestId('data')).toHaveAttribute('data-fiscal-year', 'fy-2027')
  })

  it('saves a customized layout with PUT and the items in order', async () => {
    const saved: LayoutItem[] = [{ id: 'list-brouillons', size: 'L' }]
    route({ save: () => Response.json({ items: saved, isDefault: false, profile: 'owner' }) })
    const user = userEvent.setup()
    render(<Dashboard companyId="c1" />)
    await screen.findByRole('list', { name: 'Widgets' })

    await user.click(screen.getByRole('button', { name: 'Personnaliser' }))
    expect(screen.getByRole('status')).toHaveTextContent(/^Mode personnalisation/)
    await user.click(screen.getByRole('button', { name: 'Retirer kpi-resultat' }))
    expect(screen.getByRole('status')).toHaveTextContent('kpi-resultat retiré.')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(layoutCalls('PUT')).toHaveLength(1))
    const [init] = layoutCalls('PUT')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({ items: [{ id: 'list-brouillons', size: 'L' }] })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Disposition enregistrée'))
    expect(shownItems()).toEqual(['list-brouillons:L'])
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument()
  })

  it('adds a widget from the catalogue at the end, at its default size', async () => {
    route()
    const user = userEvent.setup()
    render(<Dashboard companyId="c1" />)
    await screen.findByRole('list', { name: 'Widgets' })
    await user.click(screen.getByRole('button', { name: 'Personnaliser' }))
    await user.click(screen.getByRole('button', { name: 'Ajouter un widget' }))
    const sheet = await screen.findByRole('dialog', { name: 'Ajouter un widget' })
    // Widgets already shown are not offered again.
    expect(within(sheet).queryByRole('button', { name: 'Ajouter Résultat' })).not.toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Ajouter Marge commerciale' }))
    expect(screen.getByRole('status')).toHaveTextContent('« Marge commerciale » ajouté à la fin du tableau de bord.')
    // More widgets remain: the catalogue stays open.
    expect(screen.getByRole('dialog', { name: 'Ajouter un widget' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(shownItems('Widgets en édition')).toEqual(['kpi-resultat:S', 'list-brouillons:L', 'kpi-marge:S'])
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(layoutCalls('PUT')).toHaveLength(1))
    expect(JSON.parse(layoutCalls('PUT')[0].body as string).items.at(-1)).toEqual({ id: 'kpi-marge', size: 'S' })
  })

  it('closes the catalogue once its last widget is added', async () => {
    const allButOne = WIDGETS.filter((w) => w.id !== 'kpi-marge').map((w) => ({ id: w.id, size: w.defaultSize }))
    route({ layout: () => Response.json({ items: allButOne, isDefault: false, profile: 'owner' }) })
    const user = userEvent.setup()
    render(<Dashboard companyId="c1" />)
    await screen.findByRole('list', { name: 'Widgets' })
    await user.click(screen.getByRole('button', { name: 'Personnaliser' }))
    await user.click(screen.getByRole('button', { name: 'Ajouter un widget' }))
    await user.click(await screen.findByRole('button', { name: 'Ajouter Marge commerciale' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(shownItems('Widgets en édition').at(-1)).toBe('kpi-marge:S')
  })

  it('removes the saved layout (DELETE, no body) when the default one is restored', async () => {
    route({ save: () => Response.json({ items: DEFAULT_LAYOUTS.owner, isDefault: true, profile: 'owner' }) })
    const user = userEvent.setup()
    render(<Dashboard companyId="c1" />)
    await screen.findByRole('list', { name: 'Widgets' })
    await user.click(screen.getByRole('button', { name: 'Personnaliser' }))
    await user.click(screen.getByRole('button', { name: 'Rétablir la disposition par défaut' }))
    expect(screen.getByRole('status')).toHaveTextContent('Disposition par défaut rétablie. Enregistrez pour la garder.')
    expect(shownItems('Widgets en édition')).toEqual(DEFAULT_LAYOUTS.owner.map((i) => `${i.id}:${i.size}`))
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(layoutCalls('DELETE')).toHaveLength(1))
    expect(layoutCalls('DELETE')[0]).toEqual({ method: 'DELETE', headers: { 'Content-Type': 'application/json' } })
    expect(layoutCalls('PUT')).toHaveLength(0)
  })

  it('keeps the edits and shows the API error when saving fails', async () => {
    route({ save: () => Response.json({ error: 'Un tableau de bord compte au plus 50 widgets' }, { status: 400 }) })
    const user = userEvent.setup()
    render(<Dashboard companyId="c1" />)
    await screen.findByRole('list', { name: 'Widgets' })
    await user.click(screen.getByRole('button', { name: 'Personnaliser' }))
    await user.click(screen.getByRole('button', { name: 'Retirer kpi-resultat' }))
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Un tableau de bord compte au plus 50 widgets'))
    expect(screen.getByRole('status')).toHaveTextContent('Un tableau de bord compte au plus 50 widgets')
    expect(shownItems('Widgets en édition')).toEqual(['list-brouillons:L'])
  })

  it('uses a default message when the save error has no body', async () => {
    route({ save: () => new Response('oops', { status: 502 }) })
    const user = userEvent.setup()
    render(<Dashboard companyId="c1" />)
    await screen.findByRole('list', { name: 'Widgets' })
    await user.click(screen.getByRole('button', { name: 'Personnaliser' }))
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("La disposition n'a pas été enregistrée. Réessayez dans un instant."),
    )
  })

  it('drops the edits on Annuler, and warns before leaving while they are unsaved', async () => {
    route()
    const add = vi.spyOn(window, 'addEventListener')
    const user = userEvent.setup()
    render(<Dashboard companyId="c1" />)
    await screen.findByRole('list', { name: 'Widgets' })
    await user.click(screen.getByRole('button', { name: 'Personnaliser' }))
    expect(add).not.toHaveBeenCalledWith('beforeunload', expect.any(Function))
    await user.click(screen.getByRole('button', { name: 'Retirer kpi-resultat' }))
    expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function))

    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.getByRole('status')).toHaveTextContent('Modifications annulées.')
    expect(shownItems()).toEqual(['kpi-resultat:S', 'list-brouillons:L'])
    expect(layoutCalls('PUT')).toHaveLength(0)
    add.mockRestore()
  })

  it('offers to retry when the layout does not load', async () => {
    let attempts = 0
    route({
      layout: () => {
        attempts++
        return attempts === 1 ? Response.json({}, { status: 500 }) : Response.json({ items: SAVED, isDefault: false, profile: 'owner' })
      },
    })
    const user = userEvent.setup()
    render(<Dashboard companyId="c1" />)
    expect(await screen.findByText('Impossible de charger le tableau de bord')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Personnaliser' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(shownItems()).toEqual(['kpi-resultat:S', 'list-brouillons:L']))
  })

  it('asks to create a fiscal year first, and offers no customization', async () => {
    route({ fiscalYears: [] })
    render(<Dashboard companyId="c1" />)
    expect(await screen.findByText('Aucun exercice pour cette société')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Créer un exercice' })).toHaveAttribute('href', '/c1/fiscal-years')
    expect(screen.queryByRole('button', { name: 'Personnaliser' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Exercice' })).not.toBeInTheDocument()
  })

  it('keeps the getting started guide above the fiscal year notice while the guide is open', async () => {
    route({ fiscalYears: [], onboarding: guide() })
    render(<Dashboard companyId="c1" />)
    await waitFor(() => expect(shownItems()).toEqual(['guide-demarrer:L']))
    expect(screen.getByTestId('data')).toHaveAttribute('data-fiscal-year', '')
  })

  it('treats a failed fiscal year request as no fiscal year', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/companies/c1/fiscal-years') return Response.json({ error: 'x' }, { status: 500 })
      if (url === '/api/companies/c1/onboarding') return Response.json({ error: 'x' }, { status: 403 })
      return Response.json({ items: SAVED, isDefault: false, profile: 'owner' })
    })
    render(<Dashboard companyId="c1" />)
    expect(await screen.findByText('Aucun exercice pour cette société')).toBeInTheDocument()
  })

  it('offers to personalize an empty dashboard, hiding the guide once it is closed', async () => {
    route({
      layout: () => Response.json({ items: [{ id: 'guide-demarrer', size: 'L' }], isDefault: false, profile: 'owner' }),
      onboarding: guide({ dismissed: true }),
    })
    const user = userEvent.setup()
    render(<Dashboard companyId="c1" />)
    expect(await screen.findByText('Aucun widget sur votre tableau de bord')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: 'Personnaliser' })
    await user.click(buttons[buttons.length - 1])
    expect(screen.getByRole('button', { name: 'Ajouter un widget' })).toBeInTheDocument()
  })

  it('reopens a hidden guide from the Démarrer button', async () => {
    route({ onboarding: guide({ dismissed: true }) })
    const user = userEvent.setup()
    render(<Dashboard companyId="c1" />)
    await user.click(await screen.findByRole('button', { name: 'Démarrer' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/companies/c1/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reopen' }),
      }),
    )
  })

  it('reopens the guide asked for from the help menu, then cleans the URL', async () => {
    searchParams.current = new URLSearchParams('guide=1')
    route({ onboarding: guide({ dismissed: true }) })
    render(<Dashboard companyId="c1" />)
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/c1', { scroll: false }))
    expect(fetchMock).toHaveBeenCalledWith('/api/companies/c1/onboarding', expect.objectContaining({ method: 'POST' }))
  })

  it('only cleans the URL when the guide is already open', async () => {
    searchParams.current = new URLSearchParams('guide=1')
    route({ onboarding: guide() })
    render(<Dashboard companyId="c1" />)
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/c1', { scroll: false }))
    expect(fetchMock).not.toHaveBeenCalledWith('/api/companies/c1/onboarding', expect.objectContaining({ method: 'POST' }))
    expect(screen.queryByRole('button', { name: 'Démarrer' })).not.toBeInTheDocument()
  })
})
