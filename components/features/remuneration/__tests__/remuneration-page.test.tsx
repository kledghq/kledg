/**
 * Rémunération et dividendes page (RemunerationPage) and the simple home
 * card: the disclaimer, the scenarios computed in the browser with the same
 * module as the server, a change of the inputs, saving a scenario by role,
 * proposing its dividends, the company at the impôt sur le revenu, and the
 * plain-words card. fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  usePathname: () => '/c1/remuneration',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { toast } from 'sonner'
import { RemunerationPage } from '../remuneration-page'
import { RemunerationSimpleCard } from '../remuneration-simple-card'
import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { grantedPermissions } from '@/lib/rbac/granted-permissions'
import { simulate } from '@/lib/remuneration/simulate'
import type { RemunerationInputs } from '@/lib/remuneration/schemas'

const INPUTS: RemunerationInputs = {
  resultBeforePayCents: 10_000_000,
  status: 'assimile',
  reducedRate: true,
  reducedRateCeilingCents: 4_250_000,
  legalReserveRequired: true,
  capitalCents: 100_000,
  legalReserveCents: 10_000,
  priorLossesCents: 0,
  shareBp: 10_000,
  premiumsCents: 0,
  currentAccountCents: 0,
  householdParts: 1,
  otherIncomeCents: 0,
  dividendTaxation: 'best',
  distributionBp: 10_000,
  mixBp: 5_000,
}
const FY = { id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }
const SCENARIO = { id: 's1', fiscalYearId: 'fy26', name: 'Optimum', inputs: INPUTS, rulesYear: 2026, remunerationCostCents: 86_000, dividendsCents: 7_860_500, netIncomeCents: 5_882_558, updatedAt: '2026-10-05T10:00:00.000Z' }
const VIEW = {
  today: '2026-10-05',
  status: 'ready',
  rulesYear: 2026,
  passCents: 4_806_000,
  legalType: 'SASU',
  fiscalYears: [FY],
  fiscalYear: FY,
  bases: [{ basis: 'current', label: 'Exercice 2026 à ce jour', fiscalYear: FY, resultBeforeTaxCents: 10_000_000, directorPayBookedCents: 0, resultBeforePayCents: 10_000_000, daysElapsed: 278, daysInYear: 365 }],
  basis: 'current',
  shareholders: [{ id: 'sh1', name: 'Claire Martin', shareBp: 10_000, natural: true }],
  statusReason: 'SASU : le président est assimilé salarié.',
  reducedRateEligible: true,
  defaults: INPUTS,
  inputs: INPUTS,
  scenario: null,
  simulation: simulate(INPUTS),
  scenarios: [SCENARIO],
  approval: { proposedDividendsCents: null },
  currentAccountsCents: 0,
  checks: ['Une vérification des comptes.'],
  sources: [{ label: 'CGI, art. 219, I', url: 'https://www.legifrance.gouv.fr' }],
}

let fetchMock: ReturnType<typeof vi.fn>
let view: Record<string, unknown> = VIEW
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function renderAs(role: 'accountant' | 'viewer') {
  return render(
    <CompanyAccessProvider value={{ granted: grantedPermissions([role], false), roleLabel: role === 'viewer' ? 'Lecture seule' : 'Comptable' }}>
      <RemunerationPage companyId="c1" />
    </CompanyAccessProvider>,
  )
}

beforeEach(() => {
  view = VIEW
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return respond(200, SCENARIO)
    if (init?.method === 'POST') return respond(200, { fiscalYearId: 'fy26', dividendsCents: 7_860_500 })
    return respond(200, view)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('RemunerationPage', () => {
  it('says it is a simulation and shows the four scenarios with the same figures as the server', async () => {
    renderAs('viewer')
    expect(await screen.findByText('Simulation indicative, pas un conseil')).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/companies/c1/remuneration')
    expect(screen.getAllByText('Tout en dividendes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Optimum calculé').length).toBeGreaterThan(0)
    // All in dividends: 58 757,21 € net (lib/remuneration/__tests__/simulate.test.ts)
    expect(screen.getAllByText(/58\s757,21/).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /CGI, art. 219, I/ })).toHaveAttribute('href', 'https://www.legifrance.gouv.fr')
    // A viewer sees why it cannot save
    expect(screen.getByText(/ne permet pas/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enregistrer le scénario' })).toBeDisabled()
  })

  it('recomputes when an input changes, and goes back to the books', async () => {
    const user = userEvent.setup()
    renderAs('viewer')
    await screen.findByText('Simulation indicative, pas un conseil')
    const share = screen.getByLabelText('Part du capital détenue par le dirigeant')
    await user.clear(share)
    await user.type(share, '50')
    // Half the dividends of 79 250 €
    await waitFor(() => expect(screen.getAllByText(/39\s625,00/).length).toBeGreaterThan(0))
    await user.click(screen.getByRole('button', { name: /Revenir aux chiffres des comptes/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Revenir aux chiffres des comptes/ })).not.toBeInTheDocument())
  })

  it('saves a scenario and proposes its dividends for an accountant', async () => {
    const user = userEvent.setup()
    renderAs('accountant')
    await screen.findByText('Simulation indicative, pas un conseil')
    await user.type(screen.getByLabelText('Nom du scénario'), 'Mixte')
    await user.click(screen.getByRole('button', { name: 'Enregistrer le scénario' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Scénario enregistré'))
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT') as [string, RequestInit]
    expect(put[0]).toBe('/api/companies/c1/remuneration/scenarios')
    expect(JSON.parse(String(put[1].body))).toEqual({ fiscalYearId: 'fy26', name: 'Mixte', inputs: INPUTS, pick: 'optimum' })
    await user.click(screen.getByRole('button', { name: /Proposer à l’approbation/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Dividendes proposés dans l’approbation des comptes'))
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST') as [string, RequestInit]
    expect(post[0]).toBe('/api/companies/c1/remuneration/propose-dividends')
    expect(JSON.parse(String(post[1].body))).toEqual({ scenarioId: 's1' })
  })

  it('has nothing to simulate for a company at the impôt sur le revenu', async () => {
    view = { ...VIEW, status: 'not-subject', simulation: null, inputs: null }
    renderAs('viewer')
    expect(await screen.findByText('Société à l’impôt sur le revenu')).toBeInTheDocument()
  })
})

describe('RemunerationSimpleCard', () => {
  it('says in plain words how much the director could keep', async () => {
    render(<RemunerationSimpleCard companyId="atelier" />)
    expect(await screen.findByText(/vous pourriez garder environ/)).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/companies/atelier/remuneration')
    expect(screen.getByRole('link', { name: 'Voir le détail' })).toHaveAttribute('href', '/atelier/remuneration')
  })

  it('renders nothing for a company at the impôt sur le revenu', async () => {
    view = { ...VIEW, status: 'not-subject', simulation: null, inputs: null }
    const { container } = render(<RemunerationSimpleCard companyId="atelier" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
