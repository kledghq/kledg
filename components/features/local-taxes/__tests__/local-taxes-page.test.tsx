/**
 * Impôts locaux page (LocalTaxesPage): the CFE from the avis (acompte of
 * 50 % of last year, balance, charge on 63511), the CVAE from the books at
 * the rate of 2026, the deadlines with their status, the inputs by role,
 * an abolished year (2030) and the errors. fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const replace = vi.fn()
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  usePathname: () => '/c1/impots-locaux',
  useSearchParams: () => search,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { toast } from 'sonner'
import { LocalTaxesPage } from '../local-taxes-page'
import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { grantedPermissions } from '@/lib/rbac/granted-permissions'
import { deriveStatus } from '@/lib/declarations/status'
import type { Deadline } from '@/lib/deadlines/types'

const cfeDeadline: Deadline = { id: 'cfe:2026', date: '2026-12-15', legalDate: '2026-12-15', label: 'Solde de la CFE 2026', form: 'CFE', category: 'cfe', ruleId: 'cfe', estimated: false, projected: false }

const VIEW = {
  today: '2026-10-05',
  year: 2026,
  years: [2027, 2026, 2025],
  foundationYear: 2020,
  settings: { cfeAcompte: false, cfeChanges: false, cvae: false, cvaeDue: false, cvaeAcomptes: false },
  cfe: {
    situation: 'normal',
    avis: { totalCents: 400_000, acompteCents: null, noticeOn: '2026-09-20', note: null },
    previous: { year: 2025, totalCents: 350_000 },
    schedule: { acompteCents: 175_000, acompteFrom: 'previous-year', balanceCents: 225_000 },
    expected: { year: 2026, cents: 400_000, source: 'avis', account: { code: '63511', label: 'Contribution économique territoriale' }, months: [{ month: '2026-06', cents: 175_000 }, { month: '2026-12', cents: 225_000 }] },
    minimum: { referenceYear: 2024, turnoverCents: null, exempt: null },
    drafts: { acompte: { reference: 'CFE-2026-AC', status: 'none', entryId: null, entryNumber: null }, solde: { reference: 'CFE-2026-SOLDE', status: 'none', entryId: null, entryNumber: null } },
  },
  cvae: {
    year: 2026,
    status: 'in-force',
    maxRate: '0,28 %',
    period: { fiscalYears: [{ id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false, inProgress: true }], months: 12, days: 365, estimate: true },
    books: { turnoverCents: 270_000_000, sigValueAddedCents: 120_000_000, subsidiesCents: 0, otherProductsCents: 0, chargeTransfersCents: 0, otherChargesCents: 0, valueAddedCents: 120_000_000 },
    adjustments: [],
    adjustmentsCents: 0,
    turnoverAnnualCents: 270_000_000,
    computation: {
      year: 2026,
      status: 'in-force',
      declarationRequired: true,
      taxable: true,
      valueAdded: { beforeCapCents: 120_000_000, capCents: 216_000_000, capped: false, cents: 120_000_000 },
      rateHundredths: 8,
      rateLabel: '0,08 %',
      grossCents: 96_000,
      degrevementCents: 0,
      cvaeCents: 96_000,
      franchise: false,
      complementaryCents: 0,
      totalCents: 96_000,
    },
    previous: { year: 2025, cvaeCents: 0 },
    acomptes: { due: false, eachCents: null },
    hints: ['Votre chiffre d’affaires dépasse 152 500 € : la déclaration 1330-CVAE est due. Activez-la dans les paramètres des échéances.'],
  },
  plafonnement: { rate: 1531, ceilingCents: 1_837_200, excessCents: 0 },
  deadlines: [{ ...cfeDeadline, status: deriveStatus(cfeDeadline, null, null, '2026-10-05') }],
  sources: [{ label: 'CGI, art. 1586 quater', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048860944' }],
}

let view: unknown
let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function renderAs(role: 'accountant' | 'viewer') {
  return render(
    <CompanyAccessProvider value={{ granted: grantedPermissions([role], false), roleLabel: role === 'viewer' ? 'Lecture seule' : 'Comptable' }}>
      <LocalTaxesPage companyId="c1" />
    </CompanyAccessProvider>,
  )
}

beforeEach(() => {
  view = VIEW
  search = new URLSearchParams()
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'PUT' ? respond(200, { year: 2026, saved: ['cfeTotal'] }) : respond(200, view)))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('local taxes page', () => {
  it('shows the CFE from the avis, the CVAE of 2026 and the deadlines with their status', async () => {
    renderAs('viewer')
    expect(await screen.findByRole('heading', { level: 2, name: 'Cotisation foncière des entreprises 2026' })).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/companies/c1/local-taxes')
    expect(screen.getByText('Acompte du 15 juin').closest('div')?.parentElement).toHaveTextContent(/1\s750,00\s€/)
    expect(screen.getByText(/50\s% de la CFE de l’année précédente/)).toBeInTheDocument()
    expect(screen.getByText('Charge prévue au compte 63511')).toBeInTheDocument()
    expect(screen.getByText('0,08 %')).toBeInTheDocument()
    expect(screen.getByText(/Taux maximal de 0,28 % en 2026/)).toBeInTheDocument()
    expect(screen.getByText(/la déclaration 1330-CVAE est due/)).toBeInTheDocument()
    const deadlines = screen.getByRole('list', { name: 'Échéances des impôts locaux' })
    expect(within(deadlines).getByText('Solde de la CFE 2026')).toBeInTheDocument()
    expect(within(deadlines).getByText(/dans 71 jours/)).toBeInTheDocument()
    // Read-only: no inputs, no drafts, no marks
    expect(screen.queryByRole('button', { name: 'Enregistrer l’avis' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Préparer le solde/ })).not.toBeInTheDocument()
    expect(within(deadlines).queryByRole('button', { name: /Enregistrer/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'PDF' })).not.toBeInTheDocument()
  })

  it('saves the avis for an accountant and reloads', async () => {
    const user = userEvent.setup()
    renderAs('accountant')
    const total = await screen.findByLabelText('Montant de l’avis')
    await user.clear(total)
    await user.type(total, '4200')
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’avis' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Avis de CFE enregistré'))
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({ year: 2026, cfe: { totalCents: 420_000, acompteCents: null, noticeOn: '2026-09-20' } })
    expect(screen.getByRole('link', { name: 'PDF' })).toHaveAttribute('href', '/api/companies/c1/local-taxes/export?year=2026&format=pdf')
  })

  it('says the CVAE is abolished from 2030', async () => {
    search = new URLSearchParams({ annee: '2030' })
    view = { ...VIEW, year: 2030, years: [2030, 2029], cvae: { ...VIEW.cvae, year: 2030, status: 'abolished', maxRate: null, computation: null, hints: [] }, plafonnement: null, deadlines: [] }
    renderAs('viewer')
    expect(await screen.findByText(/La CVAE est supprimée à partir de 2030/)).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/companies/c1/local-taxes?year=2030')
    expect(screen.getByText('Supprimée')).toBeInTheDocument()
  })

  it('shows the error of the API', async () => {
    fetchMock.mockResolvedValueOnce(respond(500, { error: 'Les impôts locaux ne se sont pas calculés.' }))
    renderAs('viewer')
    expect(await screen.findByText('Les impôts locaux ne se sont pas calculés.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })
})
