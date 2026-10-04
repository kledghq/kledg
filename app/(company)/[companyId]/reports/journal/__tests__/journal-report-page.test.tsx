/**
 * Journal comptable page (livre-journal, Code de commerce art. R123-173:
 * entries in chronological order, per journal): the period and journal it
 * asks for. Run in Paris time: the default custom period must be the whole
 * calendar year (01/01 to 31/12), whatever the time zone. fetch is mocked.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/reports/journal',
}))

import JournalPage from '../page'

const TZ = process.env.TZ
let fetchMock: ReturnType<typeof vi.fn>
const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

beforeAll(() => {
  process.env.TZ = 'Europe/Paris'
})
afterAll(() => {
  process.env.TZ = TZ
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-04T10:00:00Z'))
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/companies/c1') {
      return respond({
        fiscalYears: [
          { id: 'fy-2025', year: 2025, startDate: '2025-01-01T00:00:00.000Z', endDate: '2025-12-31T00:00:00.000Z' },
          { id: 'fy-2026', year: 2026, startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-12-31T00:00:00.000Z' },
        ],
      })
    }
    if (url.pathname === '/api/journals') return respond([{ id: 'j-bq', code: 'BQ', label: 'Banque' }])
    if (url.pathname === '/api/reports/journal') return respond({ journals: [], grandTotals: { debit: 0, credit: 0 } })
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const journalQueries = () =>
  fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((url) => url.pathname === '/api/reports/journal')
    .map((url) => Object.fromEntries(url.searchParams))

describe('journal report page', () => {
  it('asks for every journal over the latest fiscal year by default', async () => {
    render(<JournalPage />)
    await waitFor(() =>
      expect(journalQueries()).toContainEqual({
        companyId: 'c1',
        journalId: 'all',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-12-31T00:00:00.000Z',
      }),
    )
  })

  it('proposes the whole calendar year as custom period, 01/01 to 31/12, in Paris time', async () => {
    const user = userEvent.setup()
    render(<JournalPage />)
    await waitFor(() => expect(journalQueries().length).toBeGreaterThan(0))
    await user.click(screen.getByLabelText('Période personnalisée'))

    expect(screen.getByLabelText('Date de début')).toHaveValue('2026-01-01')
    expect(screen.getByLabelText('Date de fin')).toHaveValue('2026-12-31')
    await waitFor(() =>
      expect(journalQueries()).toContainEqual({ companyId: 'c1', journalId: 'all', startDate: '2026-01-01', endDate: '2026-12-31' }),
    )
  })

  it('asks for one journal when chosen', async () => {
    const user = userEvent.setup()
    render(<JournalPage />)
    await waitFor(() => expect(journalQueries().length).toBeGreaterThan(0))
    await user.click(screen.getByRole('combobox', { name: 'Journal' }))
    await user.click(await screen.findByRole('option', { name: 'BQ - Banque' }))
    await waitFor(() => expect(journalQueries().at(-1)).toMatchObject({ journalId: 'j-bq', startDate: '2026-01-01T00:00:00.000Z' }))
  })
})
