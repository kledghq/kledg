/**
 * Budget page: "Suivi" (the comparison with the books) and "Saisie" (the
 * lines) are stacked sections, both visible, no tabs
 * (docs/design-system.md). Creating a budget brings its lines into view.
 * The comparison is built by the real pure module (lib/budgets/report.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { BudgetPage } from '../budget-page'
import { buildBudgetComparison } from '@/lib/budgets/report'
import type { BudgetDetail } from '@/lib/budgets/manage-budgets.service'
import type { BudgetReport } from '@/lib/budgets/get-budget-report.service'

const FISCAL_YEAR = { id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }
const FISCAL_YEARS = [{ ...FISCAL_YEAR, startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-12-31T00:00:00.000Z' }]
const MONTHS = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`)
const planned = MONTHS.map(() => 10_000)
const DETAIL: BudgetDetail = {
  id: 'b1',
  fiscalYear: FISCAL_YEAR,
  lineCount: 1,
  chargesCents: 120_000,
  produitsCents: 0,
  resultatCents: -120_000,
  months: MONTHS,
  editable: true,
  lines: [{ id: 'l1', accountPrefix: '6061', label: 'Fournitures', side: 'charges', amounts: [], recurringItems: [], plannedMonths: planned, annualCents: 120_000 }],
}
const REPORT: BudgetReport = {
  budgetId: 'b1',
  fiscalYear: FISCAL_YEAR,
  ...buildBudgetComparison({ months: MONTHS, lines: [{ id: 'l1', accountPrefix: '6061', label: 'Fournitures', months: planned }], accounts: [] }),
}

describe('BudgetPage', () => {
  let created = true
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/companies/acme/fiscal-years')) return new Response(JSON.stringify(FISCAL_YEARS), { status: 200 })
    if (init?.method === 'POST' && url === '/api/budgets') {
      created = true
      return new Response(JSON.stringify(DETAIL), { status: 201 })
    }
    if (url.startsWith('/api/budgets?')) return new Response(JSON.stringify({ items: created ? [DETAIL] : [] }), { status: 200 })
    if (url.startsWith('/api/budgets/b1/report')) return new Response(JSON.stringify(REPORT), { status: 200 })
    if (url === '/api/budgets/b1') return new Response(JSON.stringify(DETAIL), { status: 200 })
    return new Response(JSON.stringify({ error: 'inattendu' }), { status: 500 })
  })

  beforeEach(() => {
    created = true
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('shows Suivi and Saisie one under the other, with no tabs', async () => {
    render(<BudgetPage companyId="acme" />)
    const suivi = await screen.findByRole('region', { name: 'Suivi' })
    const saisie = screen.getByRole('region', { name: 'Saisie' })
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(suivi.compareDocumentPosition(saisie) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(saisie).getByText('Lignes du budget')).toBeVisible()
    expect(within(saisie).getAllByText('Fournitures')[0]).toBeVisible()
    expect(within(suivi).getAllByText(/Fournitures/).length).toBeGreaterThan(0)
  })

  it('brings the lines into view after creating the budget', async () => {
    created = false
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const user = userEvent.setup()
    render(<BudgetPage companyId="acme" />)
    await user.click(await screen.findByRole('button', { name: 'Créer le budget' }))
    const saisie = await screen.findByRole('region', { name: 'Saisie' })
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect(scrollIntoView.mock.contexts[0]).toBe(saisie)
  })
})
