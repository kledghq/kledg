import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { FiscalYearsTable } from '../fiscal-years-table'

const years = [
  { id: 'fy-2025', year: 2025, closingDay: 31, closingMonth: 12, startDate: '2025-01-01', endDate: '2025-12-31', isClosed: true },
  { id: 'fy-2026', year: 2026, closingDay: 31, closingMonth: 12, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false },
]

function renderTable() {
  const handlers = { onClose: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onAllocate: vi.fn() }
  render(
    <TooltipProvider>
      <FiscalYearsTable data={years} formatDateShort={(d) => d.split('-').reverse().join('/')} {...handlers} />
    </TooltipProvider>,
  )
  return handlers
}

describe('FiscalYearsTable', () => {
  it('stacks each year below 1024px with labeled actions, the most recent first', async () => {
    const handlers = renderTable()
    const list = screen.getByRole('list', { name: 'Exercices' })
    expect(list.className).toMatch(/lg:hidden/)
    const [open, closed] = within(list).getAllByRole('listitem')
    expect(open.textContent).toMatch(/Exercice 2026/)
    expect(open.textContent).toMatch(/Du 01\/01\/2026 au 31\/12\/2026/)
    expect(open.textContent).toMatch(/Clôture le 31 décembre/)
    // Visible words instead of icon tooltips, which need a hover
    expect(within(open).getByRole('button', { name: "Modifier l'exercice 2026" }).textContent).toBe('Modifier')
    expect(within(open).getByRole('button', { name: 'Affecter le résultat 2025' }).textContent).toBe('Résultat 2025')
    await userEvent.setup().click(within(open).getByRole('button', { name: /Clôturer/ }))
    expect(handlers.onClose).toHaveBeenCalledWith('fy-2026')
    // A closed year is definitive: no action
    expect(within(closed).queryAllByRole('button')).toHaveLength(0)
    expect(within(closed).getByText('Clôturé (définitif)')).toBeInTheDocument()
  })

  it('keeps the table from 1024px, the closing date column from 1280px', () => {
    renderTable()
    const table = screen.getByRole('table')
    expect(table.closest('[data-slot="table-container"]')?.className).toMatch(/hidden lg:block/)
    expect(within(table).getByRole('columnheader', { name: 'Date de clôture' }).className).toMatch(/hidden xl:table-cell/)
    expect(within(table).getAllByRole('row')).toHaveLength(3)
  })
})
