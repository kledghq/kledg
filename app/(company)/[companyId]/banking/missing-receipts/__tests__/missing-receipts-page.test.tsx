import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let urlParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useSearchParams: () => urlParams,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/c1/banking/missing-receipts',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import MissingReceiptsPage from '../page'

const row = (id: string, label: string, supplier: unknown) => ({
  id,
  date: '2026-09-12',
  label,
  counterpartyName: null,
  reference: null,
  amountCents: -2_399,
  reconciled: false,
  entryId: null,
  bankAccount: { id: 'b1', name: 'Qonto', displayName: null },
  bankProvider: 'QONTO',
  supplier,
})
let missing: unknown = { transactions: [], count: 0, totalCents: 0, truncated: false, period: null, thresholdCents: 0 }

const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/companies/c1/fiscal-years') return respond([{ id: 'fy-2026', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }])
    if (url.pathname === '/api/banking/accounts') return respond({ accounts: [] })
    if (url.pathname === '/api/banking/missing-receipts') return respond(missing)
    return respond({})
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  urlParams = new URLSearchParams()
  missing = { transactions: [], count: 0, totalCents: 0, truncated: false, period: null, thresholdCents: 0 }
  vi.unstubAllGlobals()
})

const sides = () =>
  fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((url) => url.pathname === '/api/banking/missing-receipts')
    .map((url) => url.searchParams.get('side'))

describe('MissingReceiptsPage', () => {
  it('lists the payments without receipt by default', async () => {
    render(<MissingReceiptsPage />)
    await waitFor(() => expect(sides()).toEqual(['debit']))
    expect(screen.getByRole('radio', { name: 'Dépenses' })).toHaveAttribute('data-state', 'on')
  })

  it('opens on both directions from the simple mode home, whose count covers both', async () => {
    urlParams = new URLSearchParams({ side: 'all' })
    render(<MissingReceiptsPage />)
    await waitFor(() => expect(sides()).toEqual(['all']))
    expect(screen.getByRole('radio', { name: 'Toutes' })).toHaveAttribute('data-state', 'on')
  })

  it('shows the supplier recognised from the label and where to find its invoice, in a new tab', async () => {
    missing = {
      transactions: [
        row('t1', 'PRLV SEPA OVH SAS', { name: 'OVHcloud', kind: 'vendor', vendorId: 'ovhcloud', tiersId: null, invoicesUrl: 'https://www.ovh.com/manager/#/billing/history' }),
        row('t2', 'VIR SEPA STUDIO NORD', { name: 'Studio Nord', kind: 'CUSTOMER', vendorId: null, tiersId: 'tn', invoicesUrl: null }),
        row('t3', 'CB BOULANGERIE DU MARCHE', null),
      ],
      count: 3,
      totalCents: 7_197,
      truncated: false,
      period: null,
      thresholdCents: 0,
    }
    render(<MissingReceiptsPage />)
    // Desktop table and mobile list: each row shows its supplier twice.
    await waitFor(() => expect(screen.getAllByText('OVHcloud')).toHaveLength(2))
    const links = screen.getAllByRole('link', { name: 'Où trouver la facture OVHcloud (nouvel onglet)' })
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link).toHaveAttribute('href', 'https://www.ovh.com/manager/#/billing/history')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(link).toHaveTextContent('Où trouver la facture')
    }
    expect(screen.getAllByText('Studio Nord')).toHaveLength(2)
    expect(screen.getAllByText(/Client/).length).toBeGreaterThan(0)
    expect(screen.queryAllByRole('link', { name: /Studio Nord/ })).toHaveLength(0)
  })

  it('adds nothing to a row whose supplier is unknown', async () => {
    missing = { transactions: [row('t3', 'CB BOULANGERIE DU MARCHE', null)], count: 1, totalCents: 2_399, truncated: false, period: null, thresholdCents: 0 }
    render(<MissingReceiptsPage />)
    await waitFor(() => expect(screen.getAllByText('CB BOULANGERIE DU MARCHE').length).toBeGreaterThan(0))
    expect(screen.queryByText(/Fournisseur/)).toBeNull()
    expect(screen.queryByText('Où trouver la facture')).toBeNull()
  })
})
