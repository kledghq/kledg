/**
 * Prévision de trésorerie page and status cards: the flows of the API
 * projected in the browser (a component switched off changes the curve and
 * the alert at once), late flows counted on the first day, the threshold
 * saved with the components on screen, the simple mode in plain words, no
 * export nor form for a read-only member, and the status card of the
 * dashboard and of the simple home, loaded after the page in a slot of
 * fixed height.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/acme/prevision-tresorerie' }))

import { toast } from 'sonner'
import { CashForecastPage } from '../cash-forecast-page'
import { CashForecastAlertCard, CashForecastStatusCard } from '../cash-forecast-alert'
import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { grantedPermissions } from '@/lib/rbac/granted-permissions'
import { CASH_FORECAST_COMPONENTS } from '@/lib/cash-forecast/components'
import { projectCashForecast, type CashFlowItem } from '@/lib/cash-forecast/projection'
import type { CashForecastStatus, CashForecastView } from '@/lib/cash-forecast/load-cash-forecast.service'
import type { CashForecastAlert } from '@/lib/cash-forecast/alert'
import { jargonIn } from '@/lib/simple/vocabulary'

const plain = (text: string | null) => (text ?? '').replace(/[\s  ]+/g, ' ').trim()

const items: CashFlowItem[] = [
  { component: 'receivables', label: 'Studio Nord', day: '2026-10-20', amountCents: 120_000 },
  { component: 'taxes', label: 'Paiement de la CFE 2025', day: '2025-12-15', amountCents: -10_000, ruleId: 'cfe', overdue: true },
  { component: 'taxes', label: "Solde de l'IS de l'exercice clos le 31/12/2025", day: '2026-11-16', amountCents: -900_000, ruleId: 'is-solde' },
  { component: 'payables', label: 'Imprimerie Morel', day: '2026-11-30', amountCents: -30_000 },
  { component: 'budget', label: 'Rentrées prévues au budget, novembre 2026', day: '2026-11-01', until: '2026-11-30', amountCents: 200_000 },
]

const VIEW: CashForecastView = {
  today: '2026-10-05',
  start: '2026-10-06',
  end: '2027-01-05',
  horizonMonths: 3,
  granularity: 'month',
  settings: { thresholdCents: 500_000, horizonMonths: 3, components: ['receivables', 'payables', 'taxes', 'recurring'] },
  opening: { cents: 1_000_000, source: 'bank', bankAccounts: 2, otherCurrencies: 0, ledgerCents: 990_000 },
  items,
  truncated: 0,
  unknownTaxes: [{ day: '2026-12-15', label: "4e acompte d'IS de l'exercice clos le 31/12/2026", ruleId: 'is-acompte' }],
  trend: null,
  availability: Object.fromEntries(
    CASH_FORECAST_COMPONENTS.map((c) => [c, c === 'recurring' || c === 'trend' ? { available: false, reason: 'Aucun paiement récurrent détecté dans les opérations bancaires.' } : { available: true, reason: null }]),
  ) as CashForecastView['availability'],
  projection: projectCashForecast({
    today: '2026-10-05',
    horizonMonths: 3,
    granularity: 'month',
    openingCents: 1_000_000,
    items,
    components: ['receivables', 'payables', 'taxes', 'recurring'],
    thresholdCents: 500_000,
  }),
}

describe('CashForecastPage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        return new Response(JSON.stringify({ settings: body, isDefault: false }), { status: 200 })
      }
      return new Response(JSON.stringify(VIEW), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('projects the known flows, alerts on the first day under the threshold, and recomputes when a flow is switched off', async () => {
    const user = userEvent.setup()
    render(<CashForecastPage companyId="acme" mode="expert" />)

    const alert = await screen.findByRole('alert')
    expect(fetchMock).toHaveBeenCalledWith('/api/cash-forecast?companyId=acme')
    expect(within(alert).getByText('Trésorerie prévue sous le seuil')).toBeInTheDocument()
    // 10 000 - 100 of late CFE tomorrow + 1 200 on 20 October, then - 9 000 of IS on 16 November: 2 100 €, under 5 000 €.
    expect(plain(alert.textContent)).toContain('passe sous le seuil de 5 000,00 € le 16 novembre 2026 (2 100,00 €)')
    // The late CFE: its own day, and said counted tomorrow.
    const late = screen.getByText('Paiement de la CFE 2025').closest('li')!
    expect(plain(late.textContent)).toContain('En retard, compté demain')
    expect(plain(alert.textContent)).toContain('sans garantie')
    expect(plain(document.body.textContent)).toContain('Soldes déclarés par les banques, 2 comptes en euros')
    // The budget is an assumption: unchecked by default, its flow not listed.
    expect(screen.getByRole('checkbox', { name: /Budget/ })).not.toBeChecked()
    expect(screen.queryByText('Rentrées prévues au budget, novembre 2026')).toBeNull()
    expect(screen.getAllByText('Aucun paiement récurrent détecté dans les opérations bancaires.').length).toBeGreaterThan(0)
    expect(screen.getByText(/4e acompte d'IS/)).toBeInTheDocument()

    const periods = screen.getAllByRole('table')[0]
    const november = within(periods).getAllByRole('row').find((row) => row.textContent?.startsWith('Novembre 2026'))!
    expect(november).toHaveAttribute('data-below', 'true')
    expect(plain(november.textContent)).toContain('(sous le seuil)')

    // Without the IS, the balance never goes under 5 000 €.
    await user.click(screen.getByRole('checkbox', { name: /Impôts et taxes/ }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(plain(document.body.textContent)).toContain('Le solde projeté reste au-dessus du seuil de 5 000,00 € sur les 3 prochains mois.')
    // The budget on top of it: listed, counted.
    await user.click(screen.getByRole('checkbox', { name: /Budget/ }))
    expect(screen.getByText('Rentrées prévues au budget, novembre 2026')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /Exporter en CSV/ })).toHaveAttribute(
      'href',
      '/api/cash-forecast/export?companyId=acme&horizon=3&granularity=month&components=receivables%2Cpayables%2Crecurring%2Cbudget',
    )
  })

  it('saves the threshold with the horizon and the flows on screen', async () => {
    const user = userEvent.setup()
    render(<CashForecastPage companyId="acme" mode="expert" />)
    const input = await screen.findByRole('textbox', { name: /Solde minimum/ })
    await user.click(screen.getByRole('checkbox', { name: /Factures fournisseurs/ }))
    await user.clear(input)
    await user.type(input, '8 000')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Seuil enregistré'))
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')!
    expect(put[0]).toBe('/api/companies/acme/cash-forecast-settings')
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({ thresholdCents: 800_000, horizonMonths: 3, components: ['receivables', 'taxes', 'recurring'] })
  })

  it('reads in plain words in simple mode, without accounting terms or account numbers', async () => {
    render(<CashForecastPage companyId="acme" mode="simple" />)
    await screen.findByRole('alert')
    expect(screen.getByRole('heading', { level: 1, name: 'Votre argent dans les prochains mois' })).toBeInTheDocument()
    // What the user reads: the text without the chart's style sheet (CSS variable names).
    const shown = document.body.cloneNode(true) as HTMLElement
    shown.querySelectorAll('style').forEach((style) => style.remove())
    const text = plain(shown.textContent)
    expect(text).toContain('Votre compte risque de passer sous 5 000,00 € le 16 novembre 2026')
    expect(text).toContain('D’après vos banques (2 comptes)')
    // A tax by its plain title, not by the label of the calendar ("exercice").
    expect(text).not.toContain("Solde de l'IS")
    expect(jargonIn(text)).toEqual([])
  })

  it('shows neither export nor threshold form to a read-only member', async () => {
    render(
      <CompanyAccessProvider value={{ granted: grantedPermissions(['viewer'], false), roleLabel: 'Lecture seule' }}>
        <CashForecastPage companyId="acme" mode="expert" />
      </CompanyAccessProvider>,
    )
    await screen.findByRole('alert')
    expect(screen.queryByRole('link', { name: /Exporter/ })).toBeNull()
    expect(screen.queryByRole('textbox', { name: /Solde minimum/ })).toBeNull()
    expect(plain(document.body.textContent)).toContain('Solde minimum : 5 000,00 €')
  })

  it('says what failed and retries', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Société introuvable' }), { status: 404 }))
    const user = userEvent.setup()
    render(<CashForecastPage companyId="acme" mode="expert" />)
    expect(await screen.findByText('Société introuvable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('cash forecast status card', () => {
  const alert: CashForecastAlert = { thresholdCents: 500_000, horizonMonths: 6, day: '2026-11-16', balanceCents: 220_000, already: false, lowest: { day: '2026-11-30', cents: 190_000 } }
  const answer = (status: CashForecastStatus) => vi.fn(async () => new Response(JSON.stringify(status), { status: 200 }))

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('holds its place with a skeleton, then links the dashboard to the forecast when the projection crosses the threshold', async () => {
    const fetchMock = answer({ thresholdCents: 500_000, horizonMonths: 6, alert })
    vi.stubGlobal('fetch', fetchMock)
    render(<CashForecastStatusCard companyId="acme" mode="expert" href="/acme/prevision-tresorerie" />)
    const skeleton = screen.getByLabelText(/Chargement.*Prévision de trésorerie/)
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(skeleton.className).toContain('min-h-28')
    const card = await screen.findByRole('alert')
    expect(card.className).toContain('min-h-28')
    expect(fetchMock).toHaveBeenCalledWith('/api/cash-forecast/alert?companyId=acme')
    expect(plain(card.textContent)).toContain('Point le plus bas : 1 900,00 € le 30 novembre 2026')
    expect(within(card).getByRole('link', { name: 'Voir la prévision' })).toHaveAttribute('href', '/acme/prevision-tresorerie')
  })

  it('says the balance stays above the threshold, or invites to set one, in the same slot', async () => {
    vi.stubGlobal('fetch', answer({ thresholdCents: 500_000, horizonMonths: 6, alert: null }))
    const above = render(<CashForecastStatusCard companyId="acme" mode="expert" href="/acme/prevision-tresorerie" />)
    const status = await within(above.container).findByRole('region', { name: 'Prévision de trésorerie' })
    expect(plain(status.textContent)).toContain('Le solde projeté reste au-dessus du seuil de 5 000,00 € sur les 6 prochains mois.')
    expect(status.className).toContain('min-h-28')
    above.unmount()

    vi.stubGlobal('fetch', answer({ thresholdCents: null, horizonMonths: 6, alert: null }))
    render(<CashForecastStatusCard companyId="atelier-lumen" mode="simple" href="/atelier-lumen/prevision-tresorerie" />)
    const invite = await screen.findByRole('region', { name: 'Votre argent à venir' })
    expect(within(invite).getByText('Votre argent à venir')).toBeInTheDocument()
    expect(plain(invite.textContent)).toContain('Voyez ce qui devrait rester sur votre compte')
    expect(jargonIn(plain(invite.textContent))).toEqual([])
    expect(within(invite).getByRole('link', { name: 'Voir le détail' })).toHaveAttribute('href', '/atelier-lumen/prevision-tresorerie')
  })

  it('shows no invitation without a threshold to a member who may not set it (dashboard), but keeps the alert and the above line', async () => {
    vi.stubGlobal('fetch', answer({ thresholdCents: null, horizonMonths: 6, alert: null }))
    const none = render(<CashForecastStatusCard companyId="acme" mode="expert" href="/acme/prevision-tresorerie" invite={false} />)
    await waitFor(() => expect(none.container.querySelector('[aria-busy="true"]')).toBeNull())
    expect(none.container).toBeEmptyDOMElement()
    none.unmount()

    vi.stubGlobal('fetch', answer({ thresholdCents: 500_000, horizonMonths: 6, alert: null }))
    render(<CashForecastStatusCard companyId="acme" mode="expert" href="/acme/prevision-tresorerie" invite={false} />)
    expect(await screen.findByRole('region', { name: 'Prévision de trésorerie' })).toBeInTheDocument()
  })

  it('renders nothing, and asks nothing, for a member who may not read the bank', () => {
    const fetchMock = answer({ thresholdCents: null, horizonMonths: 6, alert: null })
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(
      <CompanyAccessProvider value={{ granted: grantedPermissions([], false), roleLabel: '' }}>
        <CashForecastStatusCard companyId="acme" mode="expert" href="/acme/prevision-tresorerie" />
      </CompanyAccessProvider>,
    )
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says it in plain words on the simple home', () => {
    render(<CashForecastAlertCard alert={{ ...alert, already: true, balanceCents: 300_000 }} mode="simple" href="/acme/prevision-tresorerie" />)
    const card = screen.getByRole('alert')
    expect(plain(card.textContent)).toContain('Votre compte est déjà sous 5 000,00 €, le minimum que vous voulez garder : il reste 3 000,00 €.')
    expect(plain(card.textContent)).toContain('pas une certitude')
    expect(jargonIn(plain(card.textContent))).toEqual([])
    expect(within(card).getByRole('link', { name: 'Voir le détail' })).toHaveAttribute('href', '/acme/prevision-tresorerie')
  })
})
