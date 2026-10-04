/**
 * Livre-journal on narrow containers: the table scrolled sideways inside its
 * card on phones. Under 56rem of container width each entry is now one card
 * on the same markup (container queries): the header row gives way to
 * data-label names, the empty side of a line disappears, and every amount is
 * still rendered once (no second card list).
 */

import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { formatAmount } from '@/components/shared'
import { JournalReportTable, type JournalReportData } from '../journal-report-table'

const data: JournalReportData = {
  journals: [
    {
      journal: { id: 'j-ac', code: 'AC', label: 'Achats' },
      entries: [
        {
          id: 'e1',
          entryNumber: '2',
          date: '2023-01-01T00:00:00.000Z',
          description: 'Facture fournisseur MARTIN',
          reference: null,
          lines: [
            { accountCode: '626000', accountLabel: 'Frais postaux', description: null, debit: 2756.58, credit: 0 },
            { accountCode: '445660', accountLabel: 'TVA déductible', description: 'TVA déductible 20 %', debit: 551.32, credit: 0 },
            { accountCode: '401000', accountLabel: 'Fournisseurs', description: null, debit: 0, credit: 3307.91 },
          ],
          totalDebit: 3307.9,
          totalCredit: 3307.96,
        },
      ],
      totals: { debit: 3307.92, credit: 3307.93 },
    },
  ],
  grandTotals: { debit: 3307.94, credit: 3307.95 },
}

const NARROW = '@max-[56rem]/ledger:'
// toHaveTextContent collapses the no-break spaces of formatAmount into plain spaces.
const amount = (value: number) => formatAmount(value).replace(/\s/g, ' ')
const amountCells = (value: number) =>
  screen.getAllByRole('cell').filter((cell) => cell.textContent === formatAmount(value))

describe('JournalReportTable', () => {
  it('renders each value once, on the same markup as the table', () => {
    render(<JournalReportTable data={data} showJournalHeaders />)
    for (const value of [2756.58, 551.32, 3307.91, 3307.9, 3307.96, 3307.92, 3307.93, 3307.94, 3307.95]) {
      expect(amountCells(value)).toHaveLength(1)
    }
    expect(screen.getAllByText('Facture fournisseur MARTIN')).toHaveLength(1)
    expect(screen.getAllByText('626000 - Frais postaux')).toHaveLength(1)
    expect(screen.getAllByText('Journal AC - Achats')).toHaveLength(1)
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(screen.getByRole('table').className).toContain(`${NARROW}block`)
  })

  it('names the amounts and hides the empty side once stacked', () => {
    render(<JournalReportTable data={data} showJournalHeaders />)
    expect(screen.getByRole('columnheader', { name: 'Débit' }).closest('thead')!.className).toContain(`${NARROW}hidden`)

    const supplier = screen.getByText('401000 - Fournisseurs').closest('tr')!
    const [debit, credit] = within(supplier).getAllByRole('cell').slice(-2)
    expect(debit).toHaveAttribute('data-label', 'Débit')
    expect(debit).toHaveAttribute('data-empty')
    expect(debit.className).toContain(`${NARROW}data-empty:hidden`)
    // The table keeps its dash on wide containers.
    expect(debit).toHaveTextContent('-')
    expect(credit).toHaveAttribute('data-label', 'Crédit')
    expect(credit).not.toHaveAttribute('data-empty')
    expect(credit).toHaveTextContent(amount(3307.91))
    expect(credit.className).toContain('before:content-[attr(data-label)]')

    // The filler cells under date, piece and journal disappear from the card.
    expect(within(supplier).getAllByRole('cell')[0].className).toContain(`${NARROW}hidden`)
  })

  it('keeps entry, journal and period totals labelled', () => {
    render(<JournalReportTable data={data} showJournalHeaders />)
    for (const [label, debit, credit] of [
      ['Total écriture 2', 3307.9, 3307.96],
      ['Total Journal AC', 3307.92, 3307.93],
      ['TOTAL GÉNÉRAL', 3307.94, 3307.95],
    ] as const) {
      const row = screen.getByText(label).closest('tr')!
      const [d, c] = within(row).getAllByRole('cell').slice(-2)
      expect(d).toHaveAttribute('data-label', 'Débit')
      expect(d).toHaveTextContent(amount(debit))
      expect(c).toHaveAttribute('data-label', 'Crédit')
      expect(c).toHaveTextContent(amount(credit))
    }
  })

  it('leaves out the journal rows for a single journal', () => {
    render(<JournalReportTable data={data} showJournalHeaders={false} />)
    expect(screen.queryByText('Journal AC - Achats')).toBeNull()
    expect(screen.queryByText('Total Journal AC')).toBeNull()
    expect(screen.getByText('TOTAL GÉNÉRAL')).toBeInTheDocument()
  })
})
