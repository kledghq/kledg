/**
 * Entry detail page: the lines and their totals computed in cents, and what
 * the page lets the user do according to the status. PCG art. 1031-3 (and
 * the FEC rules of LPF art. A47 A-1): a draft gets its definitive number at
 * validation; a validated entry is never edited, only reversed
 * (contre-passation). fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Next returns the same URLSearchParams between renders: so does the mock
const nav = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams() }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1', id: 'e1' }),
  useRouter: () => ({ push: nav.push, refresh: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => '/c1/entries/e1',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/features/accounting/reverse-entry-dialog', () => ({
  ReverseEntryDialog: ({ open, entry }: { open: boolean; entry: { entryNumber: string } }) =>
    open ? <div role="dialog" aria-label={`Contre-passer l'écriture ${entry.entryNumber}`} /> : null,
}))

import { toast } from 'sonner'
import EntryDetailPage from '../page'

const DRAFT = {
  id: 'e1',
  entryNumber: 'BR-7',
  date: '2026-03-10',
  description: 'Facture 2026-031',
  reference: 'F2026-031',
  status: 'draft',
  validatedAt: null,
  journal: { code: 'VE', label: 'Ventes' },
  // 1 000,10 + 200,02 = 1 200,12: summed in cents, never as floats
  lines: [
    { id: 'l1', debit: '1200.12', credit: '0', description: 'Client Dupont', account: { code: '411000', label: 'Clients' }, auxiliaryAccountNumber: 'C0042', auxiliaryAccountLabel: 'Dupont SARL' },
    { id: 'l2', debit: '0', credit: '1000.10', description: 'Prestation', account: { code: '706000', label: 'Prestations de services' } },
    { id: 'l3', debit: '0', credit: '200.02', description: 'TVA collectée', account: { code: '445710', label: 'TVA collectée' } },
  ],
  reversalOf: null,
  reversedBy: null,
}

let entry: Record<string, unknown>
let replies: Record<string, { status?: number; body: unknown }>
let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  nav.params = new URLSearchParams()
  entry = { ...DRAFT }
  replies = {}
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`
    if (replies[key]) return respond(replies[key].status ?? 200, replies[key].body)
    if (key === 'GET /api/entries/e1') return respond(200, entry)
    return respond(404, { error: 'Écriture introuvable' })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('entry detail page', () => {
  it('shows a draft with its lines, auxiliary account and totals in cents', async () => {
    render(<EntryDetailPage />)
    expect(await screen.findByRole('heading', { name: "Brouillon d'écriture" })).toBeInTheDocument()
    // A draft has no definitive number yet
    expect(screen.getByText('Attribué à la validation')).toBeInTheDocument()
    expect(screen.getByText(/Compte auxiliaire/)).toHaveTextContent('Compte auxiliaire C0042, Dupont SARL')
    const total = within(screen.getByRole('table')).getByText('Total').closest('tr') as HTMLElement
    expect(within(total).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Total', '1 200,12 €', '1 200,12 €'])
    expect(screen.getByRole('link', { name: /Modifier/ })).toHaveAttribute('href', '/c1/entries/e1/edit')
    expect(screen.queryByRole('button', { name: /Contre-passer/ })).not.toBeInTheDocument()
  })

  it('validates a draft and shows the number it received', async () => {
    replies['PATCH /api/entries/e1'] = { body: { ...DRAFT, status: 'validated', entryNumber: 'VE2026-00012', validatedAt: '2026-03-11T09:00:00Z' } }
    const user = userEvent.setup()
    render(<EntryDetailPage />)
    await user.click(await screen.findByRole('button', { name: /Valider/ }))

    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ status: 'validated' })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Écriture validée sous le n° VE2026-00012'))
    expect(await screen.findByRole('heading', { name: 'Écriture n° VE2026-00012' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Modifier/ })).not.toBeInTheDocument()
  })

  it('shows why a validation is refused', async () => {
    replies['PATCH /api/entries/e1'] = { status: 400, body: { error: "L'écriture n'est pas équilibrée : débit 1 200,12 €, crédit 1 000,10 €" } }
    const user = userEvent.setup()
    render(<EntryDetailPage />)
    await user.click(await screen.findByRole('button', { name: /Valider/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("L'écriture n'est pas équilibrée : débit 1 200,12 €, crédit 1 000,10 €"))
    expect(screen.getByRole('heading', { name: "Brouillon d'écriture" })).toBeInTheDocument()
  })

  it('offers only the reversal for a validated entry, and opens it from the link of the list', async () => {
    entry = { ...DRAFT, status: 'validated', entryNumber: 'VE2026-00012', validatedAt: '2026-03-11T09:00:00Z' }
    nav.params = new URLSearchParams('contrepasser=1')
    render(<EntryDetailPage />)
    expect(await screen.findByRole('dialog', { name: "Contre-passer l'écriture VE2026-00012" })).toBeInTheDocument()
    expect(screen.getByText(/elle est\s+définitive et ne peut plus être modifiée ni supprimée/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Modifier/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Valider/ })).not.toBeInTheDocument()
  })

  it('links a reversed entry to its reversal and no longer offers to reverse it', async () => {
    entry = { ...DRAFT, status: 'validated', entryNumber: 'VE2026-00012', reversedBy: { id: 'e9', entryNumber: 'OD2026-00003' } }
    nav.params = new URLSearchParams('contrepasser=1')
    render(<EntryDetailPage />)
    expect(await screen.findByRole('link', { name: "l'écriture n° OD2026-00003" })).toHaveAttribute('href', '/c1/entries/e9')
    expect(screen.queryByRole('button', { name: /Contre-passer/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('duplicates the entry and opens the copy in the editor', async () => {
    replies['POST /api/entries/e1/duplicate'] = { status: 201, body: { id: 'e2' } }
    const user = userEvent.setup()
    render(<EntryDetailPage />)
    await user.click(await screen.findByRole('button', { name: /Dupliquer/ }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/c1/entries/e2/edit'))
  })

  it('says the entry was not found (deleted or of another company)', async () => {
    replies['GET /api/entries/e1'] = { status: 404, body: { error: 'Écriture introuvable' } }
    render(<EntryDetailPage />)
    expect(await screen.findByText('Écriture introuvable')).toBeInTheDocument()
  })
})
