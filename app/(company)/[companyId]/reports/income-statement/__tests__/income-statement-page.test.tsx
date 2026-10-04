/**
 * Compte de résultat page: the fiscal year and variant it asks for, the
 * totals and the net result (produits minus charges, PCG art. 821-4 / notice
 * 2033-B), the configuration warnings and the exports of the year shown.
 * fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/reports/income-statement',
}))
vi.mock('@/components/features/onboarding/reports-empty-hint', () => ({ ReportsEmptyHint: () => null }))
vi.mock('@/components/features/reports/layout-notice', () => ({ LayoutNotice: () => null }))

import IncomeStatementPage from '../page'

const STATEMENT = {
  companyId: 'c1',
  fiscalYearId: 'fy-2026',
  reportVariant: 'complete',
  produits: { lines: [{ id: 'p1', lineLabel: 'Production vendue (services)', value: 12000.5, formCode: 'FG' }] },
  charges: { lines: [{ id: 'c1', lineLabel: 'Autres achats et charges externes', value: 4000.25, formCode: 'FW' }] },
  totalProduits: 12000.5,
  totalCharges: 4000.25,
  netResult: 8000.25,
  warnings: ['Le compte 658000 (Charges diverses) a un solde de 15,00 € et n’est rattaché à aucune ligne.'],
}

let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/companies/c1/fiscal-years') {
      return respond(200, [
        { id: 'fy-2025', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31' },
        { id: 'fy-2026', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' },
      ])
    }
    if (url.pathname === '/api/companies/c1/income-statement') return respond(200, STATEMENT)
    if (url.pathname.startsWith('/api/companies/c1/income-statement/export-')) return new Response(new Blob(['file']), { status: 200 })
    return respond(404, { error: 'unexpected' })
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cr')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const requested = (pathname: string) =>
  fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((url) => url.pathname === pathname)
    .map((url) => Object.fromEntries(url.searchParams))

describe('income statement page', () => {
  it('shows the latest year with its totals, its net result and the configuration warnings', async () => {
    render(<IncomeStatementPage />)
    await waitFor(() => expect(requested('/api/companies/c1/income-statement')).toContainEqual({ fiscalYearId: 'fy-2026', variant: 'complete' }))
    expect(await screen.findByText('Total produits')).toBeInTheDocument()
    expect(screen.getByText('Total charges')).toBeInTheDocument()
    const result = screen.getByText('Résultat net').closest('[data-slot="card"]') as HTMLElement
    expect(result.textContent?.replace(/\s/g, ' ')).toContain('8 000,25')
    expect(screen.getByText('Configuration du compte de résultat à vérifier')).toBeInTheDocument()
    expect(screen.getByText(/Le compte 658000/)).toBeInTheDocument()
  })

  it('exports the year and variant shown, in Excel and in PDF', async () => {
    const user = userEvent.setup()
    render(<IncomeStatementPage />)
    await screen.findByText('Total produits')
    await user.click(screen.getByRole('combobox', { name: 'Variante' }))
    await user.click(await screen.findByRole('option', { name: 'Simplifiée' }))
    await waitFor(() => expect(requested('/api/companies/c1/income-statement')).toContainEqual({ fiscalYearId: 'fy-2026', variant: 'simplified' }))

    await user.click(screen.getByRole('button', { name: /Exporter Excel/ }))
    await user.click(screen.getByRole('button', { name: /Exporter PDF/ }))
    await waitFor(() => expect(requested('/api/companies/c1/income-statement/export-pdf')).toHaveLength(1))
    expect(requested('/api/companies/c1/income-statement/export-excel')).toEqual([{ fiscalYearId: 'fy-2026', variant: 'simplified' }])
    expect(requested('/api/companies/c1/income-statement/export-pdf')).toEqual([{ fiscalYearId: 'fy-2026', variant: 'simplified' }])
  })
})
