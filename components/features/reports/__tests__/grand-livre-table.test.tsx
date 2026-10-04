/**
 * Grand livre on narrow containers: under 56rem of container width the
 * account title heads a section and each line becomes a card on the same
 * markup (container queries). Débit, Crédit and Solde are named by their
 * data-label, the empty side disappears, the account totals read Total débit,
 * Total crédit and Solde, and every value is still rendered once.
 */

import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { formatAmount } from '@/components/shared'
import { GrandLivreTable, type GrandLivreData } from '../grand-livre-table'

const data: GrandLivreData = {
  fiscalYear: { id: 'fy', year: 2023, startDate: '2023-01-01T00:00:00.000Z', endDate: '2023-12-31T00:00:00.000Z' },
  period: { startDate: '2023-01-01T00:00:00.000Z', endDate: '2023-12-31T00:00:00.000Z' },
  accounts: [
    {
      account: { id: 'a512', code: '512000', label: 'Banque' },
      opening: { debit: 1000, credit: 0, balance: 1000 },
      closing: { debit: 1250.5, credit: 0, balance: 1250.5 },
      entryLines: [
        {
          id: 'l1',
          date: '2023-02-03T00:00:00.000Z',
          reference: 'BQ-7',
          journal: { code: 'BQ', label: 'Banque' },
          description: 'Règlement client DUPONT',
          debit: 400.25,
          credit: 0,
          runningBalance: 1400.25,
        },
        {
          id: 'l2',
          date: '2023-02-10T00:00:00.000Z',
          reference: 'BQ-9',
          journal: { code: 'BQ', label: 'Banque' },
          description: 'Loyer',
          debit: 0,
          credit: 149.75,
          runningBalance: 1250.5,
        },
      ],
      totals: { debit: 400.26, credit: 149.76, balance: 1250.51 },
    },
  ],
  grandTotals: { debit: 400.27, credit: 149.77 },
  totals: {
    opening: { debit: 1000.01, credit: 0.01 },
    movements: { debit: 400.27, credit: 149.77 },
    closing: { debit: 1250.52, credit: 0.02 },
  },
}

const NARROW = '@max-[56rem]/ledger:'
// toHaveTextContent collapses the no-break spaces of formatAmount into plain spaces.
const amount = (value: number) => formatAmount(value).replace(/\s/g, ' ')
const visibleCells = (value: number) =>
  screen
    .getAllByRole('cell')
    .filter((cell) => cell.textContent === formatAmount(value) && !cell.className.includes(`${NARROW}hidden`))

describe('GrandLivreTable', () => {
  it('renders each value once on the same markup', () => {
    render(<GrandLivreTable data={data} />)
    for (const value of [400.25, 149.75, 1400.25, 1250.5, 400.26, 149.76, 400.27, 149.77, 1000.01, 1250.52]) {
      expect(visibleCells(value)).toHaveLength(1)
    }
    expect(screen.getAllByText('Règlement client DUPONT')).toHaveLength(1)
    expect(screen.getAllByText('Compte 512000 - Banque')).toHaveLength(1)
    expect(screen.getAllByRole('table')).toHaveLength(1)
  })

  it('names Débit, Crédit and Solde and hides the empty side of a line', () => {
    render(<GrandLivreTable data={data} />)
    expect(screen.getByRole('columnheader', { name: 'Solde' }).closest('thead')!.className).toContain(`${NARROW}hidden`)

    const loyer = screen.getByText('Loyer').closest('tr')!
    const [debit, credit, balance] = within(loyer).getAllByRole('cell').slice(-3)
    expect(debit).toHaveAttribute('data-label', 'Débit')
    expect(debit).toHaveAttribute('data-empty')
    expect(debit.className).toContain(`${NARROW}data-empty:hidden`)
    expect(credit).toHaveAttribute('data-label', 'Crédit')
    expect(credit).not.toHaveAttribute('data-empty')
    expect(credit).toHaveTextContent(amount(149.75))
    expect(balance).toHaveAttribute('data-label', 'Solde')
    expect(balance).toHaveTextContent(amount(1250.5))
    // The label wraps inside the card instead of overflowing it.
    expect(screen.getByText('Loyer').className).toContain(`${NARROW}whitespace-normal`)

    const opening = screen.getByText('Report à nouveau').closest('tr')!
    const [, openingCredit] = within(opening).getAllByRole('cell').slice(-3)
    expect(openingCredit).toHaveAttribute('data-empty')
  })

  it('labels the account totals Total débit, Total crédit and Solde', () => {
    render(<GrandLivreTable data={data} />)
    const movements = screen.getByText('Mouvements du compte 512000').closest('tr')!
    const [totalDebit, totalCredit, filler] = within(movements).getAllByRole('cell').slice(-3)
    expect(totalDebit).toHaveAttribute('data-label', 'Total débit')
    expect(totalDebit).toHaveTextContent(amount(400.26))
    expect(totalCredit).toHaveAttribute('data-label', 'Total crédit')
    expect(totalCredit).toHaveTextContent(amount(149.76))
    expect(filler.className).toContain(`${NARROW}hidden`)

    const solde = screen.getByText('Solde Compte 512000').closest('tr')!
    const [debitSide, creditSide, balance] = within(solde).getAllByRole('cell').slice(-3)
    // The table keeps its debit and credit sides; the card shows the signed balance only.
    expect(debitSide.className).toContain(`${NARROW}hidden`)
    expect(creditSide.className).toContain(`${NARROW}hidden`)
    expect(balance).toHaveAttribute('data-label', 'Solde')
    expect(balance).toHaveTextContent(amount(1250.51))
  })
})
