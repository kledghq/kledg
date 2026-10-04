import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EntriesList, type EntryListItem } from '../entries-list'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/components/features/onboarding/onboarding-empty-state', () => ({
  OnboardingEmptyState: ({ title }: { title: string }) => <p>{title}</p>,
}))

const line = (id: string, debit: string, credit: string) => ({ id, debit, credit, account: { code: '512000', label: 'Banque' } })

const entries: EntryListItem[] = [
  {
    id: 'e1',
    entryNumber: '12',
    date: '2026-03-02T00:00:00.000Z',
    description: 'Loyer de mars',
    status: 'validated',
    journal: { code: 'BQ', label: 'Banque' },
    lines: [line('l1', '1234.10', '0'), line('l2', '0', '1234.10')],
  },
  {
    id: 'e2',
    entryNumber: 'BR-1',
    date: '2026-03-01T00:00:00.000Z',
    description: null,
    status: 'draft',
    journal: { code: 'OD', label: 'Opérations diverses' },
    lines: [line('l3', '0.20', '0'), line('l4', '0', '0.20')],
  },
]

describe('EntriesList', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows French dates, journal codes, amounts and statuses, with a total of the loaded entries', () => {
    render(<EntriesList entries={entries} companyId="c1" hasMore onLoadMore={vi.fn()} />)
    const row = screen.getByText('Loyer de mars').closest('tr')!
    expect(within(row).getByText('02/03/2026')).toBeInTheDocument()
    expect(within(row).getByText('BQ')).toHaveClass('font-mono')
    expect(within(row).getByText('Validée')).toBeInTheDocument()
    expect(row.textContent).toMatch(/1\s234,10\s€/)
    expect(screen.getByText('Brouillon')).toBeInTheDocument()
    expect(screen.getByText('À la validation')).toBeInTheDocument()
    const total = screen.getByText('Total').closest('tr')!
    expect(total.textContent).toMatch(/1\s234,30\s€.*1\s234,30\s€/)
    expect(screen.getByText(/2 écritures affichées, la suite se charge en descendant/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Charger plus' })).toBeInTheDocument()
  })

  it('names the row actions after the entry', () => {
    render(<EntriesList entries={entries} companyId="c1" />)
    expect(screen.getByRole('link', { name: "Consulter l'écriture n° 12" })).toHaveAttribute('href', '/c1/entries/e1')
    expect(screen.getByRole('link', { name: 'Modifier le brouillon du 01/03/2026' })).toHaveAttribute('href', '/c1/entries/e2/edit')
    expect(screen.queryByRole('link', { name: "Modifier l'écriture n° 12" })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Autres actions sur l'écriture n° 12" })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Sélectionner toutes les écritures affichées' })).toBeInTheDocument()
  })

  it('shows the header checkbox as indeterminate (a dash, not a check) when some rows are selected', async () => {
    const user = userEvent.setup()
    render(<EntriesList entries={entries} companyId="c1" />)
    // The header cell renders again on selection: query it each time
    const header = () => screen.getByRole('checkbox', { name: 'Sélectionner toutes les écritures affichées' })
    await user.click(screen.getByRole('checkbox', { name: "Sélectionner l'écriture du 02/03/2026" }))
    expect(header()).toHaveAttribute('aria-checked', 'mixed')
    expect(header()).toHaveAttribute('data-state', 'indeterminate')
    // The dash is shown, the check mark hidden (their visibility follows data-state)
    expect(header().querySelector('.lucide-minus')).toHaveClass('group-data-[state=indeterminate]:block')
    expect(header().querySelector('.lucide-check')).toHaveClass('group-data-[state=indeterminate]:hidden')

    await user.click(screen.getByRole('checkbox', { name: "Sélectionner l'écriture du 01/03/2026" }))
    expect(header()).toHaveAttribute('aria-checked', 'true')
  })

  it('tells an empty company from filters that match nothing', () => {
    const { rerender } = render(<EntriesList entries={[]} companyId="c1" />)
    expect(screen.getByText("Aucune écriture pour l'instant")).toBeInTheDocument()
    rerender(<EntriesList entries={[]} companyId="c1" filtered />)
    expect(screen.getByText('Aucune écriture ne correspond aux filtres')).toBeInTheDocument()
  })

  it('shows skeleton rows while loading and a retry on error', async () => {
    const { rerender } = render(<EntriesList entries={[]} companyId="c1" loading />)
    expect(document.querySelectorAll('[data-slot="table-skeleton"]').length).toBeGreaterThan(0)
    const onRetry = vi.fn()
    rerender(<EntriesList entries={[]} companyId="c1" error="Exercice introuvable" onRetry={onRetry} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('validates only the selected drafts', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ validated: 1 })))
    vi.stubGlobal('fetch', fetchMock)
    const onEntryUpdated = vi.fn()
    const user = userEvent.setup()
    render(<EntriesList entries={entries} companyId="c1" onEntryUpdated={onEntryUpdated} />)
    await user.click(screen.getByRole('checkbox', { name: 'Sélectionner toutes les écritures affichées' }))
    expect(screen.getByText('2 sélectionnées, dont 1 validée')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Valider (1)' }))
    await waitFor(() => expect(onEntryUpdated).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/entries/bulk-validate')
    expect(JSON.parse(init.body as string)).toEqual({ companyId: 'c1', entryIds: ['e2'], status: 'validated' })
  })
})

// Narrow containers stack each row into a card through container queries on
// the same markup: the card shows the table's data and actions, nothing is
// rendered twice.
describe('EntriesList stacked rows', () => {
  it('renders every value once, in cells laid out for the stacked card', () => {
    render(<EntriesList entries={entries} companyId="c1" />)
    const row = screen.getByText('Loyer de mars').closest('tr')!
    expect(row.closest('[class*="@container/entries"]')).not.toBeNull()
    expect(row.className).toContain('@max-[56rem]/entries:flex')
    // Same data as the table: date, journal, number, description, status, amount
    for (const text of ['02/03/2026', 'BQ', '12', 'Validée']) expect(within(row).getAllByText(text)).toHaveLength(1)
    const amounts = within(row).getAllByText('1 234,10 €')
    expect(amounts).toHaveLength(2)
    // The debit total is the card's amount; the credit (equal, entries are balanced) is left out of the card
    const [debitCell, creditCell] = amounts.map((amount) => amount.closest('td')!)
    expect(debitCell.className).toContain('@max-[56rem]/entries:ml-auto')
    expect(creditCell.className).toContain('@max-[56rem]/entries:hidden')
  })

  it('gives the select-all box a visible label once the header row is gone', async () => {
    const user = userEvent.setup()
    render(<EntriesList entries={entries} companyId="c1" />)
    await user.click(screen.getByText('Tout sélectionner'))
    expect(screen.getByRole('checkbox', { name: 'Sélectionner toutes les écritures affichées' })).toHaveAttribute('data-state', 'checked')
  })

  it('keeps Consulter and Modifier in the row menu, the only actions left on a stacked row', async () => {
    const user = userEvent.setup()
    render(<EntriesList entries={entries} companyId="c1" />)
    // The icon links are hidden on stacked rows
    expect(screen.getByRole('link', { name: "Consulter l'écriture n° 12" }).className).toContain('@max-[56rem]/entries:hidden')

    await user.click(screen.getByRole('button', { name: 'Autres actions sur le brouillon du 01/03/2026' }))
    expect(screen.getByRole('menuitem', { name: 'Consulter' })).toHaveAttribute('href', '/c1/entries/e2')
    expect(screen.getByRole('menuitem', { name: 'Modifier' })).toHaveAttribute('href', '/c1/entries/e2/edit')
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: "Autres actions sur l'écriture n° 12" }))
    expect(screen.getByRole('menuitem', { name: 'Consulter' })).toHaveAttribute('href', '/c1/entries/e1')
    expect(screen.queryByRole('menuitem', { name: 'Modifier' })).not.toBeInTheDocument()
  })
})
