/**
 * Simple mode "Modifier" dialog for a meal at a company taxed at the impôt
 * sur le revenu (BOI-BNC-BASE-40-60-60): the meal question has no default,
 * offers the exploitant and the employee, and shows the split of a meal
 * alone of the exploitant before it is booked.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CategoryDialog } from '../category-dialog'
import { suggestCategory } from '@/lib/simple/suggest'
import type { ExpenseToReview } from '@/lib/simple/expenses-to-review.service'

const plain = (element: HTMLElement) => (element.textContent ?? '').replace(/[\s  ]+/g, ' ').trim()

function bistrot(mealRule: ExpenseToReview['mealRule']): ExpenseToReview {
  const label = 'CB LE PETIT BISTROT'
  return {
    id: 't1',
    date: '2026-09-25',
    side: 'debit',
    amountCents: 6_450,
    name: 'Petit Bistrot',
    label,
    suggestion: suggestCategory({ side: 'debit', amountCents: 6_450, label, counterpartyName: null, bankCategory: null }, { history: [], askMealGuests: mealRule === 'split' }),
    hasReceipt: false,
    canUploadReceipt: false,
    blockedReason: null,
    mealRule,
    mealRuleExplanation: mealRule === 'none' ? null : 'EURL : associé unique à préciser.',
  }
}

describe('CategoryDialog, meals', () => {
  it('at IR, asks who ate (no default) and shows the split of a meal alone of the exploitant', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn(async () => {})
    render(<CategoryDialog expense={bistrot('split')} onOpenChange={() => {}} onConfirm={onConfirm} onReceipt={async () => {}} initialNote="" busy={false} />)
    const confirm = screen.getByRole('button', { name: 'Classer la dépense' })
    expect(confirm).toBeDisabled()
    const question = screen.getByRole('group', { name: /Avec qui était ce repas/ })
    expect(within(question).getAllByRole('button').map((b) => b.textContent)).toEqual(['Avec des clients ou partenaires', 'Vous ou un associé, seul en déplacement', 'Un salarié, seul en déplacement'])
    await user.click(within(question).getByRole('button', { name: 'Vous ou un associé, seul en déplacement' }))
    // 64,50 € at 10 %: charge 58,64 €, of which 14,46 € deductible
    expect(plain(screen.getByTestId('meal-split'))).toContain('Déductible : 14,46 € (compte 6256), non déductible : 44,18 € (compte 62568, à réintégrer)')
    await user.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), { categoryId: 'repas-affaires', answers: { 'meal-guests': 'alone' }, note: '' })

    await user.click(within(question).getByRole('button', { name: 'Un salarié, seul en déplacement' }))
    expect(screen.queryByTestId('meal-split')).toBeNull()
  })

  it('at IS, keeps the usual two answers, the default, and no split', async () => {
    const user = userEvent.setup()
    render(<CategoryDialog expense={bistrot('none')} onOpenChange={() => {}} onConfirm={async () => {}} onReceipt={async () => {}} initialNote="" busy={false} />)
    const question = screen.getByRole('group', { name: /Avec qui était ce repas/ })
    expect(within(question).getAllByRole('button').map((b) => b.textContent)).toEqual(['Avec des clients ou partenaires', 'Seul, en déplacement'])
    expect(screen.getByRole('button', { name: 'Classer la dépense' })).toBeEnabled()
    await user.click(within(question).getByRole('button', { name: 'Seul, en déplacement' }))
    expect(screen.queryByTestId('meal-split')).toBeNull()
  })

  it('warns that nothing is split while the taxation is unknown', async () => {
    const user = userEvent.setup()
    render(<CategoryDialog expense={bistrot('unknown')} onOpenChange={() => {}} onConfirm={async () => {}} onReceipt={async () => {}} initialNote="" busy={false} />)
    await user.click(screen.getByRole('button', { name: 'Seul, en déplacement' }))
    expect(screen.getByRole('status')).toHaveTextContent('le repas reste entièrement en charge')
  })
})
