/**
 * Coefficient de déduction page (VatDeductionPage): the provisional and
 * definitive coefficients, where the revenue comes from, the regularisation
 * and its line of the return, the account treatment saved by an
 * accountant, nothing to change for a viewer. fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/coefficient-tva',
  useSearchParams: () => search,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { toast } from 'sonner'
import { VatDeductionPage } from '../vat-deduction-page'
import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { grantedPermissions } from '@/lib/rbac/granted-permissions'

const VIEW = {
  today: '2027-04-05',
  year: 2026,
  years: [2027, 2026, 2025],
  mode: 'coefficient',
  partialVatDeduction: true,
  isVatExempt: false,
  trainingOrganisation: true,
  revenue: {
    accounts: [
      { code: '706100', label: 'Formations intra', totalCents: 6_000_000, setting: null, source: 'books', taxableCents: 6_000_000, exemptCents: 0, excludedCents: 0, toClassifyCents: 0 },
      { code: '706200', label: 'Formations financées', totalCents: 4_000_000, setting: null, source: 'books', taxableCents: 0, exemptCents: 3_000_000, excludedCents: 0, toClassifyCents: 1_000_000 },
    ],
    taxableCents: 6_000_000,
    exemptCents: 3_000_000,
    excludedCents: 0,
    toClassifyCents: 1_000_000,
    numeratorCents: 6_000_000,
    denominatorCents: 10_000_000,
  },
  yearClosed: true,
  taxationPercent: 60,
  provisional: { year: 2026, taxationPercent: 50, source: 'previous-year', assujettissementPercent: 100, deductionPercent: 50 },
  definitiveDeductionPercent: 60,
  coefficientLine: '22A',
  regularisation: {
    deductedCents: 10_000,
    incurredCents: 20_000,
    incurredSource: 'books',
    amountCents: 2_000,
    form: 'CA3',
    line: { code: '21', box: '0059', label: 'Autre TVA à déduire' },
    deadline: '2027-04-24',
    entryDate: '2027-03-31',
    draft: { reference: 'COEF-TVA-2026', status: 'none', entryId: null, entryNumber: null },
  },
  settings: { estimatedTaxationPercent: null, assujettissementPercent: 100, incurredVatCents: null, note: null },
  accountSettings: [],
  hints: ['Des ventes sans TVA ni exonération sont à classer.'],
  sources: [{ label: 'CGI, annexe II, art. 206', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000036174761/' }],
}

let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function renderAs(role: 'accountant' | 'viewer') {
  return render(
    <CompanyAccessProvider value={{ granted: grantedPermissions([role], false), roleLabel: role }}>
      <VatDeductionPage companyId="c1" />
    </CompanyAccessProvider>,
  )
}

beforeEach(() => {
  search = new URLSearchParams()
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'PUT' ? respond(200, { saved: ['accounts'] }) : respond(200, VIEW)))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('coefficient de déduction page', () => {
  it('shows the coefficients, the revenue to classify and the regularisation on line 21', async () => {
    renderAs('viewer')
    expect(await screen.findByRole('heading', { level: 2, name: 'D’où viennent les recettes 2026' })).toBeInTheDocument()
    expect(screen.getByText('Coefficient provisoire 2026').closest('div')?.parentElement).toHaveTextContent('50 %')
    expect(screen.getByText('Coefficient définitif 2026').closest('div')?.parentElement).toHaveTextContent('60 %')
    expect(screen.getByText(/ligne 22A de la déclaration/)).toBeInTheDocument()
    expect(screen.getByText('Ligne 21 de la CA3 (case 0059)')).toBeInTheDocument()
    expect(screen.getByText('Des ventes sans TVA ni exonération sont à classer.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Préparer l’écriture' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Traitement du compte 706200')).not.toBeInTheDocument()
  })

  it('lets an accountant prepare the regularisation', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      init?.method === 'POST' ? respond(201, { status: 'created', message: 'Régularisation préparée en brouillon' }) : respond(200, VIEW),
    )
    renderAs('accountant')
    await user.click(await screen.findByRole('button', { name: 'Préparer l’écriture' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Régularisation préparée en brouillon'))
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(String(post?.[0])).toBe('/api/companies/c1/vat-deduction/regularisation')
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ year: 2026 })
  })
})
