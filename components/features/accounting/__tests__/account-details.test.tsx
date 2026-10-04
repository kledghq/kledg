import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AccountDetails } from '../account-details'

vi.mock('next/navigation', () => ({ useParams: () => ({ companyId: 'c1' }) }))
vi.mock('../account-balance-evolution-chart', () => ({ AccountBalanceEvolutionChart: () => null }))

const data = {
  account: { id: 'a1', code: '512000', label: 'Banque' },
  entryLines: [
    {
      id: 'l1',
      debit: 1200,
      credit: 0,
      description: 'Virement client',
      accountingEntry: { id: 'e1', entryNumber: '7', date: '2026-02-03T00:00:00.000Z', description: null, reference: null, journal: { code: 'BQ', label: 'Banque' } },
    },
    {
      id: 'l2',
      debit: 0,
      credit: 200,
      description: null,
      accountingEntry: { id: 'e2', entryNumber: '9', date: '2026-02-10T00:00:00.000Z', description: 'Loyer', reference: null, journal: { code: 'BQ', label: 'Banque' } },
    },
  ],
  totals: { debit: 1200, credit: 200, balance: 1000 },
}

describe('AccountDetails latest lines', () => {
  afterEach(() => vi.unstubAllGlobals())

  // Under 56rem of container width each line is a card (container queries on
  // the same markup): the empty side disappears and the amounts are named by
  // their data-label, so the card says what the table header said.
  it('names each amount for the stacked card and hides the empty side', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/entries') ? data : []), { status: 200 })),
    )
    render(<AccountDetails accountId="a1" />)

    const loyer = (await screen.findByText('Loyer')).closest('tr')!
    expect(loyer.closest('[class*="@container/ledger"]')).not.toBeNull()
    const cells = within(loyer).getAllByRole('cell')
    const [debit, credit, balance] = cells.slice(-3)
    expect(debit).toHaveAttribute('data-label', 'Débit')
    expect(debit).toBeEmptyDOMElement()
    expect(debit.className).toContain('@max-[56rem]/ledger:empty:hidden')
    expect(credit).toHaveAttribute('data-label', 'Crédit')
    expect(credit).toHaveTextContent('200,00 €')
    expect(balance).toHaveAttribute('data-label', 'Solde')
    expect(balance).toHaveTextContent('1 000,00 €')
    // The header row gives way to the labels on narrow containers
    expect(screen.getByRole('columnheader', { name: 'Solde' }).closest('thead')!.className).toContain('@max-[56rem]/ledger:hidden')
  })
})
