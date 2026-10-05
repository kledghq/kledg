/**
 * Expense report editor: the totals (charges, recoverable VAT per rate,
 * amount owed) and the outcome of each line follow the lines as they are
 * typed, computed with the server's rules (lib/expense-reports/amounts.ts:
 * no VAT recovered on passenger transport, CGI ann. II art. 206, IV, 2, 5°;
 * mileage by the scale of the year); the editor sends cents and basis
 * points and never a total. Lines are cards stacked on phones.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const router = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { ExpenseReportEditor, emptyExpenseLine, type ExpenseFormValues } from '../expense-report-editor'
import { ExpenseTotals } from '../expense-totals'

/** Text of an element with every kind of space made plain, for amounts formatted with narrow no-break spaces. */
const plain = (element: HTMLElement) => (element.textContent ?? '').replace(/[\s  ]+/g, ' ').trim()

const initial = (lines: ExpenseFormValues['lines']): ExpenseFormValues => ({ claimantId: '', label: '', periodStart: '2026-03-01', periodEnd: '2026-03-31', lines })

describe('ExpenseTotals', () => {
  it('shows the charges, the recoverable VAT per rate and what the company owes', () => {
    render(<ExpenseTotals totals={{ totalInclTaxCents: 26_160, recoverableVatCents: 1_400, totalExpenseCents: 24_760, vatByRate: [{ vatRateBp: 2000, recoverableVatCents: 400 }, { vatRateBp: 1000, recoverableVatCents: 1_000 }] }} />)
    expect(plain(screen.getByTestId('total-expense'))).toBe('247,60 €')
    expect(plain(screen.getByTestId('total-vat'))).toBe('14,00 €')
    expect(plain(screen.getByTestId('total-owed'))).toBe('261,60 €')
    expect(screen.getByText(/TVA récupérable 20/)).toBeInTheDocument()
  })
})

describe('ExpenseReportEditor', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/expense-category-rules')) return new Response(JSON.stringify({ rules: [{ id: 'r1', keyword: 'sncf', category: 'TRANSPORT', accountCode: null, priority: 0 }] }))
      if (url === '/api/expense-reports' && init?.method === 'POST') return new Response(JSON.stringify({ id: 'ndf-1' }), { status: 201 })
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('updates the totals and the VAT recovered on each line as amounts are typed', async () => {
    const user = userEvent.setup()
    render(<ExpenseReportEditor companyId="c1" canManage={false} initial={initial([{ ...emptyExpenseLine('EXPENSE', '2026-03-10'), category: 'RECEPTION', receiptKind: 'INVOICE', vatRateBp: '1000' }])} />)
    await user.type(screen.getByLabelText(/Montant payé TTC/), '110')
    // 110 € at 10 %: 10 € of VAT, recovered with an invoice
    await waitFor(() => expect(plain(screen.getByTestId('total-owed'))).toBe('110,00 €'))
    expect(plain(screen.getByTestId('total-vat'))).toBe('10,00 €')
    expect(plain(screen.getByTestId('total-expense'))).toBe('100,00 €')
    expect(plain(screen.getByTestId('line-outcome'))).toBe('TVA récupérable : 10,00 €')
  })

  it('recovers nothing on a train ticket, pays a trip by the scale, and stacks each line as a card', async () => {
    const user = userEvent.setup()
    render(
      <ExpenseReportEditor
        companyId="c1"
        canManage={false}
        initial={initial([
          { ...emptyExpenseLine('EXPENSE', '2026-03-10'), label: 'Paris, Lyon', supplierName: 'SNCF', category: 'TRANSPORT', receiptKind: 'INVOICE', vatRateBp: '1000', amountInclTaxCents: 8_800 },
          { ...emptyExpenseLine('MILEAGE', '2026-03-12'), label: 'Lyon, Grenoble', fiscalPower: '5', distanceKm: '100' },
        ])}
        mileageBaselines={{ '2026:CAR:5:t': 4_900 }}
      />,
    )
    const lines = screen.getAllByTestId('expense-line')
    expect(lines).toHaveLength(2)
    // One card per line: a single column on phones, a grid from the tablet up
    expect(lines[0].className).toContain('sm:grid-cols-2')
    expect(lines[0].className).toContain('lg:grid-cols-12')
    expect(plain(within(lines[0]).getByTestId('line-outcome'))).toMatch(/Transport de personnes : TVA non récupérable .* : 0,00 €/)
    // 4 900 km already counted, 100 km more stay in the first band (5 000 km): 100 x 0,636 = 63,60 €
    expect(plain(within(lines[1]).getByTestId('line-outcome'))).toBe('Indemnité 63,60 €, barème 2026, 5 CV, 4900 km déjà comptés dans l’année')
    expect(plain(screen.getByTestId('total-owed'))).toBe('151,60 €')
    expect(plain(screen.getByTestId('total-vat'))).toBe('0,00 €')

    const distance = within(lines[1]).getByLabelText(/Distance/)
    await user.clear(distance)
    await user.type(distance, '300')
    // 4 900 + 300 km crosses 5 000 km: (5200 x 0,357 + 1395) - 4900 x 0,636 = 135,00 €
    await waitFor(() => expect(plain(screen.getByTestId('total-owed'))).toBe('223,00 €'))
  })

  it('sends cents and basis points, never a total, and opens the saved report', async () => {
    const user = userEvent.setup()
    render(
      <ExpenseReportEditor
        companyId="c1"
        canManage={false}
        initial={initial([{ ...emptyExpenseLine('EXPENSE', '2026-03-10'), label: 'Stylos', category: 'SUPPLIES', receiptKind: 'RECEIPT', vatRateBp: '2000', amountInclTaxCents: 2_400 }])}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Enregistrer la note de frais' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/c1/expense-reports/ndf-1'))
    const [, init] = fetchMock.mock.calls.find(([url, options]) => url === '/api/expense-reports' && options?.method === 'POST') as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ companyId: 'c1', periodStart: '2026-03-01', periodEnd: '2026-03-31' })
    expect(body.lines).toEqual([
      { kind: 'EXPENSE', date: '2026-03-10', supplierName: null, label: 'Stylos', category: 'SUPPLIES', accountCode: null, amountInclTaxCents: 2_400, vatRateBp: 2000, vatCents: null, receiptKind: 'RECEIPT', receiptAttachmentId: null, receiptReference: null, mealTaker: null },
    ])
    expect(body.totalInclTax).toBeUndefined()
  })

  it('says what to fix before sending', async () => {
    const user = userEvent.setup()
    render(<ExpenseReportEditor companyId="c1" canManage={false} initial={initial([emptyExpenseLine('EXPENSE', '2026-03-10'), emptyExpenseLine('MILEAGE', '2026-03-12')])} />)
    await user.click(screen.getByRole('button', { name: 'Enregistrer la note de frais' }))
    expect(await screen.findByText('Montant payé requis')).toBeInTheDocument()
    expect(screen.getByText('Distance en kilomètres entiers')).toBeInTheDocument()
    expect(screen.getByText('Puissance fiscale requise')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/expense-reports', expect.anything())
  })
})

describe('ExpenseReportEditor, meals of the exploitant at a company taxed at IR (BOI-BNC-BASE-40-60-60)', () => {
  const fetchMock = vi.fn()
  const view = (role: 'exploitant' | 'other' | 'unknown', applies = true) => ({
    day: '2026-03-31',
    company: { applies, unknown: false, explanation: 'EURL dont l’associé unique est une personne physique' },
    claimant: { role, explanation: role === 'other' ? 'Salarié\u00a0: ses frais de repas restent déductibles.' : 'à préciser' },
  })
  const mealLine = { ...emptyExpenseLine('EXPENSE', '2026-03-10'), label: 'Déjeuner seul', category: 'MEALS', receiptKind: 'INVOICE' as const, vatRateBp: '1000', amountInclTaxCents: 2_500 }

  function serve(rule: ReturnType<typeof view>) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/expense-category-rules')) return new Response(JSON.stringify({ rules: [] }))
      if (url.startsWith('/api/expense-reports/meal-rule')) return new Response(JSON.stringify(rule))
      if (url === '/api/expense-reports' && init?.method === 'POST') return new Response(JSON.stringify({ id: 'ndf-1' }), { status: 201 })
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
  }
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('shows the deductible and non-deductible parts of a meal alone of the associé, with the 2026 thresholds and the source', async () => {
    serve(view('exploitant'))
    render(<ExpenseReportEditor companyId="c1" canManage={false} initial={initial([mealLine])} />)
    const split = await screen.findByTestId('meal-split')
    // 25 € at 10 %: charge 22,73 €, of which 14,46 € deductible and 8,27 € on 62568
    expect(plain(split)).toContain('Déductible : 14,46 € (compte 6256), non déductible : 8,27 € (compte 62568, à réintégrer)')
    expect(plain(split)).toContain('au-delà de 5,50 € (repas pris au domicile) et jusqu’à 21,40 € TTC, soit 15,90 € au plus par repas')
    expect(within(split).getByRole('link')).toHaveAttribute('href', expect.stringContaining('BOI-BNC-BASE-40-60-60-20260218'))
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/meal-rule\?companyId=c1&day=2026-03-31/))
  })

  it('asks who took the meal when the claimant does not say it, and sends the answer', async () => {
    serve(view('unknown'))
    const user = userEvent.setup()
    render(<ExpenseReportEditor companyId="c1" canManage={false} initial={initial([mealLine])} />)
    expect(await screen.findByText(/indiquez sur chaque repas|à préciser/)).toBeInTheDocument()
    await user.click(screen.getByLabelText(/Qui a pris ce repas/))
    await user.click(await screen.findByRole('option', { name: 'L’exploitant ou un associé' }))
    expect(await screen.findByTestId('meal-split')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enregistrer la note de frais' }))
    await waitFor(() => expect(router.push).toHaveBeenCalled())
    const post = fetchMock.mock.calls.find(([url, init]) => url === '/api/expense-reports' && init?.method === 'POST')!
    expect(JSON.parse(post[1].body as string).lines[0]).toMatchObject({ category: 'MEALS', mealTaker: 'EXPLOITANT' })
  })

  it('shows nothing for a company at IS, and keeps an employee’s meal whole', async () => {
    serve(view('exploitant', false))
    const { unmount } = render(<ExpenseReportEditor companyId="c1" canManage={false} initial={initial([mealLine])} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/meal-rule/)))
    expect(screen.queryByTestId('meal-split')).toBeNull()
    expect(screen.queryByTestId('meal-note')).toBeNull()
    unmount()
    serve(view('other'))
    render(<ExpenseReportEditor companyId="c1" canManage={false} initial={initial([mealLine])} />)
    expect(plain(await screen.findByTestId('meal-note'))).toContain('restent déductibles')
    expect(screen.queryByTestId('meal-split')).toBeNull()
  })
})
