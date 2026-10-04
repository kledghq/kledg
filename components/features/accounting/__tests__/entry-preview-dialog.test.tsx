import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EntryPreviewDialog } from '../entry-preview-dialog'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const norm = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ')

const entry = {
  id: 'e-1',
  entryNumber: 'BQ-7',
  date: '2025-03-01T00:00:00.000Z',
  description: 'Paiement fournisseur',
  reference: 'FAC-2025-031',
  status: 'validated',
  journal: { code: 'BQ', label: 'Banque' },
  lines: [
    // Decimal strings, as Prisma serialises them.
    { id: 'l1', debit: '1200.10', credit: '0', description: 'Facture mars', account: { code: '401000', label: 'Fournisseurs' } },
    { id: 'l2', debit: '0.20', credit: '0', description: null, account: { code: '627000', label: 'Services bancaires' } },
    { id: 'l3', debit: '0', credit: '1200.30', description: null, account: { code: '512000', label: 'Banque' } },
  ],
}

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn(async () => response as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('EntryPreviewDialog', () => {
  const originalTz = process.env.TZ
  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.TZ = originalTz
  })

  it('shows the entry with its lines and totals summed in cents', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, json: async () => entry })
    render(<EntryPreviewDialog open onOpenChange={vi.fn()} entryId="e-1" />)

    expect(await screen.findByRole('heading', { name: 'Écriture BQ-7' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/entries/e-1')
    expect(screen.getByText('BQ - Banque')).toBeInTheDocument()
    expect(screen.getByText('Validée')).toBeInTheDocument()
    expect(screen.getByText('FAC-2025-031')).toBeInTheDocument()

    const rows = screen.getAllByRole('row').slice(1).map((r) => norm(r.textContent))
    expect(rows).toEqual([
      '401000 - FournisseursFacture mars1 200,10 €',
      '627000 - Services bancaires-0,20 €',
      '512000 - Banque-1 200,30 €',
      // 1 200,10 + 0,20 is exactly 1 200,30: the entry balances.
      'Total1 200,30 €1 200,30 €',
    ])
  })

  it('shows the calendar day of the entry in a browser west of UTC', async () => {
    // Accounting dates are calendar days stored at midnight UTC
    // (docs/conventions.md, Dates): 1 March must not become 28 February.
    process.env.TZ = 'America/Los_Angeles'
    stubFetch({ ok: true, status: 200, json: async () => entry })
    render(<EntryPreviewDialog open onOpenChange={vi.fn()} entryId="e-1" />)
    expect(await screen.findByText('01/03/2025')).toBeInTheDocument()
  })

  it('labels a draft entry', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({ ...entry, status: 'draft', reference: null, description: null }) })
    render(<EntryPreviewDialog open onOpenChange={vi.fn()} entryId="e-1" />)
    expect(await screen.findByText('Brouillon')).toBeInTheDocument()
    expect(screen.queryByText('Référence')).not.toBeInTheDocument()
  })

  it('says the entry is missing on a 404', async () => {
    stubFetch({ ok: false, status: 404, statusText: 'Not Found' })
    render(<EntryPreviewDialog open onOpenChange={vi.fn()} entryId="gone" />)
    expect(await screen.findAllByText('Écriture introuvable')).toHaveLength(2)
  })

  it('shows the error of a failed load', async () => {
    stubFetch({ ok: false, status: 500, statusText: 'Internal Server Error' })
    render(<EntryPreviewDialog open onOpenChange={vi.fn()} entryId="e-1" />)
    expect(await screen.findAllByText('Internal Server Error')).toHaveLength(2)
  })

  it('does not load anything while closed', () => {
    const fetchMock = stubFetch({ ok: true, status: 200, json: async () => entry })
    render(<EntryPreviewDialog open={false} onOpenChange={vi.fn()} entryId="e-1" />)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
