/**
 * Bilan pédagogique et financier page (TrainingReportPage): frame C from the
 * books, the checks, the deadline, the origin of a customer and the frames
 * saved by an accountant, nothing to change for a viewer. fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/bilan-pedagogique-financier',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { toast } from 'sonner'
import { TrainingReportPage } from '../training-report-page'
import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { grantedPermissions } from '@/lib/rbac/granted-permissions'
import { EMPTY_TRAINING_REPORT } from '@/lib/training-report/schemas'
import { TRAINING_ORIGINS } from '@/lib/training-report/origins'

const lines = TRAINING_ORIGINS.filter((o) => o.code !== 'none').map((o) => ({ code: o.code, line: o.line, label: o.label, cents: o.code === 'c1' ? 6_000_000 : 0, euros: o.code === 'c1' ? 60_000 : 0 }))
const VIEW = {
  today: '2027-04-05',
  trainingOrganisation: true,
  establishments: [{ id: 'e1', name: 'Siège', siret: '98000020100011', declarationNumber: '11755555575' }],
  fiscalYears: [{ id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }],
  fiscalYear: { id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false },
  deadline: { date: '2027-04-29', extendedDate: null },
  revenue: [{ code: '706100', label: 'Formations', tiers: { id: 't2', name: 'OPCO Atlas' }, cents: 4_000_000, origin: null, source: 'unassigned' }],
  turnoverCents: 10_000_000,
  frameC: { lines, opcoTotalEuros: 0, totalEuros: 60_000, outsideEuros: 0, unassignedCents: 4_000_000, sharePercent: 60 },
  frameD: { total: { euros: 1_100, source: 'books' }, trainerSalaries: { euros: 0, source: 'books' }, trainingPurchases: { euros: 0, source: 'books' } },
  data: EMPTY_TRAINING_REPORT,
  totals: { trainees: { count: 0, hours: 0 }, objectives: { count: 0, hours: 0 }, specialities: { count: 0, hours: 0 } },
  checks: ['1 client(s) et des comptes n’ont pas d’origine : affectez chaque compte de produits ou chaque client à une ligne du cadre C.'],
  customers: [{ id: 't2', name: 'OPCO Atlas', auxiliaryAccountNumber: 'C00002', trainingOrigin: null, cents: 4_000_000 }],
  accountOrigins: [],
  sources: [{ label: 'Formulaire cerfa n° 10443*17', url: 'https://www.formulaires.service-public.gouv.fr/gf/cerfa_10443_17.do' }],
}

let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function renderAs(role: 'accountant' | 'viewer') {
  return render(
    <CompanyAccessProvider value={{ granted: grantedPermissions([role], false), roleLabel: role }}>
      <TrainingReportPage companyId="c1" />
    </CompanyAccessProvider>,
  )
}

beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'PUT' ? respond(200, { fiscalYearId: 'fy26' }) : respond(200, VIEW)))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('bilan pédagogique et financier page', () => {
  it('shows frame C, the checks and the deadline, read only for a viewer', async () => {
    renderAs('viewer')
    expect(await screen.findByRole('heading', { level: 2, name: 'C. Origine des produits (hors taxes)' })).toBeInTheDocument()
    expect(screen.getByText(/affectez chaque compte de produits ou chaque client/)).toBeInTheDocument()
    expect(screen.getByText('60 % du chiffre d’affaires')).toBeInTheDocument()
    expect(screen.getByText('Code du travail, art. R6352-23')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enregistrer le bilan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'CSV' })).not.toBeInTheDocument()
  })

  it('saves the frames for an accountant and offers the CSV', async () => {
    const user = userEvent.setup()
    renderAs('accountant')
    const employees = await screen.findByLabelText('Salariés d’employeurs privés hors apprentis, nombre')
    await user.clear(employees)
    await user.type(employees, '12')
    await user.click(screen.getByRole('button', { name: 'Enregistrer le bilan' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Bilan enregistré'))
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    const body = JSON.parse(String((put?.[1] as RequestInit).body))
    expect(body.fiscalYearId).toBe('fy26')
    expect(body.data.trainees.employees).toEqual({ count: 12, hours: 0 })
    expect(screen.getByRole('link', { name: 'CSV' })).toHaveAttribute('href', '/api/companies/c1/training-report/export?fiscalYearId=fy26&format=csv')
  })
})
