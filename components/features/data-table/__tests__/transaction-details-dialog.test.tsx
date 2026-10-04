import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TransactionDetailsDialog } from '../transaction-details-dialog'
import type { BankTransaction } from '../transactions-types'

function tx(extra: Partial<BankTransaction> = {}): BankTransaction {
  return {
    id: 'tx-7f3a',
    amount: 1234.5,
    date: '2026-03-05T00:00:00.000Z',
    label: 'PRLV SEPA OVH',
    reference: 'FA-2026-0042',
    side: 'debit',
    reconciled: false,
    counterpartyName: 'OVH SAS',
    cashflowCategory: 'Logiciels',
    cashflowSubcategory: 'Hébergement',
    operationType: 'direct_debit',
    bankAccount: { id: 'ba', name: 'qonto-main', displayName: 'Compte principal', iban: null },
    ...extra,
  }
}

/** The value shown under a detail label. */
function detail(label: string): HTMLElement {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement
}

describe('TransactionDetailsDialog', () => {
  it('shows what the bank sent, with a signed French amount and a long French date', () => {
    render(<TransactionDetailsDialog transaction={tx()} open onOpenChange={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Détails de la transaction' })).toBeInTheDocument()
    expect(detail('Date')).toHaveTextContent('5 mars 2026')
    // A debit is money out: shown negative.
    expect(detail('Montant').textContent).toMatch(/^-1\s234,50\s€$/)
    expect(detail('Compte bancaire')).toHaveTextContent('Compte principal')
    expect(detail('Statut')).toHaveTextContent('Non rapprochée')
    expect(detail('Statut').querySelector('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'warning')
    expect(detail('Contrepartie')).toHaveTextContent('OVH SAS')
    expect(detail('Libellé')).toHaveTextContent('PRLV SEPA OVH')
    expect(detail('Référence')).toHaveTextContent('FA-2026-0042')
    expect(detail('Catégorie')).toHaveTextContent('LogicielsHébergementPrélèvement')
    expect(detail('Identifiant')).toHaveTextContent('tx-7f3a')
  })

  it('marks a credit with a plus sign and a reconciled status', () => {
    render(<TransactionDetailsDialog transaction={tx({ side: 'credit', amount: -80, reconciled: true })} open onOpenChange={vi.fn()} />)
    expect(detail('Montant').textContent).toMatch(/^\+80,00\s€$/)
    expect(detail('Statut').querySelector('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'success')
    expect(detail('Statut')).toHaveTextContent('Rapprochée')
  })

  it('says what is missing and hides empty sections', () => {
    render(
      <TransactionDetailsDialog
        transaction={tx({
          counterpartyName: null,
          label: '',
          reference: null,
          cashflowCategory: null,
          cashflowSubcategory: null,
          operationType: null,
        })}
        open
        onOpenChange={vi.fn()}
      />,
    )
    expect(detail('Contrepartie')).toHaveTextContent('Non renseignée')
    expect(detail('Libellé')).toHaveTextContent('Non renseigné')
    expect(screen.queryByText('Référence', { selector: 'dt' })).not.toBeInTheDocument()
    expect(screen.queryByText('Catégorie', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('shows the operation type alone when there is no category', () => {
    render(
      <TransactionDetailsDialog
        transaction={tx({ cashflowCategory: null, cashflowSubcategory: 'Ignored without category', operationType: 'card' })}
        open
        onOpenChange={vi.fn()}
      />,
    )
    expect(detail('Catégorie')).toHaveTextContent('Ignored without categoryCarte')
  })

  it('renders nothing without a transaction', () => {
    const { container } = render(<TransactionDetailsDialog transaction={null} open onOpenChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes with Escape', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<TransactionDetailsDialog transaction={tx()} open onOpenChange={onOpenChange} />)
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
