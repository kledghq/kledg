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

const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/companies/c1/fiscal-years') return respond([{ id: 'fy-2026', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }])
    if (url.pathname === '/api/banking/accounts') return respond({ accounts: [] })
    if (url.pathname === '/api/banking/missing-receipts') return respond({ items: [], count: 0, totalCents: 0 })
    return respond({})
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  urlParams = new URLSearchParams()
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
})
