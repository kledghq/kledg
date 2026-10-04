/**
 * Transactions page: the query it sends (open fiscal year by default, 100 a
 * page, the filters), the bank sync over the chosen period followed by the
 * receipts sync, its failures, and the empty message with or without
 * filters. fetch is mocked; the filters and the table are stubs (they have
 * their own tests).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/transactions',
  // No filter in the URL (the missing receipts list links here with ?q=...).
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/features/accounting/transaction-filters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/features/accounting/transaction-filters')>()
  return {
    ...actual,
    TransactionFiltersComponent: ({ filters, onFiltersChange }: { filters: Record<string, unknown>; onFiltersChange: (f: Record<string, unknown>) => void }) => (
      <button type="button" onClick={() => onFiltersChange({ ...filters, reconciled: 'unreconciled', side: 'debit' })}>
        Non rapprochées au débit
      </button>
    ),
  }
})
vi.mock('@/components/features/data-table/transactions-data-table', () => ({
  TransactionsDataTable: ({ data, empty, balanceBefore }: { data: Array<{ id: string; label: string }>; empty: string; balanceBefore?: number }) => (
    <div>
      {data.length === 0 ? <p>{empty}</p> : data.map((t) => <p key={t.id}>{t.label}</p>)}
      <p>Solde avant : {balanceBefore ?? 'inconnu'}</p>
    </div>
  ),
}))

import { toast } from 'sonner'
import TransactionsPage from '../page'

let transactions: Array<{ id: string; label: string }>
let syncReply: { status: number; body: unknown }
let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  transactions = [{ id: 't1', label: 'LOYER OCTOBRE' }]
  syncReply = { status: 200, body: { success: true, totalItemsSynced: 14 } }
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'
    if (url.pathname === '/api/companies/c1/fiscal-years') return respond(200, [{ id: 'fy-2026', year: 2026, isClosed: false }])
    if (url.pathname === '/api/banking/accounts') return respond(200, { accounts: [] })
    if (url.pathname === '/api/transactions' && url.searchParams.get('categoriesOnly')) return respond(200, { categories: { cashflowCategories: [], cashflowSubcategories: [], categories: [], operationTypes: [] } })
    if (url.pathname === '/api/transactions') return respond(200, { transactions, balanceBefore: 1520.4 })
    if (method === 'POST' && url.pathname === '/api/integrations/sync') return respond(syncReply.status, syncReply.body)
    if (method === 'POST' && url.pathname === '/api/banking/attachments/sync') return respond(200, { synced: 2 })
    return respond(404, { error: 'unexpected' })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const listQueries = () =>
  fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((url) => url.pathname === '/api/transactions' && !url.searchParams.get('categoriesOnly'))
    .map((url) => Object.fromEntries(url.searchParams))
const posts = (pathname: string) =>
  fetchMock.mock.calls.filter(([input, init]) => init?.method === 'POST' && new URL(String(input), 'http://localhost').pathname === pathname)

describe('transactions page', () => {
  it('lists the transactions of the open fiscal year, 100 a page, with the balance before them', async () => {
    render(<TransactionsPage />)
    expect(await screen.findByText('LOYER OCTOBRE')).toBeInTheDocument()
    expect(listQueries()[0]).toEqual({ fiscalYearId: 'fy-2026', companyId: 'c1', limit: '100' })
    expect(screen.getByText('Solde avant : 1520.4')).toBeInTheDocument()
  })

  it('sends the filters and says when they match nothing', async () => {
    transactions = []
    const user = userEvent.setup()
    render(<TransactionsPage />)
    expect(await screen.findByText(/Aucune transaction sur cet exercice/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Non rapprochées au débit' }))
    await waitFor(() => expect(listQueries().at(-1)).toMatchObject({ reconciled: 'false', side: 'debit', fiscalYearId: 'fy-2026' }))
    expect(await screen.findByText('Aucune transaction ne correspond aux filtres. Élargissez la période ou retirez un filtre.')).toBeInTheDocument()
  })

  it('syncs the bank over the chosen period, then the receipts, and reloads the list', async () => {
    const user = userEvent.setup()
    render(<TransactionsPage />)
    await screen.findByText('LOYER OCTOBRE')
    await user.click(screen.getByRole('combobox', { name: 'Période à synchroniser' }))
    await user.click(await screen.findByRole('option', { name: '6 derniers mois' }))
    await user.click(screen.getByRole('button', { name: /Synchroniser/ }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Synchronisation terminée : 14 éléments importés'))
    expect(JSON.parse(String(posts('/api/integrations/sync')[0][1]?.body))).toEqual({ companyId: 'c1', maxDays: 180 })
    expect(JSON.parse(String(posts('/api/banking/attachments/sync')[0][1]?.body))).toEqual({ companyId: 'c1' })
    await waitFor(() => expect(listQueries().length).toBeGreaterThanOrEqual(2))
  })

  it('names the failures of a sync and skips the receipts', async () => {
    syncReply = { status: 200, body: { success: false, errors: ['Qonto : identifiants refusés'] } }
    const user = userEvent.setup()
    render(<TransactionsPage />)
    await screen.findByText('LOYER OCTOBRE')
    await user.click(screen.getByRole('button', { name: /Synchroniser/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('La synchronisation a échoué : Qonto : identifiants refusés'))
    expect(posts('/api/banking/attachments/sync')).toHaveLength(0)
  })
})
