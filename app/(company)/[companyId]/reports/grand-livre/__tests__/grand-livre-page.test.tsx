/**
 * Grand livre page (Code de commerce art. R123-173: the general ledger holds
 * the entries of the journal by account): the period it asks for, the
 * selected fiscal year or a custom date range, and the period it states.
 * fetch is mocked; the table is a stub (it has its own tests).
 */

import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/reports/grand-livre',
}))
vi.mock('@/components/features/accounting/fiscal-year-selector', () => ({
  FiscalYearSelector: ({ onValueChange }: { onValueChange: (id: string) => void }) => {
    useEffect(() => onValueChange('fy-2026'), [onValueChange])
    return null
  },
}))
vi.mock('@/components/features/reports/grand-livre-table', () => ({
  GrandLivreTable: ({ data }: { data: { accounts: Array<{ code: string }> } }) => <p>{data.accounts.length} comptes</p>,
}))

import GrandLivrePage from '../page'

let fetchMock: ReturnType<typeof vi.fn>
const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-04T10:00:00Z'))
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/companies/c1/fiscal-years') return respond([{ id: 'fy-2026', year: 2026 }])
    if (url.pathname === '/api/reports/grand-livre') {
      return respond({
        fiscalYear: { id: 'fy-2026', year: 2026 },
        period: { startDate: url.searchParams.get('startDate') ?? '2026-01-01', endDate: url.searchParams.get('endDate') ?? '2026-12-31' },
        accounts: [{ code: '512000' }, { code: '706000' }],
      })
    }
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const queries = () =>
  fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((url) => url.pathname === '/api/reports/grand-livre')
    .map((url) => Object.fromEntries(url.searchParams))

describe('grand livre page', () => {
  it('asks for the selected fiscal year and states its period', async () => {
    render(<GrandLivrePage />)
    expect(await screen.findByText('2 comptes')).toBeInTheDocument()
    expect(queries()).toContainEqual({ companyId: 'c1', fiscalYearId: 'fy-2026' })
    expect(screen.getByText(/Exercice 2026, du 01\/01\/2026 au 31\/12\/2026/)).toBeInTheDocument()
  })

  it('asks for a custom range, the calendar year by default', async () => {
    const user = userEvent.setup()
    render(<GrandLivrePage />)
    await screen.findByText('2 comptes')
    await user.click(screen.getByLabelText('Période personnalisée'))
    expect(screen.getByLabelText('Date de début')).toHaveValue('2026-01-01')
    await waitFor(() => expect(queries()).toContainEqual({ companyId: 'c1', startDate: '2026-01-01', endDate: '2026-12-31' }))
    const end = screen.getByLabelText('Date de fin')
    await user.clear(end)
    await user.type(end, '2026-06-30')
    await waitFor(() => expect(queries()).toContainEqual({ companyId: 'c1', startDate: '2026-01-01', endDate: '2026-06-30' }))
    expect(await screen.findByText(/du 01\/01\/2026 au 30\/06\/2026/)).toBeInTheDocument()
  })
})
