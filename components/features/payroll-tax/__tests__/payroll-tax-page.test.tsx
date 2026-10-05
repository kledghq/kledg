/**
 * Taxe sur les salaires page (PayrollTaxPage): liability and rapport, the
 * computation of the 2502, the schedule, the bases saved in cents by an
 * accountant. fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/taxe-sur-les-salaires',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { toast } from 'sonner'
import { PayrollTaxPage } from '../payroll-tax-page'
import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { grantedPermissions } from '@/lib/rbac/granted-permissions'

const VIEW = {
  today: '2027-04-05',
  year: 2026,
  years: [2027, 2026],
  covered: true,
  data: { employees: [{ id: 'e1', label: 'Formatrice', baseCents: 3_000_000 }], association: false, ratioPercent: null, previousYearTaxCents: null, note: null },
  reference: { year: 2025, nonDeductibleCents: 5_000_000, totalCents: 10_000_000, toClassifyCents: 0 },
  ratio: { source: 'books', exactBasisPoints: 5_000, truncatedPercent: 50, appliedPercent: 50 },
  liability: 'liable',
  computation: { baseCents: 3_800_000, firstBracketCents: 919_400, secondBracketCents: 1_157_700, taxBaseCents: 161_500, taxFirstCents: 39_100, taxSecondCents: 108_200, grossCents: 308_800, ratioPercent: 50, afterRatioCents: 154_400, franchise: false, decoteCents: 37_200, afterDecoteCents: 117_200, abatementCents: 0, dueCents: 117_200 },
  booksSalariesCents: 3_800_000,
  enteredBasesCents: 3_000_000,
  previous: { taxCents: null, source: 'none' },
  frequency: 'annual',
  schedule: [{ key: '2026', label: 'Déclaration annuelle 2502 des salaires 2026', date: '2027-01-15', extendedDate: '2027-01-31' }],
  draft: { reference: 'TS-2026', status: 'none', entryId: null, entryNumber: null },
  hints: [],
  sources: [{ label: 'CGI, art. 231', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051764961' }],
}

let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function renderAs(role: 'accountant' | 'viewer') {
  return render(
    <CompanyAccessProvider value={{ granted: grantedPermissions([role], false), roleLabel: role }}>
      <PayrollTaxPage companyId="c1" />
    </CompanyAccessProvider>,
  )
}

beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'PUT' ? respond(200, { year: 2026, computed: { liable: true, frequency: 'annual', dueCents: 117_200 } }) : respond(200, VIEW)))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('taxe sur les salaires page', () => {
  it('shows the liability, the computation and the 2502', async () => {
    renderAs('viewer')
    expect(await screen.findByRole('heading', { level: 2, name: 'Calcul de la déclaration 2502' })).toBeInTheDocument()
    expect(screen.getByText('Redevable')).toBeInTheDocument()
    expect(screen.getByText('Après le rapport de 50 %').closest('div')?.parentElement).toHaveTextContent(/1\s544\s€/)
    expect(screen.getByText('Décote').closest('div')?.parentElement).toHaveTextContent(/372\s€/)
    expect(screen.getByText('Déclaration annuelle 2502 des salaires 2026')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument()
  })

  it('saves the bases in cents for an accountant', async () => {
    const user = userEvent.setup()
    renderAs('accountant')
    await user.click(await screen.findByRole('button', { name: 'Ajouter un salarié' }))
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Taxe sur les salaires 2026 enregistrée'))
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    const body = JSON.parse(String((put?.[1] as RequestInit).body))
    expect(body.year).toBe(2026)
    expect(body.data.employees[0]).toEqual({ id: 'e1', label: 'Formatrice', baseCents: 3_000_000 })
    expect(body.data.employees).toHaveLength(2)
  })
})
