import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  EMPTY_TRANSACTION_FILTERS,
  TransactionFiltersComponent,
  transactionFilterParams,
  type TransactionFilters,
} from '../transaction-filters'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

// The embedded FiscalYearSelector and DatePickerWithRange bring Radix/popover
// machinery; stub them with lightweight fakes so the filters' own behaviour is
// what we test.
vi.mock('@/components/features/accounting/fiscal-year-selector', () => ({
  FiscalYearSelector: ({ value, onValueChange, id }: { value?: string; onValueChange: (v: string) => void; id?: string }) => (
    <select id={id} data-testid="fiscal-year-selector" value={value ?? ''} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">Aucun</option>
      <option value="fy-2025">2025</option>
      <option value="fy-2024">2024</option>
    </select>
  ),
}))

vi.mock('@/components/ui/date-picker', () => ({
  DatePicker: () => <div data-testid="date-picker" />,
  formatDateRange: () => 'Du 01/03/2026 au 31/03/2026',
  DatePickerWithRange: ({ id }: { id?: string }) => (
    <button id={id} data-testid="date-range" type="button">
      range
    </button>
  ),
}))

const BANK_ACCOUNTS = [
  { id: 'bank-1', name: 'Principal', displayName: 'Compte principal' },
  { id: 'bank-2', name: 'Epargne' },
]

function renderFilters(
  opts: {
    filters?: Partial<TransactionFilters>
    companyId?: string
    availableCategories?: Parameters<typeof TransactionFiltersComponent>[0]['availableCategories']
    onReset?: () => void
  } = {},
) {
  const onFiltersChange = vi.fn()
  const utils = render(
    <TransactionFiltersComponent
      filters={{ ...EMPTY_TRANSACTION_FILTERS, ...opts.filters }}
      onFiltersChange={onFiltersChange}
      bankAccounts={BANK_ACCOUNTS}
      availableCategories={opts.availableCategories}
      companyId={opts.companyId}
      onReset={opts.onReset}
    />,
  )
  return { ...utils, onFiltersChange }
}

describe('transactionFilterParams', () => {
  it('sends nothing for the default filters', () => {
    expect(transactionFilterParams(EMPTY_TRANSACTION_FILTERS).toString()).toBe('')
  })

  it('sends every filter to the server: calendar days, cents as decimals, categories', () => {
    const params = transactionFilterParams({
      ...EMPTY_TRANSACTION_FILTERS,
      bankAccountId: 'bank-1',
      fiscalYearId: 'fy-2026',
      // Local midnight from the date picker: the calendar day the user clicked
      dateRange: { from: new Date(2026, 2, 1), to: new Date(2026, 2, 31) },
      reconciled: 'unreconciled',
      side: 'debit',
      hasAttachments: 'without',
      minAmountCents: 10050,
      maxAmountCents: 250000,
      searchText: '  loyer ',
      cashflowCategory: 'Exploitation',
      operationType: 'transfer',
    })
    expect(Object.fromEntries(params)).toEqual({
      bankAccountId: 'bank-1',
      fiscalYearId: 'fy-2026',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      reconciled: 'false',
      side: 'debit',
      hasAttachments: 'without',
      minAmount: '100.50',
      maxAmount: '2500.00',
      searchText: 'loyer',
      cashflowCategory: 'Exploitation',
      operationType: 'transfer',
    })
  })
})

describe('TransactionFiltersComponent', () => {
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('labels every field of the toolbar', () => {
    renderFilters({ companyId: 'company-1' })
    expect(screen.getByLabelText('Recherche')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Compte' })).toBeInTheDocument()
    expect(screen.getByLabelText('Exercice')).toBe(screen.getByTestId('fiscal-year-selector'))
    expect(screen.getByRole('combobox', { name: 'Statut' })).toBeInTheDocument()
  })

  it('keeps the advanced filters folded until asked, and labels them', async () => {
    const user = userEvent.setup()
    renderFilters({
      availableCategories: { cashflowCategories: ['Exploitation'], cashflowSubcategories: [], categories: ['Loyer'], operationTypes: ['transfer'] },
    })
    const toggle = screen.getByRole('button', { name: /Plus de filtres/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Montant minimum')).not.toBeInTheDocument()

    await user.click(toggle)
    expect(screen.getByRole('button', { name: /Moins de filtres/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Période')).toBe(screen.getByTestId('date-range'))
    expect(screen.getByRole('combobox', { name: 'Sens' })).toBeInTheDocument()
    expect(screen.getByLabelText('Montant minimum')).toBeInTheDocument()
    expect(screen.getByLabelText('Montant maximum')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Justificatifs' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Catégorie de flux' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Catégorie' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: "Type d'opération" })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Sous-catégorie de flux' })).not.toBeInTheDocument()
  })

  it('opens the advanced filters when one of them is active', () => {
    renderFilters({ filters: { side: 'credit' } })
    expect(screen.getByRole('button', { name: /Moins de filtres/ })).toHaveTextContent('1')
  })

  it('reads French amounts into cents', async () => {
    const user = userEvent.setup()
    const { onFiltersChange } = renderFilters({ filters: { side: 'debit' } })
    await user.type(screen.getByLabelText('Montant minimum'), '1 234,5')
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ minAmountCents: 123450 }))
  })

  it('sends the search once typing pauses', async () => {
    const user = userEvent.setup()
    const { onFiltersChange } = renderFilters()
    await user.type(screen.getByLabelText('Recherche'), 'loyer')
    await waitFor(() => expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ searchText: 'loyer' })))
    expect(onFiltersChange).toHaveBeenCalledTimes(1)
  })

  describe('active filters', () => {
    it('lists them with French labels and named remove buttons', async () => {
      const user = userEvent.setup()
      const { onFiltersChange } = renderFilters({
        filters: { bankAccountId: 'bank-1', reconciled: 'unreconciled', searchText: 'loyer', minAmountCents: 10000, maxAmountCents: 50000 },
      })
      expect(screen.getByText('Compte : Compte principal')).toBeInTheDocument()
      expect(screen.getByText('Recherche : loyer')).toBeInTheDocument()
      expect(screen.getByText(/Montant : de 100,00\s€ à 500,00\s€/)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Retirer le filtre Compte\u00a0: Compte principal' }))
      expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ bankAccountId: 'all', searchText: 'loyer' }))
    })

    it('falls back to the account name and translates operation types', () => {
      renderFilters({ filters: { bankAccountId: 'bank-2', operationType: 'transfer', side: 'debit' } })
      expect(screen.getByText('Compte : Epargne')).toBeInTheDocument()
      expect(screen.getByText('Opération : Virement')).toBeInTheDocument()
      expect(screen.getByText('Sorties')).toBeInTheDocument()
    })

    it('does not list the fiscal year: it is the scope shown in the toolbar', () => {
      renderFilters({ filters: { fiscalYearId: 'fy-2025' }, companyId: 'company-1' })
      expect(screen.queryByRole('button', { name: 'Réinitialiser' })).not.toBeInTheDocument()
    })

    it('resets everything but the fiscal year', async () => {
      const user = userEvent.setup()
      const { onFiltersChange } = renderFilters({ filters: { searchText: 'loyer', side: 'debit', fiscalYearId: 'fy-2025' } })
      await user.click(screen.getByRole('button', { name: 'Réinitialiser' }))
      expect(onFiltersChange).toHaveBeenLastCalledWith({ ...EMPTY_TRANSACTION_FILTERS, fiscalYearId: 'fy-2025' })
    })

    it('calls onReset when provided', async () => {
      const onReset = vi.fn()
      const user = userEvent.setup()
      renderFilters({ filters: { searchText: 'loyer' }, onReset })
      await user.click(screen.getByRole('button', { name: 'Réinitialiser' }))
      expect(onReset).toHaveBeenCalledTimes(1)
    })
  })

  it('only renders the fiscal year selector when a companyId is provided', () => {
    const { unmount } = renderFilters()
    expect(screen.queryByTestId('fiscal-year-selector')).not.toBeInTheDocument()
    unmount()
    renderFilters({ companyId: 'company-1' })
    expect(screen.getByTestId('fiscal-year-selector')).toBeInTheDocument()
  })
})

describe('TransactionFiltersComponent on phones', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the search on the page and moves the other filters into a sheet', async () => {
    const user = userEvent.setup()
    renderFilters({ filters: { reconciled: 'unreconciled', side: 'debit' }, companyId: 'c1' })
    expect(screen.getByLabelText('Recherche')).toBeInTheDocument()
    expect(screen.queryByLabelText('Statut')).not.toBeInTheDocument()
    // Count of the filters inside the sheet (status and direction), the fiscal year is the scope
    const trigger = screen.getByRole('button', { name: 'Filtres, 2 actifs' })

    await user.click(trigger)
    const sheet = await screen.findByRole('dialog', { name: 'Filtres' })
    expect(sheet).toContainElement(screen.getByLabelText('Statut'))
    expect(sheet).toContainElement(screen.getByLabelText('Montant minimum'))
    await user.click(screen.getByRole('button', { name: 'Voir les transactions' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filtres' })).not.toBeInTheDocument())
  })
})

