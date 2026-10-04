/**
 * Bilan page: the fiscal year and variant it asks for, the N-1 year of the
 * Excel export (the year before the one shown, PCG art. 821-1 and Code de
 * commerce art. R123-182: each item shows the figure of the previous fiscal
 * year), the totals, the previous result awaiting allocation (compte 12,
 * 2033-A line 136 / 2051 DI) and the imbalance diagnostic. fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/reports/balance-sheet',
}))
vi.mock('@/components/features/onboarding/reports-empty-hint', () => ({ ReportsEmptyHint: () => null }))
vi.mock('@/components/features/reports/layout-notice', () => ({ LayoutNotice: () => null }))

import BalanceSheetPage from '../page'

const line = (id: string, lineLabel: string, net: number, extra: Record<string, unknown> = {}) => ({
  id,
  lineLabel,
  net,
  value: net,
  accounts: [{ code: id }],
  ...extra,
})

const BALANCE_SHEET = {
  fiscalYearId: 'fy-2026',
  actif: { lines: [line('512', 'Disponibilités', 4500)] },
  passif: {
    lines: [
      line('101', 'Capital social', 3000),
      // 1 000,00 for the year, plus 500,00 of 2025 not allocated yet (still on 12)
      line('120', "Résultat de l'exercice", 1500, { formCode: 'DI' }),
    ],
  },
  actifTotal: 4500,
  passifTotal: 4500,
  netResult: 1000,
  warnings: [],
}

let sheet: Record<string, unknown>
let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  sheet = BALANCE_SHEET
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/companies/c1/fiscal-years') {
      return respond(200, [
        { id: 'fy-2024', year: 2024, startDate: '2024-01-01', endDate: '2024-12-31' },
        { id: 'fy-2026', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' },
        { id: 'fy-2025', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31' },
      ])
    }
    if (url.pathname === '/api/companies/c1/balance-sheet') return respond(200, sheet)
    if (url.pathname === '/api/companies/c1/balance-sheet/export-excel') return new Response(new Blob(['xlsx']), { status: 200 })
    return respond(404, { error: 'unexpected' })
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:bilan')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const queries = (pathname: string) =>
  fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((url) => url.pathname === pathname)
    .map((url) => {
      const params = Object.fromEntries(url.searchParams)
      delete params._t
      return params
    })

async function exportExcel(user: ReturnType<typeof userEvent.setup>) {
  const before = queries('/api/companies/c1/balance-sheet/export-excel').length
  await user.click(screen.getByRole('button', { name: /Exporter Excel/ }))
  await waitFor(() => expect(queries('/api/companies/c1/balance-sheet/export-excel').length).toBe(before + 1))
  return queries('/api/companies/c1/balance-sheet/export-excel').at(-1)
}

async function selectYear(user: ReturnType<typeof userEvent.setup>, year: string) {
  await user.click(screen.getByRole('combobox', { name: 'Exercice' }))
  await user.click(await screen.findByRole('option', { name: year }))
}

describe('balance sheet page', () => {
  it('shows the latest fiscal year, complete variant, with its totals', async () => {
    render(<BalanceSheetPage />)
    await waitFor(() => expect(queries('/api/companies/c1/balance-sheet')).toContainEqual({ fiscalYearId: 'fy-2026', variant: 'complete' }))
    expect(await screen.findByText('TOTAL ACTIF (net)')).toBeInTheDocument()
    expect(screen.getByText('TOTAL PASSIF')).toBeInTheDocument()
    expect(screen.getByText('Disponibilités')).toBeInTheDocument()
  })

  it('explains the previous result still awaiting allocation on the result line', async () => {
    render(<BalanceSheetPage />)
    const note = await screen.findByText(/de résultat antérieur en instance d.affectation \(compte 12\)/)
    expect(note.textContent?.replace(/\s/g, ' ')).toMatch(/1 000,00.*pour l.exercice, et 500,00.*de résultat antérieur/)
  })

  it('exports the year shown with the year just before it as N-1', async () => {
    const user = userEvent.setup()
    render(<BalanceSheetPage />)
    await screen.findByText('TOTAL PASSIF')
    expect(await exportExcel(user)).toEqual({ fiscalYearId: 'fy-2026', variant: 'complete', previousFiscalYearId: 'fy-2025' })

    await selectYear(user, '2025')
    await waitFor(() => expect(queries('/api/companies/c1/balance-sheet')).toContainEqual({ fiscalYearId: 'fy-2025', variant: 'complete' }))
    expect(await exportExcel(user)).toEqual({ fiscalYearId: 'fy-2025', variant: 'complete', previousFiscalYearId: 'fy-2024' })

    // The first fiscal year has no N-1
    await selectYear(user, '2024')
    await waitFor(() => expect(queries('/api/companies/c1/balance-sheet')).toContainEqual({ fiscalYearId: 'fy-2024', variant: 'complete' }))
    expect(await exportExcel(user)).toEqual({ fiscalYearId: 'fy-2024', variant: 'complete' })
  })

  it('asks for the simplified variant when chosen', async () => {
    const user = userEvent.setup()
    render(<BalanceSheetPage />)
    await screen.findByText('TOTAL PASSIF')
    await user.click(screen.getByRole('combobox', { name: 'Variante' }))
    await user.click(await screen.findByRole('option', { name: 'Simplifiée' }))
    await waitFor(() => expect(queries('/api/companies/c1/balance-sheet')).toContainEqual({ fiscalYearId: 'fy-2026', variant: 'simplified' }))
  })

  it('names the unbalanced entries and the accounts mapped to no line', async () => {
    sheet = {
      ...BALANCE_SHEET,
      imbalance: 12.5,
      diagnostic: {
        causes: {
          unbalancedEntries: [{ entryId: 'e7', reference: 'OD-7', link: '/c1/entries/e7', date: '2026-04-30', difference: 12.5 }],
          unmappedAccounts: [{ accountId: 'a471', code: '471000', label: 'Compte d’attente', balance: 12.5 }],
          configurationIssues: [],
        },
      },
    }
    render(<BalanceSheetPage />)
    expect(await screen.findByText('Bilan non équilibré')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'OD-7' })).toHaveAttribute('href', '/c1/entries/e7')
    expect(screen.getByText('OD-7').closest('li')?.textContent).toContain('(30/04/2026)')
    expect(screen.getByText('471000')).toBeInTheDocument()
  })
})
