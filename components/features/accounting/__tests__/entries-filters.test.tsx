import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { EntriesFilters, entriesFilterParams, type EntriesFilters as EntriesFiltersType } from '../entries-filters'

vi.mock('@/components/features/accounting/fiscal-year-selector', () => ({
  FiscalYearSelector: ({ value, onValueChange, id }: { value?: string; onValueChange: (v: string) => void; id?: string }) => (
    <select id={id} data-testid="fiscal-year-selector" value={value ?? ''} onChange={(e) => onValueChange(e.target.value)}>
      <option value="fy-2026">2026</option>
      <option value="fy-2025">2025</option>
    </select>
  ),
}))

const journals = [
  { id: 'journal-od', code: 'OD', label: 'Opérations diverses' },
  { id: 'journal-ac', code: 'AC', label: 'Achats' },
]

function renderFilters(overrides: Partial<EntriesFiltersType> = {}, extra: { onFiscalYearChange?: (id: string) => void } = {}) {
  const onFiltersChange = vi.fn()
  const utils = render(
    <EntriesFilters
      journals={journals}
      filters={{ ...overrides }}
      onFiltersChange={onFiltersChange}
      companyId="company-1"
      fiscalYearId="fy-2026"
      onFiscalYearChange={extra.onFiscalYearChange}
    />,
  )
  return { ...utils, onFiltersChange }
}

describe('entriesFilterParams', () => {
  it('sends nothing for no filter and "all" status', () => {
    expect(entriesFilterParams({ status: 'all', description: '  ' }).toString()).toBe('')
  })

  it('maps every filter to the API parameters', () => {
    expect(
      Object.fromEntries(
        entriesFilterParams({
          journalId: 'journal-od',
          status: 'draft',
          entryNumber: ' 42 ',
          description: 'loyer',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          minAmountCents: 10050,
          maxAmountCents: 100000,
        }),
      ),
    ).toEqual({
      journalId: 'journal-od',
      status: 'draft',
      number: '42',
      search: 'loyer',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      minAmount: '100.50',
      maxAmount: '1000.00',
    })
  })
})

describe('EntriesFilters', () => {
  it('shows the fiscal year, search, journal and status in the toolbar, all labelled', () => {
    renderFilters({}, { onFiscalYearChange: vi.fn() })
    expect(screen.getByLabelText('Exercice')).toBe(screen.getByTestId('fiscal-year-selector'))
    expect(screen.getByLabelText('Recherche')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Journal' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Statut' })).toBeInTheDocument()
    // Advanced filters are folded
    expect(screen.queryByLabelText("Numéro d'écriture")).not.toBeInTheDocument()
  })

  it('changes the fiscal year through its own callback', async () => {
    const onFiscalYearChange = vi.fn()
    renderFilters({}, { onFiscalYearChange })
    await userEvent.setup().selectOptions(screen.getByLabelText('Exercice'), 'fy-2025')
    expect(onFiscalYearChange).toHaveBeenCalledWith('fy-2025')
  })

  it('unfolds the advanced filters with labels', async () => {
    const user = userEvent.setup()
    renderFilters()
    await user.click(screen.getByRole('button', { name: 'Plus de filtres' }))
    expect(screen.getByRole('button', { name: 'Moins de filtres' })).toHaveAttribute('aria-expanded', 'true')
    for (const label of ["Numéro d'écriture", 'Date de début', 'Date de fin', 'Montant minimum', 'Montant maximum']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
  })

  it('opens the advanced filters when one is active and counts them', () => {
    renderFilters({ startDate: '2026-01-01', minAmountCents: 100 })
    expect(screen.getByRole('button', { name: /Moins de filtres/ })).toHaveTextContent('2')
  })

  it('sends text filters once typing pauses', async () => {
    const user = userEvent.setup()
    const { onFiltersChange } = renderFilters({ startDate: '2026-01-01' })
    await user.type(screen.getByLabelText("Numéro d'écriture"), '42')
    await waitFor(() => expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ entryNumber: '42', startDate: '2026-01-01' })))
    expect(onFiltersChange).toHaveBeenCalledTimes(1)
  })

  it('reads French amounts and dates', async () => {
    const user = userEvent.setup()
    const { onFiltersChange } = renderFilters({ endDate: '2026-12-31' })
    await user.type(screen.getByLabelText('Montant minimum'), '1 500,25')
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ minAmountCents: 150025 }))
    await user.type(screen.getByLabelText('Date de début'), '15/03/2026')
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ startDate: '2026-03-15' }))
  })

  it('lists active filters with named remove buttons and resets them', async () => {
    const user = userEvent.setup()
    const { onFiltersChange } = renderFilters({ journalId: 'journal-ac', status: 'validated', startDate: '2026-01-01', endDate: '2026-01-31' })
    expect(screen.getByText('Journal : AC')).toBeInTheDocument()
    expect(screen.getByText('Validées')).toBeInTheDocument()
    expect(screen.getByText('Du 01/01/2026 au 31/01/2026')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retirer le filtre Journal\u00a0: AC' }))
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ journalId: undefined, status: 'validated' }))

    await user.click(screen.getByRole('button', { name: 'Réinitialiser' }))
    expect(onFiltersChange).toHaveBeenLastCalledWith({})
  })

  it('shows no active filter row without filters', () => {
    renderFilters({ status: 'all' })
    expect(screen.queryByRole('button', { name: 'Réinitialiser' })).not.toBeInTheDocument()
  })
})

describe('EntriesFilters on phones', () => {
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
    renderFilters({ journalId: 'journal-ac', status: 'draft' }, { onFiscalYearChange: vi.fn() })
    expect(screen.getByLabelText('Recherche')).toBeInTheDocument()
    expect(screen.queryByLabelText('Journal')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Plus de filtres/ })).not.toBeInTheDocument()
    // Active filters stay visible as chips under the search
    expect(screen.getByText('Brouillons')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Filtres, 2 actifs' }))
    const sheet = await screen.findByRole('dialog', { name: 'Filtres' })
    for (const label of ['Exercice', 'Journal', 'Statut', "Numéro d'écriture", 'Montant minimum']) {
      expect(sheet).toContainElement(screen.getByLabelText(label))
    }
    await user.click(screen.getByRole('button', { name: 'Voir les écritures' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filtres' })).not.toBeInTheDocument())
  })
})
