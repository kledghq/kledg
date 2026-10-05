/**
 * The option to pay VAT on services on debits (CGI art. 269, 2, c), edited
 * in the company settings only: the card shows the rule and its source and
 * saves the option through PUT /api/companies/[id]/vat-settings.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from 'sonner'
import { VatOnDebitsCard } from '../vat-on-debits-card'

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const fetchMock = vi.fn()

beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('VatOnDebitsCard', () => {
  it('renders the option with its legal source and saves it', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json({ servicesVatOnDebits: false, isVatExempt: false })).mockResolvedValueOnce(json({ servicesVatOnDebits: true, isVatExempt: false }))
    const { container } = render(<VatOnDebitsCard companyId="c1" />)
    const toggle = await screen.findByRole('switch', { name: 'Option pour le paiement de la TVA d’après les débits' })
    expect(screen.getByText(/CGI art\. 269, 2, c/)).toBeInTheDocument()
    expect(container.querySelector('#tva-debits')).not.toBeNull()
    await user.click(toggle)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('TVA sur les débits enregistrée'))
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/companies/c1/vat-settings')
    expect(JSON.parse(String(init.body))).toEqual({ servicesVatOnDebits: true })
    expect(screen.getByRole('switch')).toBeChecked()
  })
})

describe('single place of edit', () => {
  const page = (file: string) => readFileSync(path.join(process.cwd(), 'app/(company)/[companyId]', file), 'utf8')

  it('is edited with the VAT regimes in Informations, next to the invoice numbering, and only summarized on the sales invoices page', () => {
    const informations = page('informations/page.tsx')
    expect(informations).toMatch(/<TaxRegimeHistory companyId=\{companyId\} \/>\s*<VatOnDebitsCard companyId=\{companyId\} \/>/)
    expect(informations).toContain('<InvoiceNumberingCard companyId={companyId} />')
    const sales = page('invoices/sales/page.tsx')
    expect(sales).toContain('<VatSettingsSummary companyId={companyId} />')
    expect(sales).not.toMatch(/VatOnDebitsCard|Switch/)
  })
})
