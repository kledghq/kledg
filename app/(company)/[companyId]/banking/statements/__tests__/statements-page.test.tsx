/**
 * Relevés page: without an active Qonto connection it offers the statement
 * import only (read only roles cannot import); with one, it lists the Qonto
 * statements of the period (January to the current month by default),
 * filtered by account through its Qonto id, ignores a month still being
 * typed, and pages through the results. fetch is mocked; the import dialog
 * is a stub (it has its own tests).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const access = vi.hoisted(() => ({ canImport: true }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/banking/statements',
}))
vi.mock('@/components/features/companies/company-access', () => ({
  useCompanyAccess: () => ({
    can: () => access.canImport,
    denied: (what: string) => `Votre rôle (Lecture seule) ne permet pas : ${what}`,
  }),
}))
vi.mock('@/components/features/banking/statement-import-dialog', () => ({
  StatementImportDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Importer un relevé" /> : null),
}))
vi.mock('@/components/features/banking/connect-bank-button', () => ({ ConnectBankButton: () => null }))

import StatementsPage from '../page'

const QONTO_ACCOUNTS = [
  { slug: 'atelier-1234', iban: 'FR7616958000011234567890123', name: 'Compte principal' },
  { slug: 'atelier-5678', iban: 'FR7616958000019876543210987', name: 'Compte épargne' },
]

let connected: boolean
let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-04T10:00:00Z'))
  access.canImport = true
  connected = true
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/banking/accounts') return respond(200, { accounts: [] })
    if (url.pathname === '/api/banking/connections') {
      return respond(200, { connections: connected ? [{ id: 'bc1', provider: 'QONTO', integration: { status: 'active' } }] : [] })
    }
    if (url.pathname === '/api/qonto/accounts') return respond(200, { accounts: QONTO_ACCOUNTS })
    if (url.pathname === '/api/qonto/statements') {
      const page = Number(url.searchParams.get('page'))
      return respond(200, {
        statements: [{ id: `st-${page}`, period: page === 1 ? '09-2026' : '01-2026', bank_account_id: 'atelier-1234', file: { file_name: 'releve.pdf', file_size: '20480', file_url: 'https://qonto.example/releve.pdf' } }],
        meta: { current_page: page, next_page: page < 2 ? page + 1 : null, prev_page: page > 1 ? page - 1 : null, total_pages: 2, total_count: 21, per_page: 20 },
      })
    }
    return respond(404, { error: 'unexpected' })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const statementQueries = () =>
  fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((url) => url.pathname === '/api/qonto/statements')
    .map((url) => Object.fromEntries(url.searchParams))

describe('statements page', () => {
  it('offers the statement import only without a Qonto connection, and never calls Qonto', async () => {
    connected = false
    const user = userEvent.setup()
    render(<StatementsPage />)
    expect(await screen.findByText('Aucun relevé de banque connectée')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Importer un relevé/ }))
    expect(screen.getByRole('dialog', { name: 'Importer un relevé' })).toBeInTheDocument()
    expect(statementQueries()).toEqual([])
    expect(fetchMock.mock.calls.map(([input]) => String(input)).some((u) => u.startsWith('/api/qonto/'))).toBe(false)
  })

  it('does not let a read only role import a statement', async () => {
    connected = false
    access.canImport = false
    render(<StatementsPage />)
    const button = await screen.findByRole('button', { name: /Importer un relevé/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Votre rôle (Lecture seule) ne permet pas : importer un relevé')
  })

  it('lists the Qonto statements from January to the current month by default', async () => {
    render(<StatementsPage />)
    expect(await screen.findByText('21 relevés sur la période')).toBeInTheDocument()
    expect(statementQueries()[0]).toEqual({
      companyId: 'c1',
      page: '1',
      perPage: '20',
      sortBy: 'period:desc',
      period_from: '01-2026',
      period_to: '10-2026',
    })
  })

  it('filters by account with its Qonto id, and ignores a month still being typed', async () => {
    const user = userEvent.setup()
    render(<StatementsPage />)
    await screen.findByText('21 relevés sur la période')
    await user.click(screen.getByRole('combobox', { name: 'Compte bancaire' }))
    await user.click(await screen.findByRole('option', { name: /Compte épargne|9876|0987/ }))
    await waitFor(() => expect(statementQueries().at(-1)).toMatchObject({ 'bank_account_ids[]': 'atelier-5678', page: '1' }))

    const from = screen.getByLabelText('Du mois (mm-aaaa)')
    await user.clear(from)
    await user.type(from, '03-20')
    // Incomplete month: the query goes without period_from
    await waitFor(() => expect(statementQueries().at(-1)).not.toHaveProperty('period_from'))
    await user.type(from, '26')
    await waitFor(() => expect(statementQueries().at(-1)).toMatchObject({ period_from: '03-2026', period_to: '10-2026' }))
  })

  it('pages through the statements', async () => {
    const user = userEvent.setup()
    render(<StatementsPage />)
    await screen.findByText('21 relevés sur la période')
    expect(screen.getByRole('button', { name: /Précédent/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Suivant/ }))
    await waitFor(() => expect(statementQueries().at(-1)).toMatchObject({ page: '2' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Suivant/ })).toBeDisabled())
  })
})
