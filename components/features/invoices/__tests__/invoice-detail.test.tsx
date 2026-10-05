/**
 * The page of an invoice (components/features/invoices/invoice-detail.tsx):
 * an invoice Kledg created in Qonto reads "Créée dans Qonto" (and
 * "Brouillon dans Qonto" while it is a draft there), never "Importée de
 * Qonto"; an imported one keeps "Importée de Qonto"; both show their Qonto
 * id (Qonto documents no web link to one client invoice). "Proposer avec
 * l'IA" appears only when the user connected an assistant to the company.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useParams: () => ({}), usePathname: () => '/' }))

import { InvoiceDetailView } from '../invoice-detail'
import { AiAssistProvider } from '@/components/features/ai-assist/ai-assist-context'

const BASE = {
  id: 'inv_1',
  direction: 'SALE',
  number: null,
  origin: 'QONTO',
  createdInQonto: true,
  qontoPending: false,
  qontoDraft: true,
  qontoId: 'f3d5c1a2-qonto',
  provisionalNumber: null,
  typeCode: '380',
  issueDate: '2026-10-01',
  dueDate: '2026-10-31',
  label: null,
  status: 'draft',
  source: 'QONTO',
  externalStatus: 'draft',
  hasAttachment: false,
  letteringCode: null,
  totalExclTaxCents: 100_000,
  totalVatCents: 20_000,
  totalInclTaxCents: 120_000,
  paidCents: 0,
  remainingCents: 120_000,
  tiers: { id: 't1', name: 'Studio Nord', auxiliaryAccountNumber: 'C00001' },
  parties: { sellerSiren: null, sellerVatNumber: null, buyerSiren: null, buyerVatNumber: null },
  entry: null,
  lines: [],
  vatBreakdown: [],
  payments: [],
}

function mockInvoice(patch: object) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ...BASE, ...patch }), { status: 200 })),
  )
}

describe('InvoiceDetailView, Qonto', () => {
  beforeEach(() => mockInvoice({}))
  afterEach(() => vi.unstubAllGlobals())

  it('shows an invoice created in Qonto as created, a draft there, with its Qonto id', async () => {
    render(<InvoiceDetailView companyId="atelier" invoiceId="inv_1" />)
    expect(await screen.findByText('Créée dans Qonto')).toBeInTheDocument()
    expect(screen.getByText('Brouillon dans Qonto')).toBeInTheDocument()
    expect(screen.queryByText('Importée de Qonto')).toBeNull()
    expect(screen.getByTestId('qonto-id').textContent?.replace(/ /g, ' ')).toBe('Identifiant Qonto : f3d5c1a2-qonto')
    expect(screen.queryByRole('link', { name: /Voir dans Qonto/ })).toBeNull()
  })

  it('keeps "Importée de Qonto" for an imported invoice, without the draft badge', async () => {
    mockInvoice({ createdInQonto: false, qontoDraft: false, number: 'F-12', status: 'issued' })
    render(<InvoiceDetailView companyId="atelier" invoiceId="inv_1" />)
    expect(await screen.findByText('Importée de Qonto')).toBeInTheDocument()
    expect(screen.queryByText('Créée dans Qonto')).toBeNull()
    expect(screen.queryByText('Brouillon dans Qonto')).toBeNull()
  })

  it('offers "Proposer avec l\'IA" only with a connected assistant', async () => {
    const { unmount } = render(<InvoiceDetailView companyId="atelier" invoiceId="inv_1" />)
    await screen.findByText('Créée dans Qonto')
    expect(screen.queryByRole('button', { name: "Proposer avec l'IA" })).toBeNull()
    unmount()
    render(
      <AiAssistProvider value={{ companyId: 'cmp_1', companyName: 'Atelier', userId: 'u1', apps: ['claude'] }}>
        <InvoiceDetailView companyId="atelier" invoiceId="inv_1" />
      </AiAssistProvider>,
    )
    expect(await screen.findByRole('button', { name: "Proposer avec l'IA" })).toBeInTheDocument()
  })
})
