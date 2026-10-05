/**
 * Numbering of sales invoices in the UI: the settings card previews the next
 * number as the format is edited and saves it (PUT invoice-numbering); the
 * invoice form of a draft numbered by Kledg shows "Numéro attribué à
 * l'émission" with the provisional number, defaults to Qonto when
 * Qonto-first is on, and records an invoice already issued with its typed
 * number; the sales invoices page summarizes the VAT on debits option with
 * a link to its setting.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const router = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { toast } from 'sonner'
import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { DEFAULT_NUMBERING } from '@/lib/invoices/numbering/format'
import { InvoiceNumberingCard, type InvoiceNumberingView } from '../invoice-numbering-card'
import { InvoiceForm } from '../invoice-form'
import { VatSettingsSummary } from '../vat-settings-summary'
import { NumberingSuggestion } from '../numbering-suggestion'

const plain = (text: string | null | undefined) => (text ?? '').replace(/[  ]/g, ' ')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const fetchMock = vi.fn()

const VIEW: InvoiceNumberingView = {
  settings: { ...DEFAULT_NUMBERING },
  patterns: { invoice: 'F{YYYY}-{SEQ:4}', creditNote: 'F{YYYY}-{SEQ:4}' },
  next: { invoice: 'F2026-0042', creditNote: 'F2026-0042' },
  qonto: { connected: false, refusal: null, canCreate: false, active: false },
}

beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

describe('InvoiceNumberingCard', () => {
  const today = new Date(2026, 5, 15)

  it('previews the next number live as the format and the starting number change', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(json(VIEW))
    render(<InvoiceNumberingCard companyId="c1" today={today} />)
    const preview = await screen.findByTestId('numbering-preview')
    expect(plain(preview.textContent)).toContain('Format : F{YYYY}-{SEQ:4}')
    expect(plain(preview.textContent)).toContain('Prochaine facture : F2026-0042')

    const prefix = screen.getByLabelText(/Préfixe/)
    await user.clear(prefix)
    await user.type(prefix, 'FA')
    expect(plain(preview.textContent)).toContain('Prochaine facture : FA2026-0042')
    await user.type(screen.getByLabelText(/Prochain numéro de facture/), '138')
    expect(plain(preview.textContent)).toContain('Prochaine facture : FA2026-0138')
    const padding = screen.getByLabelText(/Chiffres de la séquence/)
    await user.clear(padding)
    await user.type(padding, '2')
    // Never cut: 138 needs three digits
    expect(plain(preview.textContent)).toContain('Prochaine facture : FA2026-138')
  })

  it('explains a configuration that would repeat numbers, and saves a valid one with the starting number', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(VIEW)).mockResolvedValueOnce(json({ ...VIEW, next: { invoice: 'F2026-0138', creditNote: 'F2026-0138' } }))
    render(<InvoiceNumberingCard companyId="c1" today={today} />)
    await screen.findByTestId('numbering-preview')
    await user.type(screen.getByLabelText(/Prochain numéro de facture/), '138')
    await user.click(screen.getByRole('button', { name: /Enregistrer la numérotation/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Numérotation enregistrée'))
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/companies/c1/invoice-numbering')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({ settings: DEFAULT_NUMBERING, nextNumbers: { invoice: 138 } })
  })

  it('is read only for a role that cannot change the settings', async () => {
    fetchMock.mockResolvedValue(json(VIEW))
    render(
      <CompanyAccessProvider value={{ granted: { settings: ['read'] }, roleLabel: 'Comptable' }}>
        <InvoiceNumberingCard companyId="c1" today={today} />
      </CompanyAccessProvider>,
    )
    await screen.findByTestId('numbering-preview')
    expect(screen.getByText(/ne permet pas de changer la numérotation/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Enregistrer la numérotation/ })).toBeDisabled()
  })
})

describe('InvoiceForm numbering', () => {
  const tiers = json({ tiers: [{ id: 't1', name: 'Martin SA', auxiliaryAccountNumber: 'C00001', defaultAccountCode: null, defaultVatRateBp: null }] })

  it('shows "Numéro attribué à l’émission" with the provisional number for a draft numbered by Kledg', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('/api/tiers') ? tiers.clone() : json({}, 404)))
    render(
      <InvoiceForm
        companyId="c1"
        direction="SALE"
        invoiceId="inv-1"
        edited={{ origin: 'AUTO', number: null, provisionalNumber: 'F2026-0007' }}
        initial={{ tiersId: 't1', number: '', numbering: 'kledg', issueDate: '2026-03-02', dueDate: '', typeCode: '380', label: '', lines: [{ label: 'A', quantity: '1', unitPriceCents: 100, vatRateBp: '2000', accountCode: '', nature: 'SERVICES', fixedAsset: false }] }}
      />,
    )
    const hint = screen.getByTestId('invoice-number-hint')
    expect(plain(hint.textContent)).toBe('NuméroNuméro attribué à l’émissionProchain numéro prévu : F2026-0007')
    expect(screen.queryByPlaceholderText('ex. F2026-0042')).not.toBeInTheDocument()
  })

  it('creates a new sales invoice in Qonto by default when Qonto-first is on, without a number', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('/api/tiers')) return tiers.clone()
      if (url === '/api/companies/c1/invoice-numbering') return json({ ...VIEW, qonto: { connected: true, refusal: null, canCreate: true, active: true } })
      if (url === '/api/invoices' && init?.method === 'POST') return json({ id: 'inv-2', number: 'QF-001', origin: 'QONTO' }, 201)
      return json({}, 404)
    })
    render(
      <InvoiceForm
        companyId="c1"
        direction="SALE"
        initial={{ tiersId: 't1', number: '', numbering: 'kledg', issueDate: '2026-03-02', dueDate: '', typeCode: '380', label: '', lines: [{ label: 'A', quantity: '1', unitPriceCents: 100, vatRateBp: '2000', accountCode: '', nature: 'SERVICES', fixedAsset: false }] }}
      />,
    )
    const submit = await screen.findByRole('button', { name: 'Créer la facture dans Qonto' })
    expect(plain(screen.getByTestId('invoice-number-hint').textContent)).toContain('Donné par Qonto à la création')
    await user.click(submit)
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/c1/invoices/inv-2'))
    const body = JSON.parse(String((fetchMock.mock.calls.find(([u, i]) => u === '/api/invoices' && i?.method === 'POST') as [string, RequestInit])[1].body))
    expect(body).toMatchObject({ numbering: 'qonto', number: null })
    expect(toast.success).toHaveBeenCalledWith('Facture créée dans Qonto sous le n° QF-001')
  })

  it('creates a draft in Qonto when asked, the number then given once finalized in Qonto', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('/api/tiers')) return tiers.clone()
      if (url === '/api/companies/c1/invoice-numbering') return json({ ...VIEW, qonto: { connected: true, refusal: null, canCreate: true, active: true } })
      if (url === '/api/invoices' && init?.method === 'POST') return json({ id: 'inv-4', number: null, origin: 'QONTO', qontoDraft: true }, 201)
      return json({}, 404)
    })
    render(
      <InvoiceForm
        companyId="c1"
        direction="SALE"
        initial={{ tiersId: 't1', number: '', numbering: 'kledg', issueDate: '2026-03-02', dueDate: '', typeCode: '380', label: '', lines: [{ label: 'A', quantity: '1', unitPriceCents: 100, vatRateBp: '2000', accountCode: '', nature: 'SERVICES', fixedAsset: false }] }}
      />,
    )
    await screen.findByRole('button', { name: 'Créer la facture dans Qonto' })
    expect(screen.getByRole('radio', { name: 'Facture finalisée dans Qonto' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('radio', { name: 'Brouillon dans Qonto' }))
    expect(plain(screen.getByTestId('invoice-number-hint').textContent)).toContain('Donné par Qonto quand le brouillon sera finalisé dans Qonto')
    await user.click(screen.getByRole('button', { name: 'Créer le brouillon dans Qonto' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/c1/invoices/inv-4'))
    const body = JSON.parse(String((fetchMock.mock.calls.find(([u, i]) => u === '/api/invoices' && i?.method === 'POST') as [string, RequestInit])[1].body))
    expect(body).toMatchObject({ numbering: 'qonto', qontoStatus: 'draft', number: null })
    expect(toast.success).toHaveBeenCalledWith('Brouillon créé dans Qonto')
  })

  it('records an invoice already issued with its typed number, required', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('/api/tiers')) return tiers.clone()
      if (url === '/api/companies/c1/invoice-numbering') return json(VIEW)
      if (url === '/api/invoices' && init?.method === 'POST') return json({ id: 'inv-3', number: 'ANC-12', origin: 'RECORDED' }, 201)
      return json({}, 404)
    })
    render(
      <InvoiceForm
        companyId="c1"
        direction="SALE"
        initial={{ tiersId: 't1', number: '', numbering: 'kledg', issueDate: '2026-03-02', dueDate: '', typeCode: '380', label: '', lines: [{ label: 'A', quantity: '1', unitPriceCents: 100, vatRateBp: '2000', accountCode: '', nature: 'SERVICES', fixedAsset: false }] }}
      />,
    )
    expect(await screen.findByText('Numéro attribué à l’émission')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Enregistrer une facture déjà émise' }))
    await user.click(screen.getByRole('button', { name: 'Enregistrer la facture' }))
    expect(await screen.findByText('Le numéro est requis')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('ex. F2026-0042'), 'ANC-12')
    await user.click(screen.getByRole('button', { name: 'Enregistrer la facture' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/c1/invoices/inv-3'))
    const body = JSON.parse(String((fetchMock.mock.calls.find(([u, i]) => u === '/api/invoices' && i?.method === 'POST') as [string, RequestInit])[1].body))
    expect(body).toMatchObject({ numbering: 'recorded', number: 'ANC-12' })
  })
})

describe('numbering invitation', () => {
  it('invites a company that types its numbers since before automatic numbering to configure it, with a link', async () => {
    fetchMock.mockResolvedValue(json({ ...VIEW, settings: { ...DEFAULT_NUMBERING, mode: 'MANUAL' }, next: { invoice: null, creditNote: null }, suggestAutomatic: true }))
    render(<NumberingSuggestion companyId="c1" />)
    expect(plain((await screen.findByTestId('numbering-suggestion')).textContent)).toContain('Les numéros de vos factures de vente sont saisis à la main.')
    expect(screen.getByRole('link', { name: 'Configurer la numérotation' })).toHaveAttribute('href', '/c1/informations#numerotation-factures')
  })

  it('shows the invitation in the settings card too, and nothing once configured', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...VIEW, settings: { ...DEFAULT_NUMBERING, mode: 'MANUAL' }, suggestAutomatic: true }))
    const { unmount } = render(<InvoiceNumberingCard companyId="c1" today={new Date(2026, 5, 15)} />)
    expect(await screen.findByTestId('numbering-suggestion')).toBeInTheDocument()
    unmount()
    fetchMock.mockResolvedValueOnce(json({ ...VIEW, suggestAutomatic: false }))
    render(<NumberingSuggestion companyId="c1" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('numbering-suggestion')).not.toBeInTheDocument()
  })
})

describe('VatSettingsSummary', () => {
  it('summarizes when the VAT of services is due, with a link to the setting', async () => {
    fetchMock.mockResolvedValue(json({ servicesVatOnDebits: false, isVatExempt: false }))
    render(<VatSettingsSummary companyId="c1" />)
    const summary = await screen.findByTestId('vat-settings-summary')
    expect(plain(summary.textContent)).toBe('TVA sur les prestations : exigible à l’encaissement. Modifier')
    expect(screen.getByRole('link', { name: 'Modifier' })).toHaveAttribute('href', '/c1/informations#tva-debits')
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('says "d’après les débits" with the option, and nothing under the VAT franchise', async () => {
    fetchMock.mockResolvedValueOnce(json({ servicesVatOnDebits: true, isVatExempt: false }))
    const { unmount } = render(<VatSettingsSummary companyId="c1" />)
    expect(plain((await screen.findByTestId('vat-settings-summary')).textContent)).toContain('d’après les débits')
    unmount()
    fetchMock.mockResolvedValueOnce(json({ servicesVatOnDebits: false, isVatExempt: true }))
    render(<VatSettingsSummary companyId="c1" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('vat-settings-summary')).not.toBeInTheDocument()
  })
})
