import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TransactionsDataTable } from '../transactions-data-table'
import type { BankTransaction } from '../transactions-types'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('@/components/features/justificatifs/justificatif-preview-dialog', () => ({ JustificatifPreviewDialog: () => null }))
vi.mock('@/components/features/accounting/entry-preview-dialog', () => ({ EntryPreviewDialog: () => null }))

function tx(id: string, day: string, amount: number, side: 'debit' | 'credit', extra: Partial<BankTransaction> = {}): BankTransaction {
  return {
    id,
    amount,
    date: `${day}T00:00:00.000Z`,
    label: `Libellé ${id}`,
    reference: null,
    side,
    reconciled: false,
    counterpartyName: `Contrepartie ${id}`,
    operationType: 'transfer',
    bankAccount: { id: 'ba', name: 'compte-principal', displayName: 'Compte principal', iban: null },
    ...extra,
  }
}

const page1 = [tx('t1', '2026-03-01', 100.1, 'credit'), tx('t2', '2026-03-02', 0.2, 'debit', { reconciled: true })]
const page2 = [tx('t3', '2026-03-03', 1000, 'credit')]

/** Text of the cell of `column` (header text) in the row of `rowName`. */
function cell(rowName: string, column: string) {
  const table = screen.getByRole('table')
  const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
  const row = within(table).getByText(rowName).closest('tr')!
  return within(row).getAllByRole('cell')[headers.indexOf(column)].textContent
}

describe('TransactionsDataTable', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows French dates, signed amounts and a running balance in cents that continues across pages', () => {
    const { rerender } = render(<TransactionsDataTable data={page1} balanceBefore={1000} hasMore onLoadMore={vi.fn()} />)
    expect(cell('Contrepartie t1', 'Date')).toBe('01/03/2026')
    expect(cell('Contrepartie t1', 'Montant')).toMatch(/^\+100,10\s€$/)
    expect(cell('Contrepartie t2', 'Montant')).toMatch(/^-0,20\s€$/)
    // 1000 + 100.10 - 0.20, exact
    expect(cell('Contrepartie t2', 'Solde')).toMatch(/^1\s099,90\s€$/)
    expect(cell('Contrepartie t1', 'Catégorie')).toBe('Virement')
    expect(screen.getByText(/2 transactions affichées, la suite se charge en descendant/)).toBeInTheDocument()

    rerender(<TransactionsDataTable data={[...page1, ...page2]} balanceBefore={1000} hasMore={false} onLoadMore={vi.fn()} />)
    expect(cell('Contrepartie t3', 'Solde')).toMatch(/^2\s099,90\s€$/)
    const footer = screen.getByText('Total').closest('tr')!
    expect(footer.textContent).toMatch(/\+1\s099,90\s€/)
    expect(screen.queryByRole('button', { name: 'Charger plus' })).not.toBeInTheDocument()
  })

  it('names every control in French', () => {
    render(<TransactionsDataTable data={page1} />)
    expect(screen.getByRole('checkbox', { name: 'Sélectionner toutes les transactions affichées' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Sélectionner la transaction Contrepartie t1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actions sur la transaction Contrepartie t1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Colonnes' })).toBeInTheDocument()
    expect(screen.getByText('Non rapprochée')).toBeInTheDocument()
    expect(screen.getByText('Rapprochée')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Rows per page|Open menu|Select all|View/)
  })

  it('shows skeleton rows, the empty message and a retry on error', async () => {
    const { rerender } = render(<TransactionsDataTable data={[]} loading />)
    expect(document.querySelectorAll('[data-slot="table-skeleton"]').length).toBeGreaterThan(0)

    rerender(<TransactionsDataTable data={[]} empty="Aucune transaction ne correspond aux filtres." />)
    expect(screen.getByText('Aucune transaction ne correspond aux filtres.')).toBeInTheDocument()

    const onRetry = vi.fn()
    rerender(<TransactionsDataTable data={[]} error="Exercice introuvable" onRetry={onRetry} />)
    expect(screen.getByText('Exercice introuvable')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('reconciles the selected unreconciled transactions in one request', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ reconciled: 1, failed: 0 })))
    vi.stubGlobal('fetch', fetchMock)
    const onRefresh = vi.fn()
    const user = userEvent.setup()
    render(<TransactionsDataTable data={page1} onRefresh={onRefresh} companyId="c1" />)

    await user.click(screen.getByRole('checkbox', { name: 'Sélectionner toutes les transactions affichées' }))
    expect(screen.getByText('2 transactions sélectionnées')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rapprocher (1)' }))

    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/transactions/bulk-reconcile')
    expect(JSON.parse(init.body as string)).toEqual({ transactionIds: ['t1'] })
  })

  describe('on phones and small tablets', () => {
    /** matchMedia answering the compact layout query (below 1024px). */
    function compactScreen() {
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({
          matches: query.includes('max-width'),
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      )
    }

    it('lists each transaction as a block with its amount, balance, status and actions, without a table', () => {
      compactScreen()
      render(<TransactionsDataTable data={page1} balanceBefore={1000} />)
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      const items = within(screen.getByRole('list', { name: 'Transactions' })).getAllByRole('listitem')
      expect(items).toHaveLength(2)
      expect(items[0].textContent).toMatch(/Contrepartie t1/)
      expect(items[0].textContent).toMatch(/\+100,10\s€/)
      expect(items[0].textContent).toMatch(/01\/03\/2026/)
      expect(items[1].textContent).toMatch(/Solde 1\s099,90\s€/)
      expect(within(items[1]).getByText('Rapprochée')).toBeInTheDocument()
      expect(within(items[0]).getByRole('button', { name: 'Actions sur la transaction Contrepartie t1' })).toBeInTheDocument()
      // The column menu only makes sense for the table
      expect(screen.queryByRole('button', { name: 'Colonnes' })).not.toBeInTheDocument()
    })

    it('keeps the bulk actions in a bar at the bottom once rows are selected', async () => {
      compactScreen()
      const user = userEvent.setup()
      render(<TransactionsDataTable data={page1} companyId="c1" />)
      expect(screen.queryByRole('region', { name: 'Actions sur la sélection' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('checkbox', { name: 'Sélectionner la transaction Contrepartie t1' }))
      const bar = screen.getByRole('region', { name: 'Actions sur la sélection' })
      expect(within(bar).getByRole('button', { name: 'Rapprocher (1)' })).toBeInTheDocument()
      expect(within(bar).getByRole('button', { name: /Supprimer \(1\)/ })).toBeInTheDocument()
      expect(bar.className).toMatch(/safe-area-inset-bottom/)
    })
  })
})
