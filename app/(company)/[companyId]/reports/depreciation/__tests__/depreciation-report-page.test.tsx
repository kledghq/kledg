/**
 * Tableau d'amortissement page: the table of a fiscal year, the unposted
 * annuities and their generation (dotations aux amortissements, 68 / 28,
 * PCG art. 214-13, 942-28 and 946-68), and the CSV export. fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/reports/depreciation',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from 'sonner'
import DepreciationReportPage from '../page'

const FISCAL_YEAR = { id: 'fy-2026', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }
const COMPUTER = {
  id: 'fa1',
  label: 'Ordinateur portable',
  acquisitionDate: '2025-07-01',
  // 1 200,00 over 3 years, linear: 400,00 a year, 200,00 for the half year 2025 (prorata temporis)
  acquisitionValue: 1200,
  amortizableAmount: 1200,
  previousDepreciation: 200,
  currentDepreciation: 400,
  totalDepreciation: 600,
  netBookValue: 600,
  assetAccount: { code: '218300', label: 'Matériel de bureau et informatique' },
  depreciationAccount: { code: '281830', label: 'Amortissements du matériel informatique' },
  expenseAccount: { code: '681120', label: 'Dotations aux amortissements' },
  depreciationMethod: 'linear',
  depreciationRate: 33.33,
  depreciationDuration: 3,
  currentPosted: false,
}

let unposted: { count: number; amount: number }
let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  unposted = { count: 1, amount: 400 }
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url === '/api/companies/c1/fiscal-years') return respond(200, [FISCAL_YEAR])
    if (url.startsWith('/api/reports/depreciation?')) {
      return respond(200, { depreciationTable: [COMPUTER], fiscalYear: FISCAL_YEAR, unposted })
    }
    if (method === 'POST' && url === '/api/companies/c1/fiscal-years/fy-2026/depreciation') {
      unposted = { count: 0, amount: 0 }
      return respond(200, { count: 1, amount: 400 })
    }
    return respond(404, { error: `unexpected ${method} ${url}` })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('depreciation report page', () => {
  it('shows the annuity of the year, the cumulated depreciation and the net book value', async () => {
    render(<DepreciationReportPage />)
    const row = (await screen.findByText('Ordinateur portable')).closest('tr') as HTMLElement
    const cells = within(row).getAllByRole('cell').map((cell) => cell.textContent)
    expect(cells.slice(0, 8)).toEqual([
      'Ordinateur portable',
      '01/07/2025',
      '1 200,00 €',
      '1 200,00 €',
      '200,00 €',
      '400,00 €non comptabilisée',
      '600,00 €',
      '600,00 €',
    ])
  })

  it('generates the unposted annuities of the open year and reloads the table', async () => {
    const user = userEvent.setup()
    render(<DepreciationReportPage />)
    expect(await screen.findByText(/1 dotation de l'exercice 2026 n'est pas comptabilisée/)).toHaveTextContent('400,00')
    await user.click(screen.getByRole('button', { name: /Générer les dotations/ }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('1 écriture de dotation passée pour 400,00 €'))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Générer les dotations/ })).not.toBeInTheDocument())
  })

  it('exports a semicolon CSV with French decimals that a spreadsheet reads as numbers', async () => {
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob)
      return 'blob:depreciation'
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<DepreciationReportPage />)
    await screen.findByText('Ordinateur portable')
    await user.click(screen.getByRole('button', { name: /Exporter en CSV/ }))

    expect(click).toHaveBeenCalledTimes(1)
    const link = click.mock.contexts[0] as HTMLAnchorElement
    expect(link.getAttribute('download')).toBe('tableau-amortissement-2026.csv')
    const bytes = new Uint8Array(await blobs[0].arrayBuffer())
    // UTF-8 BOM so Excel reads the accents
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const [header, line] = new TextDecoder().decode(bytes).split('\n')
    expect(header.split(';').slice(0, 3)).toEqual(['Libellé', 'Date acquisition', 'Valeur acquisition'])
    expect(line.split(';')).toEqual([
      'Ordinateur portable',
      '01/07/2025',
      '1200,00',
      '1200,00',
      '200,00',
      '400,00',
      '600,00',
      '600,00',
      '218300 - Matériel de bureau et informatique',
      '281830 - Amortissements du matériel informatique',
      'Linéaire',
      '33,33',
      '3',
    ])
  })
})
