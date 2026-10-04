/**
 * Invoice form totals: the VAT breakdown per rate and the totals follow the
 * lines as they are typed, computed with the server's rounding rule
 * (lib/invoices/amounts.ts: VAT per rate on the sum of the lines, CGI ann. II
 * art. 242 nonies A); the form sends cents and basis points and never a
 * total of its own.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const router = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { InvoiceForm } from '../invoice-form'
import { InvoiceTotals } from '../invoice-totals'

/** Text of an element with every kind of space made plain, for amounts formatted with narrow no-break spaces. */
const plain = (element: HTMLElement) => (element.textContent ?? '').replace(/[\s  ]+/g, ' ').trim()

describe('InvoiceTotals', () => {
  it('shows one row per rate, highest first, and the totals', () => {
    render(
      <InvoiceTotals
        lines={[
          { quantityThousandths: 1000, unitPriceCents: 10, vatRateBp: 550 },
          { quantityThousandths: 1000, unitPriceCents: 10, vatRateBp: 550 },
          { quantityThousandths: 1000, unitPriceCents: 10, vatRateBp: 550 },
          { quantityThousandths: 2000, unitPriceCents: 4999, vatRateBp: 2000 },
        ]}
      />,
    )
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.map((row) => row.getAttribute('data-rate'))).toEqual(['2000', '550'])
    // 5,5 %: 0,30 € x 5,5 % = 0,0165 -> 0,02 € (per rate, not 3 x 0,01 €)
    expect(plain(within(rows[1]).getAllByRole('cell')[2])).toBe('0,02 €')
    expect(plain(screen.getByTestId('total-excl'))).toBe('100,28 €')
    expect(plain(screen.getByTestId('total-vat'))).toBe('20,02 €')
    expect(plain(screen.getByTestId('total-incl'))).toBe('120,30 €')
  })

  it('invites to add a line when there is none', () => {
    render(<InvoiceTotals lines={[]} />)
    expect(screen.getByText('Ajoutez une ligne pour voir la TVA.')).toBeInTheDocument()
    expect(plain(screen.getByTestId('total-incl'))).toBe('0,00 €')
  })
})

describe('InvoiceForm', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/tiers')) {
        return new Response(JSON.stringify({ tiers: [{ id: 't1', name: 'Martin SA', auxiliaryAccountNumber: 'C00001', defaultAccountCode: null, defaultVatRateBp: null }] }))
      }
      if (url === '/api/invoices' && init?.method === 'POST') return new Response(JSON.stringify({ id: 'inv-1' }), { status: 201 })
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('updates the totals as lines are typed', async () => {
    const user = userEvent.setup()
    render(<InvoiceForm companyId="c1" direction="SALE" />)
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/tiers?'))).toBe(true))

    await user.type(screen.getByLabelText(/Désignation/), 'Conseil')
    const quantity = screen.getByLabelText(/Quantité/)
    await user.clear(quantity)
    await user.type(quantity, '1,5')
    await user.type(screen.getByLabelText(/Prix unitaire HT/), '19,99')

    // 1,5 x 19,99 = 29,985 -> 29,99 ; 20 % = 5,998 -> 6,00
    await waitFor(() => expect(plain(screen.getByTestId('total-excl'))).toBe('29,99 €'))
    expect(plain(screen.getByTestId('total-vat'))).toBe('6,00 €')
    expect(plain(screen.getByTestId('total-incl'))).toBe('35,99 €')

    await user.click(screen.getByRole('button', { name: /Ajouter une ligne/ }))
    const prices = screen.getAllByLabelText(/Prix unitaire HT/)
    await user.type(prices[1], '10')
    await waitFor(() => expect(plain(screen.getByTestId('total-incl'))).toBe('47,99 €'))
  })

  it('refuses to submit without tiers and lines, and says what to fix', async () => {
    const user = userEvent.setup()
    render(<InvoiceForm companyId="c1" direction="PURCHASE" />)
    await user.click(screen.getByRole('button', { name: 'Enregistrer la facture' }))
    expect(await screen.findByText('Choisissez le tiers')).toBeInTheDocument()
    expect(screen.getByText('Le numéro est requis')).toBeInTheDocument()
    expect(screen.getByText('La désignation est requise')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/invoices', expect.anything())
  })

  it('sends cents and basis points, never a total', async () => {
    const user = userEvent.setup()
    render(
      <InvoiceForm
        companyId="c1"
        direction="SALE"
        initial={{
          tiersId: 't1',
          number: 'V-1',
          issueDate: '2026-03-02',
          dueDate: '',
          typeCode: '380',
          label: '',
          lines: [{ label: 'Conseil', quantity: '2', unitPriceCents: 12_500, vatRateBp: '550', accountCode: '', nature: 'SERVICES', fixedAsset: false }],
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Enregistrer la facture' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/c1/invoices/inv-1'))
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/invoices') as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ companyId: 'c1', direction: 'SALE', tiersId: 't1', number: 'V-1', dueDate: null })
    expect(body.lines).toEqual([{ label: 'Conseil', quantity: '2', unitPriceCents: 12_500, vatRateBp: 550, accountCode: null, nature: 'SERVICES', fixedAsset: false }])
    expect(body.totalInclTax).toBeUndefined()
  })
})
