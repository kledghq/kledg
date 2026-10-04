/**
 * SIG et ratios page: the fiscal year it asks for, the four headline tiles,
 * each section with N, N-1 and the variation, the exports offered to a role
 * that may export, and the French error with a retry. fetch is mocked; the
 * figures are the worked example computed by the real pure modules.
 */

import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const access = vi.hoisted(() => ({ canExport: true }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/reports/sig',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/features/onboarding/reports-empty-hint', () => ({ ReportsEmptyHint: () => null }))
vi.mock('@/components/features/companies/company-access', () => ({
  useCompanyAccess: () => ({ roleLabel: 'Comptable', can: () => access.canExport, denied: () => '' }),
}))
vi.mock('@/components/features/accounting/fiscal-year-selector', () => ({
  FiscalYearSelector: ({ onValueChange }: { onValueChange: (id: string) => void }) => {
    useEffect(() => onValueChange('fy-2026'), [onValueChange])
    return null
  },
}))

import SigPage from '../page'
import { computeFinancialIndicators } from '@/lib/reports/financial-indicators/indicators'
import { WORKED_EXAMPLE_ACCOUNTS, WORKED_EXAMPLE_VAT } from '@/lib/reports/financial-indicators/__tests__/worked-example'

const current = computeFinancialIndicators({ accounts: WORKED_EXAMPLE_ACCOUNTS, vat: WORKED_EXAMPLE_VAT, days: 365 })
// The previous year: the same ledger without the services sold (706 000: 100 000 €).
const previous = computeFinancialIndicators({ accounts: WORKED_EXAMPLE_ACCOUNTS.filter((a) => a.code !== '706000'), vat: WORKED_EXAMPLE_VAT, days: 365 })
const fiscalYear = (id: string, year: number) => ({ id, year, startDate: `${year}-01-01`, endDate: `${year}-12-31`, isClosed: false, asOf: `${year}-12-31` })
const REPORT = { fiscalYear: fiscalYear('fy-2026', 2026), current, previous: { fiscalYear: fiscalYear('fy-2025', 2025), indicators: previous } }

let fetchMock: ReturnType<typeof vi.fn>
let failing = false
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  failing = false
  access.canExport = true
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/reports/financial-indicators') {
      return failing ? respond(404, { error: 'Exercice introuvable pour cette société.' }) : respond(200, REPORT)
    }
    if (url.pathname === '/api/reports/financial-indicators/export') return new Response(new Blob(['file']), { status: 200 })
    return respond(404, { error: 'unexpected' })
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sig')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const requested = (pathname: string) =>
  fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((url) => url.pathname === pathname)
    .map((url) => Object.fromEntries(url.searchParams))

const text = (element: HTMLElement) => element.textContent?.replace(/\s/g, ' ') ?? ''

describe('SIG page', () => {
  it('shows the cascade of the year next to the previous one, with the variation', async () => {
    render(<SigPage />)
    await waitFor(() => expect(requested('/api/reports/financial-indicators')).toEqual([{ companyId: 'c1', fiscalYearId: 'fy-2026' }]))
    expect(await screen.findByRole('heading', { level: 1, name: 'Soldes intermédiaires de gestion' })).toBeInTheDocument()

    const ebe = screen.getByText("Excédent brut d'exploitation (EBE)").closest('tr') as HTMLElement
    // 61 500 € in 2026; 100 000 € of services less in 2025: 61 500 - 100 000 = -38 500 €.
    const cells = within(ebe).getAllByRole('cell').map(text)
    expect(cells[1]).toContain('61 500,00')
    expect(cells[2]).toContain('-38 500,00')
    expect(cells[3]).toContain('100 000,00')
    expect(screen.getAllByText('Exercice 2025').length).toBeGreaterThan(0)

    const caf = screen.getByText("Capacité d'autofinancement (CAF)").closest('tr') as HTMLElement
    expect(text(caf)).toContain('50 000,00')
    const dso = screen.getByText('Délai de paiement des clients (DSO)').closest('tr') as HTMLElement
    expect(text(dso)).toContain('61 j')
    const endettement = screen.getByText("Ratio d'endettement").closest('tr') as HTMLElement
    expect(text(endettement)).toContain('26,3 %')
    expect(screen.getByText(/sur 365 jours/)).toBeInTheDocument()
  })

  it('exports the year shown as CSV or Excel, and hides the exports from a role that may not export', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<SigPage />)
    await screen.findByText("Excédent brut d'exploitation (EBE)")
    await user.click(screen.getByRole('button', { name: 'Exporter en CSV' }))
    await user.click(screen.getByRole('button', { name: 'Exporter en Excel' }))
    expect(requested('/api/reports/financial-indicators/export')).toEqual([
      { companyId: 'c1', fiscalYearId: 'fy-2026', format: 'csv' },
      { companyId: 'c1', fiscalYearId: 'fy-2026', format: 'xlsx' },
    ])
    unmount()

    access.canExport = false
    render(<SigPage />)
    await screen.findByText("Excédent brut d'exploitation (EBE)")
    expect(screen.queryByRole('button', { name: 'Exporter en CSV' })).toBeNull()
  })

  it('shows the French error with a retry', async () => {
    failing = true
    const user = userEvent.setup()
    render(<SigPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Exercice introuvable pour cette société.')
    failing = false
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText("Excédent brut d'exploitation (EBE)")).toBeInTheDocument()
  })
})
