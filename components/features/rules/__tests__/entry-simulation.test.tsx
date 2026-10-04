import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EntrySimulation, type SimulatedEntry } from '../entry-simulation'

/** Matches a French formatted amount whatever the no-break spaces are (U+202F, U+00A0). */
const amount = (text: string) => new RegExp(`^${text.replace(/ /g, '\\s')}$`)

const purchase: SimulatedEntry = {
  entryLines: [
    {
      account: { code: '626000', label: 'Frais postaux et télécommunications' },
      debit: 1000,
      credit: 0,
      description: 'Abonnement HT',
    },
    {
      account: { code: '445660', label: 'TVA déductible sur ABS' },
      debit: 200,
      credit: 0,
      description: 'TVA',
      vatInfo: { type: 'deductible', rate: 20, amount: 200 },
    },
    {
      account: { code: '445200', label: 'TVA due intracommunautaire' },
      debit: 0,
      credit: 55,
      description: 'Autoliquidation',
      vatInfo: { type: 'custom_kind', rate: 5.5, amount: 55 },
    },
    { account: { code: '512000', label: 'Banque' }, debit: 0, credit: 1145, description: 'Paiement' },
  ],
  totalDebit: 1200,
  totalCredit: 1200,
  balanced: true,
}

function rowOf(code: string): HTMLElement {
  return screen.getByText(code).closest('tr') as HTMLElement
}

describe('EntrySimulation', () => {
  it('shows each line with French amounts, the VAT detail and the totals', () => {
    render(<EntrySimulation {...purchase} />)
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Compte', 'Débit', 'Crédit', 'Libellé', 'TVA'])

    const charge = within(rowOf('626000')).getAllByRole('cell').map((c) => c.textContent)
    expect(charge[0]).toBe('626000Frais postaux et télécommunications')
    expect(charge[1]).toMatch(amount('1 000,00 €'))
    // A zero side stays empty, not "0,00 €".
    expect(charge[2]).toBe('')
    expect(charge[4]).toBe('')

    const vat = within(rowOf('445660')).getAllByRole('cell').map((c) => c.textContent)
    expect(vat[3]).toBe('TVATVA déductible 20 %')
    expect(vat[4]).toMatch(amount('200,00 €'))

    // An unknown VAT type is shown as is, with a French decimal comma.
    const other = within(rowOf('445200')).getAllByRole('cell').map((c) => c.textContent)
    expect(other[3]).toBe('Autoliquidationcustom_kind 5,5 %')
    expect(other[2]).toMatch(amount('55,00 €'))

    const total = within(screen.getByText('Total').closest('tr') as HTMLElement).getAllByRole('cell')
    expect(total[1].textContent).toMatch(amount('1 200,00 €'))
    expect(total[2].textContent).toMatch(amount('1 200,00 €'))
    expect(screen.getByRole('status')).toHaveTextContent('Écriture équilibrée')
  })

  it('computes the gap of an unbalanced entry in cents, exactly', () => {
    // 0,1 + 0,2 in floating point is 0.30000000000000004: the gap must be 0,10 EUR.
    render(
      <EntrySimulation
        entryLines={[{ account: { code: '471000', label: 'Attente' }, debit: 0.1 + 0.2, credit: 0, description: '' }]}
        totalDebit={0.1 + 0.2}
        totalCredit={0.2}
        balanced={false}
      />,
    )
    expect(screen.getByRole('status').textContent).toMatch(/^Écriture non équilibrée\s: écart de 0,10\s€$/)
  })

  it('hides the label and VAT columns in compact mode', () => {
    render(<EntrySimulation {...purchase} compact />)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Compte', 'Débit', 'Crédit'])
    expect(screen.queryByText('Frais postaux et télécommunications')).not.toBeInTheDocument()
    expect(screen.queryByText('Abonnement HT')).not.toBeInTheDocument()
  })

  it('says when there is no line to show', () => {
    render(<EntrySimulation entryLines={[]} totalDebit={0} totalCredit={0} balanced />)
    expect(screen.getByText("Aucune ligne d'écriture à afficher.")).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
