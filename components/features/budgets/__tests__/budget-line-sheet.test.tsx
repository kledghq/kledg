/**
 * Line editor of a budget: an annual amount spread over the months of the
 * fiscal year with the remainder on the last month, the total following
 * recurring items as they are typed (lib/budgets/recurring.ts), and the
 * request sending cents per month (zero months left out) and the recurring
 * items, never a total.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { toast } from 'sonner'
import { BudgetLineSheet } from '../budget-line-sheet'
import type { BudgetLineView } from '@/lib/budgets/manage-budgets.service'

const MONTHS = ['2026-01', '2026-02', '2026-03']
const plain = (text: string | null) => (text ?? '').replace(/[\s  ]+/g, ' ').trim()

describe('BudgetLineSheet', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ id: 'l1' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('spreads an annual amount over the months and creates the line in cents', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(<BudgetLineSheet open onOpenChange={vi.fn()} budgetId="b1" months={MONTHS} line={null} onSaved={onSaved} />)

    await user.type(screen.getByPlaceholderText('ex. 6226'), '6226')
    await user.type(screen.getByLabelText('Montant annuel'), '1000')
    await user.click(screen.getByRole('button', { name: 'Répartir' }))
    // 1 000 € over 3 months: 333,33 twice, 333,34 on the last month
    await waitFor(() => expect(plain(screen.getByText(/Total de l.exercice/).textContent)).toBe("Total de l'exercice : 1 000,00 €"))

    await user.click(screen.getByRole('button', { name: 'Enregistrer la ligne' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/budgets/b1/lines')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      accountPrefix: '6226',
      label: null,
      amounts: [
        { month: '2026-01', amountCents: 33_333 },
        { month: '2026-02', amountCents: 33_333 },
        { month: '2026-03', amountCents: 33_334 },
      ],
      recurringItems: [],
    })
    expect(onSaved).toHaveBeenCalled()
  })

  it('adds recurring items to the total and patches an existing line', async () => {
    const user = userEvent.setup()
    const line: BudgetLineView = {
      id: 'l9',
      accountPrefix: '613',
      label: 'Locations',
      side: 'charges',
      amounts: [{ month: '2026-02', amountCents: 5_000 }],
      recurringItems: [{ id: 'r1', label: 'Loyer', amountCents: 80_000, frequency: 'MONTHLY', startMonth: '2026-01', endMonth: null }],
      plannedMonths: [80_000, 85_000, 80_000],
      annualCents: 245_000,
    }
    render(<BudgetLineSheet open onOpenChange={vi.fn()} budgetId="b1" months={MONTHS} line={line} onSaved={vi.fn()} />)
    expect(plain(screen.getByText(/Total de l.exercice/).textContent)).toContain('2 450,00 €')

    await user.click(screen.getByRole('button', { name: 'Ajouter' }))
    const labels = screen.getAllByPlaceholderText('ex. Logiciel de paie')
    await user.type(labels[1], 'Assurance')
    await user.click(screen.getByRole('button', { name: 'Enregistrer la ligne' }))
    // The new item has no amount yet: refused before any request
    expect(await screen.findByText('Le montant est requis')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    const amounts = screen.getAllByLabelText(/^Montant/).filter((el) => el.id.startsWith('budget-item-'))
    await user.type(amounts[1], '300')
    await waitFor(() => expect(plain(screen.getByText(/Total de l.exercice/).textContent)).toContain('3 350,00 €'))
    await user.click(screen.getByRole('button', { name: 'Enregistrer la ligne' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/budget-lines/l9')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string).recurringItems).toEqual([
      { label: 'Loyer', amountCents: 80_000, frequency: 'MONTHLY', startMonth: '2026-01', endMonth: null },
      { label: 'Assurance', amountCents: 30_000, frequency: 'MONTHLY', startMonth: '2026-01', endMonth: null },
    ])
  })

  it('shows the French message of a refused line', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: 'Le budget a déjà une ligne sur le compte 706 : modifiez-la.' }), { status: 409 }))
    const user = userEvent.setup()
    render(<BudgetLineSheet open onOpenChange={vi.fn()} budgetId="b1" months={MONTHS} line={null} onSaved={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('ex. 6226'), '706')
    await user.click(screen.getByRole('button', { name: 'Enregistrer la ligne' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Le budget a déjà une ligne sur le compte 706 : modifiez-la.'))
  })
})
