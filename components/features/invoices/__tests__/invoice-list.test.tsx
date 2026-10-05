import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { InvoiceList } from '../invoice-list'
import { ExpenseReportList } from '@/components/features/expense-reports/expense-report-list'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ items: [], invoices: [], reports: [], nextCursor: null }), { status: 200 })),
  )
})
afterEach(() => vi.unstubAllGlobals())

const emptyState = async (title: string) => (await screen.findByRole('heading', { name: title })).closest('[data-slot="empty-state"]') as HTMLElement

describe('empty lists say what to do next', () => {
  it('sales invoices: create the first invoice, or its customer first', async () => {
    render(<InvoiceList companyId="atelier" direction="SALE" />)
    const empty = await emptyState('Aucune facture de vente')
    expect(within(empty).getByRole('link', { name: 'Nouvelle facture' }).getAttribute('href')).toBe('/atelier/invoices/new?direction=SALE')
    expect(within(empty).getByRole('link', { name: 'Ajouter un client' }).getAttribute('href')).toBe('/atelier/tiers/new')
  })

  it('purchase invoices: create the first invoice', async () => {
    render(<InvoiceList companyId="atelier" direction="PURCHASE" />)
    const empty = await emptyState('Aucune facture d’achat')
    expect(within(empty).getByRole('link', { name: 'Nouvelle facture' }).getAttribute('href')).toBe('/atelier/invoices/new?direction=PURCHASE')
    expect(within(empty).queryByRole('link', { name: 'Ajouter un client' })).toBeNull()
  })

  it('offers no creation to a role that cannot create invoices', async () => {
    render(
      <CompanyAccessProvider value={{ granted: { entries: ['read'] }, roleLabel: 'Lecteur' }}>
        <InvoiceList companyId="atelier" direction="SALE" />
      </CompanyAccessProvider>,
    )
    const empty = await emptyState('Aucune facture de vente')
    expect(within(empty).queryByRole('link', { name: 'Nouvelle facture' })).toBeNull()
  })

  it('expense reports: file the first one', async () => {
    render(<ExpenseReportList companyId="atelier" mine={false} />)
    const empty = await emptyState('Aucune note de frais')
    expect(within(empty).getByRole('link', { name: 'Nouvelle note de frais' }).getAttribute('href')).toBe('/atelier/expense-reports/new')
  })
})
