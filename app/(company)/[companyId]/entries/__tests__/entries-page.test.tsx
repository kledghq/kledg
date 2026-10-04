/**
 * Écritures page: the query it sends (default fiscal year, filters, the
 * drafts from ?statut=brouillon), the cursor pages, and the summary of the
 * last import kept for the session. fetch is mocked; the filters, the list
 * and the import dialog are stubs (they have their own tests).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useSearchParams: () => nav.params,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/entries',
}))
vi.mock('@/components/features/accounting/entries-filters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/features/accounting/entries-filters')>()
  return {
    ...actual,
    EntriesFilters: ({ onFiltersChange }: { onFiltersChange: (f: Record<string, unknown>) => void }) => (
      <button type="button" onClick={() => onFiltersChange({ journalId: 'j-bq', minAmountCents: 120050 })}>
        Filtrer BQ
      </button>
    ),
  }
})
vi.mock('@/components/features/accounting/entries-list', () => ({
  EntriesList: ({ entries, hasMore, onLoadMore }: { entries: Array<{ id: string; entryNumber: string }>; hasMore: boolean; onLoadMore: () => void }) => (
    <div>
      <ul aria-label="Écritures">
        {entries.map((e) => (
          <li key={e.id}>{e.entryNumber}</li>
        ))}
      </ul>
      {hasMore ? (
        <button type="button" onClick={onLoadMore}>
          Charger plus
        </button>
      ) : null}
    </div>
  ),
}))
vi.mock('@/components/features/import/import-dialog', () => ({
  ImportDialog: ({ open, onImportSuccess }: { open: boolean; onImportSuccess: (r: Record<string, unknown>) => void }) =>
    open ? (
      <button type="button" onClick={() => onImportSuccess({ success: true, entriesCreated: 12, accountsCreated: 3, journalsCreated: 1, errors: [], warnings: [] })}>
        Terminer l&apos;import
      </button>
    ) : null,
}))
vi.mock('@/components/features/import/last-import-summary', () => ({
  LastImportSummary: ({ result, onDismiss }: { result: { entriesCreated: number }; onDismiss: () => void }) => (
    <div role="status">
      {result.entriesCreated} écritures importées
      <button type="button" onClick={onDismiss}>
        Masquer
      </button>
    </div>
  ),
}))

import EntriesPage from '../page'

let store: Map<string, string>
let fetchMock: ReturnType<typeof vi.fn>
const respond = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } })

beforeEach(() => {
  nav.params = new URLSearchParams()
  store = new Map()
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/companies/c1/fiscal-years') {
      return respond([
        { id: 'fy-2026', year: 2026, isClosed: false },
        { id: 'fy-2025', year: 2025, isClosed: true },
      ])
    }
    if (url.pathname === '/api/journals') return respond([])
    if (url.pathname === '/api/entries') {
      return url.searchParams.get('cursor')
        ? respond([{ id: 'e3', entryNumber: 'VE-3' }])
        : respond([{ id: 'e1', entryNumber: 'VE-1' }, { id: 'e2', entryNumber: 'VE-2' }], { 'X-Next-Cursor': 'cursor-2' })
    }
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const entryQueries = () =>
  fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((url) => url.pathname === '/api/entries')
    .map((url) => Object.fromEntries(url.searchParams))

describe('entries page', () => {
  it('lists the entries of the open fiscal year, 50 at a time, and loads the next page with its cursor', async () => {
    const user = userEvent.setup()
    render(<EntriesPage />)
    expect(await screen.findByText('VE-2')).toBeInTheDocument()
    expect(entryQueries()[0]).toEqual({ companyId: 'c1', fiscalYearId: 'fy-2026', limit: '50' })
    await user.click(screen.getByRole('button', { name: 'Charger plus' }))
    expect(await screen.findByText('VE-3')).toBeInTheDocument()
    expect(entryQueries().at(-1)).toEqual({ companyId: 'c1', fiscalYearId: 'fy-2026', limit: '50', cursor: 'cursor-2' })
    expect(screen.queryByRole('button', { name: 'Charger plus' })).not.toBeInTheDocument()
  })

  it('opens on the drafts from the dashboard link', async () => {
    nav.params = new URLSearchParams('statut=brouillon')
    render(<EntriesPage />)
    await waitFor(() => expect(entryQueries()[0]).toMatchObject({ status: 'draft', fiscalYearId: 'fy-2026' }))
  })

  it('sends the filters, amounts as decimals', async () => {
    const user = userEvent.setup()
    render(<EntriesPage />)
    await screen.findByText('VE-1')
    await user.click(screen.getByRole('button', { name: 'Filtrer BQ' }))
    await waitFor(() => expect(entryQueries().at(-1)).toMatchObject({ journalId: 'j-bq', minAmount: '1200.50', fiscalYearId: 'fy-2026' }))
  })

  it('keeps the summary of the last import for the session, until dismissed', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<EntriesPage />)
    await screen.findByText('VE-1')
    await user.click(screen.getByRole('button', { name: /Importer/ }))
    await user.click(screen.getByRole('button', { name: "Terminer l'import" }))
    expect(await screen.findByRole('status')).toHaveTextContent('12 écritures importées')
    expect(JSON.parse(store.get('kledg:lastImport:c1') ?? '{}')).toMatchObject({ entriesCreated: 12 })
    // The list reloads after the import
    await waitFor(() => expect(entryQueries().filter((q) => !q.cursor).length).toBeGreaterThanOrEqual(2))

    // Still there after a reload of the page
    unmount()
    render(<EntriesPage />)
    expect(await screen.findByRole('status')).toHaveTextContent('12 écritures importées')
    await user.click(screen.getByRole('button', { name: 'Masquer' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(store.has('kledg:lastImport:c1')).toBe(false)
  })
})
