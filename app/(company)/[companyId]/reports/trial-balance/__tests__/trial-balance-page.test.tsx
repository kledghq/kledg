/**
 * Balance page: the period it asks for (latest fiscal year by default, or a
 * date range), which accounts it lists and the figures it shows. The balance
 * (PCG, titre IX, tenue des comptes) lists per account the opening balances,
 * the movements and the closing balance; in double entry its debit and credit
 * totals are equal. fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/reports/trial-balance',
}))
vi.mock('@/components/features/onboarding/reports-empty-hint', () => ({ ReportsEmptyHint: () => null }))

import TrialBalancePage from '../page'

const row = (accountId: string, code: string, label: string, values: Partial<Record<string, number>>) => ({
  accountId,
  code,
  label,
  openingDebit: 0,
  openingCredit: 0,
  movementDebit: 0,
  movementCredit: 0,
  closingDebit: 0,
  closingCredit: 0,
  debit: 0,
  credit: 0,
  balance: 0,
  ...values,
})

const TRIAL_BALANCE = {
  fiscalYear: { id: 'fy-2026', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false },
  balances: [
    // 1 000,00 brought forward, 1 200,00 cashed, 300,00 paid out
    row('a512', '512000', 'Banque', { openingDebit: 1000, movementDebit: 1200, movementCredit: 300, closingDebit: 1900, debit: 2200, credit: 300, balance: 1900 }),
    row('a101', '101000', 'Capital', { openingCredit: 1000, closingCredit: 1000, credit: 1000, balance: -1000 }),
    row('a706', '706000', 'Prestations de services', { movementCredit: 1200, closingCredit: 1200, credit: 1200, balance: -1200 }),
    row('a606', '606000', 'Achats non stockés', { movementDebit: 300, closingDebit: 300, debit: 300, balance: 300 }),
    // Cleared within the period: debit and credit net to zero, still shown
    row('a471', '471000', 'Compte d’attente', { movementDebit: 50, movementCredit: 50, debit: 50, credit: 50 }),
    // No movement at all: hidden by default
    row('a530', '530000', 'Caisse', {}),
  ],
  totals: {
    debit: 2550,
    credit: 2550,
    balance: 0,
    opening: { debit: 1000, credit: 1000 },
    movements: { debit: 1550, credit: 1550 },
    closing: { debit: 2200, credit: 2200 },
  },
  period: { startDate: '2026-01-01', endDate: '2026-12-31' },
}

let fetchMock: ReturnType<typeof vi.fn>
const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/companies/c1') {
      return respond({
        fiscalYears: [
          { id: 'fy-2025', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31' },
          { id: 'fy-2026', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' },
        ],
      })
    }
    if (url.startsWith('/api/reports/trial-balance?')) return respond(TRIAL_BALANCE)
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const trialBalanceQueries = () =>
  fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.startsWith('/api/reports/trial-balance?'))
    .map((url) => Object.fromEntries(new URL(url, 'http://localhost').searchParams))

async function table() {
  return within(await screen.findByRole('table'))
}
const codes = (t: ReturnType<typeof within>): string[] =>
  t
    .getAllByRole('row')
    .slice(1)
    .map((r: HTMLElement) => r.querySelector('td')?.textContent ?? '')
    .filter((text: string) => /^\d+$/.test(text))

describe('trial balance page', () => {
  it('asks for the latest fiscal year by default', async () => {
    render(<TrialBalancePage />)
    await waitFor(() => expect(trialBalanceQueries()).toContainEqual({ companyId: 'c1', fiscalYearId: 'fy-2026' }))
  })

  it('lists the accounts with activity, cleared accounts included, and the equal totals', async () => {
    render(<TrialBalancePage />)
    const t = await table()
    expect(codes(t)).toEqual(['512000', '101000', '706000', '606000', '471000'])
    const bank = t.getByText('512000').closest('tr') as HTMLElement
    expect(within(bank).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      '512000',
      'Banque',
      '1 000,00 €',
      '-',
      '1 200,00 €',
      '300,00 €',
      '1 900,00 €',
      '-',
    ])
    const total = t.getByText('TOTAL').closest('tr') as HTMLElement
    expect(within(total).getAllByRole('cell').slice(-2).map((cell) => cell.textContent)).toEqual(['2 200,00 €', '2 200,00 €'])
  })

  it('shows the accounts without movement on request, and filters by number or label', async () => {
    const user = userEvent.setup()
    render(<TrialBalancePage />)
    const t = await table()
    await user.click(screen.getByRole('switch', { name: /Afficher les comptes sans mouvement/ }))
    expect(codes(t)).toContain('530000')

    await user.type(screen.getByLabelText('Rechercher'), 'prestations')
    expect(codes(t)).toEqual(['706000'])
    await user.clear(screen.getByLabelText('Rechercher'))
    await user.type(screen.getByLabelText('Rechercher'), '6060')
    expect(codes(t)).toEqual(['606000'])
  })

  it('asks for a date range instead of the fiscal year in custom period mode', async () => {
    const user = userEvent.setup()
    render(<TrialBalancePage />)
    await table()
    await user.click(screen.getByLabelText('Période personnalisée'))
    const start = screen.getByLabelText('Date de début')
    await user.clear(start)
    await user.type(start, '2026-03-01')
    const end = screen.getByLabelText('Date de fin')
    await user.clear(end)
    await user.type(end, '2026-03-31')
    await waitFor(() =>
      expect(trialBalanceQueries()).toContainEqual({ companyId: 'c1', startDate: '2026-03-01', endDate: '2026-03-31' }),
    )
  })
})
