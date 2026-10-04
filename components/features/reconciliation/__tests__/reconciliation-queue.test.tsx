import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ReconciliationQueue, signedAmount, type QueueTransaction } from '../reconciliation-queue'

const transactions: QueueTransaction[] = [
  {
    id: 't1',
    amount: 120.5,
    date: '2026-03-02T00:00:00.000Z',
    label: 'CB OFFICE DEPOT',
    side: 'debit',
    counterpartyName: 'Office Depot',
    operationType: 'card',
    matchingRules: [{ ruleId: 'r1', ruleName: 'Fournitures', matched: true }],
  },
  {
    id: 't2',
    amount: 1800,
    date: '2026-03-05T00:00:00.000Z',
    label: 'VIR SEPA CLIENT',
    side: 'credit',
    counterpartyName: null,
    operationType: 'transfer',
    status: 'pending',
  },
]

function setup() {
  const onProcess = vi.fn()
  const onApplyRule = vi.fn()
  const onPreviewAttachment = vi.fn()
  render(
    <ReconciliationQueue
      transactions={transactions}
      onProcess={onProcess}
      onApplyRule={onApplyRule}
      onPreviewAttachment={onPreviewAttachment}
    />,
  )
  return { onProcess, onApplyRule }
}

describe('ReconciliationQueue', () => {
  it('shows one dense row per transaction with French labels and neutral signed amounts', () => {
    setup()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    const first = within(rows[0])
    expect(first.getByText('Office Depot')).toBeInTheDocument()
    expect(first.getByText('Carte')).toBeInTheDocument()
    expect(first.getByText('Débit')).toBeInTheDocument()
    const amount = rows[0].querySelector('[data-slot="amount"]')
    expect(amount?.textContent).toMatch(/^-120,50/)
    expect(amount?.className).not.toMatch(/destructive|red/)
    const second = within(rows[1])
    expect(second.getByText('VIR SEPA CLIENT')).toBeInTheDocument()
    expect(second.getByText('Virement')).toBeInTheDocument()
    expect(second.getByText('En attente')).toBeInTheDocument()
    expect(rows[1].querySelector('[data-slot="amount"]')?.textContent).toMatch(/^\+1\s?800,00/)
    expect(screen.queryByText('transfer')).not.toBeInTheDocument()
    expect(screen.queryByText('card')).not.toBeInTheDocument()
  })

  it('moves between rows with the arrows or j/k and opens a row with Enter', async () => {
    const user = userEvent.setup()
    const { onProcess } = setup()
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveAttribute('tabindex', '0')
    expect(rows[1]).toHaveAttribute('tabindex', '-1')

    rows[0].focus()
    await user.keyboard('j')
    expect(rows[1]).toHaveFocus()
    expect(rows[1]).toHaveAttribute('tabindex', '0')
    await user.keyboard('{ArrowDown}')
    expect(rows[1]).toHaveFocus()
    await user.keyboard('k')
    expect(rows[0]).toHaveFocus()
    await user.keyboard('{End}')
    expect(rows[1]).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onProcess).toHaveBeenCalledWith(transactions[1])
  })

  it('keeps Enter on a row button for that button', async () => {
    const user = userEvent.setup()
    const { onProcess, onApplyRule } = setup()
    const apply = screen.getByRole('button', { name: /Fournitures/ })
    apply.focus()
    await user.keyboard('{Enter}')
    expect(onApplyRule).toHaveBeenCalledWith(transactions[0], 'r1')
    expect(onProcess).not.toHaveBeenCalled()
  })
})

describe('signedAmount', () => {
  it('is negative for money leaving the account', () => {
    expect(signedAmount({ amount: 10, side: 'debit' })).toBe(-10)
    expect(signedAmount({ amount: -10, side: 'debit' })).toBe(-10)
    expect(signedAmount({ amount: 10, side: 'credit' })).toBe(10)
  })
})
