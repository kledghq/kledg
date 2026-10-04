/**
 * Account ledger page (grand-livre d'un compte): the lines of the latest
 * open fiscal year with the running balance computed in cents, the totals
 * and the side of the balance (solde débiteur / créditeur, PCG vocabulary),
 * the fiscal year filter, editing the account and deleting a custom one
 * (a PCG account cannot be deleted). fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1', id: 'a411' }),
  useRouter: () => nav,
  usePathname: () => '/c1/accounts/a411/entries',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/features/accounting/account-combobox', () => ({
  AccountCombobox: ({ id, accounts, value, onValueChange }: { id: string; accounts: Array<{ id: string; code: string }>; value: string; onValueChange: (v: string) => void }) => (
    <select id={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">-</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.code}
        </option>
      ))}
    </select>
  ),
}))

import { toast } from 'sonner'
import AccountEntriesPage from '../page'

const entryLine = (id: string, entryNumber: string, date: string, debit: number, credit: number, description: string) => ({
  id,
  debit,
  credit,
  description,
  accountingEntry: { id: `e-${id}`, entryNumber, date, description: null, reference: null, status: 'validated', journal: { code: 'VE', label: 'Ventes' } },
})

const LEDGER = (isPCG: boolean) => ({
  account: { id: 'a411', code: '411100', label: 'Clients France', isPCG },
  // 0,10 + 0,20 - 0,30 must end at exactly 0, then 1 000,00 billed and 1 200,50 cashed
  entryLines: [
    entryLine('l1', 'VE-1', '2026-01-05', 0.1, 0, 'Facture 1'),
    entryLine('l2', 'VE-2', '2026-01-06', 0.2, 0, 'Facture 2'),
    entryLine('l3', 'BQ-1', '2026-01-07', 0, 0.3, 'Règlement 1 et 2'),
    entryLine('l4', 'VE-3', '2026-02-01', 1000, 0, 'Facture 3'),
    entryLine('l5', 'BQ-2', '2026-02-20', 0, 1200.5, 'Règlement avec avance'),
  ],
  totals: { debit: 1000.3, credit: 1200.8, balance: -200.5 },
})

let isPCG: boolean
let replies: Record<string, { status?: number; body: unknown }>
let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  isPCG = false
  replies = {}
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`
    if (replies[key]) return respond(replies[key].status ?? 200, replies[key].body)
    if (key === 'GET /api/companies/c1') {
      return respond(200, {
        fiscalYears: [
          { id: 'fy-2026', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false },
          { id: 'fy-2025', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31', isClosed: true },
        ],
      })
    }
    if (key.startsWith('GET /api/accounts/a411/entries')) return respond(200, LEDGER(isPCG))
    if (key === 'GET /api/accounts?companyId=c1') return respond(200, [])
    if (key === 'GET /api/accounts/a411') return respond(200, { id: 'a411', code: '411100', label: 'Clients France', parentId: 'a411-parent', fiscalYearId: 'fy-2026' })
    if (key === 'GET /api/accounts?companyId=c1&fiscalYearId=fy-2026') {
      return respond(200, [
        { id: 'a411-parent', code: '411', label: 'Clients', parentId: null },
        { id: 'a411', code: '411100', label: 'Clients France', parentId: 'a411-parent' },
      ])
    }
    return respond(404, { error: `unexpected ${key}` })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const urls = () => fetchMock.mock.calls.map(([input]) => String(input))

describe('account ledger page', () => {
  it('shows the lines of the open fiscal year with a running balance that never drifts', async () => {
    render(<AccountEntriesPage />)
    expect(await screen.findByRole('heading', { name: '411100 Clients France' })).toBeInTheDocument()
    expect(urls()).toContain('/api/accounts/a411/entries?fiscalYearId=fy-2026')
    const balances = screen
      .getAllByRole('row')
      .filter((row) => within(row).queryByRole('link', { name: /Voir l'écriture/ }))
      .map((row) => within(row).getAllByRole('cell')[6].textContent)
    expect(balances).toEqual(['0,10 €', '0,30 €', '0,00 €', '1 000,00 €', '-200,50 €'])
    expect(screen.getByText('5 lignes')).toBeInTheDocument()
    // The customer paid more than billed: a credit balance
    expect(screen.getByText('Solde créditeur')).toBeInTheDocument()
  })

  it('reads every fiscal year when asked', async () => {
    const user = userEvent.setup()
    render(<AccountEntriesPage />)
    await screen.findByRole('heading', { name: '411100 Clients France' })
    await user.click(screen.getByRole('combobox', { name: 'Exercice' }))
    await user.click(await screen.findByRole('option', { name: 'Tous les exercices' }))
    await waitFor(() => expect(urls()).toContain('/api/accounts/a411/entries'))
  })

  it('edits the label of the account and keeps its parent', async () => {
    replies['PATCH /api/accounts/a411'] = { body: { ok: true } }
    const user = userEvent.setup()
    render(<AccountEntriesPage />)
    await user.click(await screen.findByRole('button', { name: /Modifier/ }))
    const dialog = await screen.findByRole('dialog')
    const label = within(dialog).getByLabelText(/Libellé/)
    await user.clear(label)
    await user.type(label, 'Clients France métropolitaine')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Compte modifié'))
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ code: '411100', label: 'Clients France métropolitaine', parentId: 'a411-parent' })
  })

  it('deletes a custom account after confirmation and goes back to the chart', async () => {
    replies['DELETE /api/accounts/a411'] = { body: { ok: true } }
    const user = userEvent.setup()
    render(<AccountEntriesPage />)
    await user.click(await screen.findByRole('button', { name: /Supprimer/ }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Supprimer' }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/c1/accounts'))
  })

  it('offers no deletion for an account of the PCG', async () => {
    isPCG = true
    render(<AccountEntriesPage />)
    await screen.findByRole('heading', { name: '411100 Clients France' })
    expect(screen.queryByRole('button', { name: /Supprimer/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Personnalisé')).not.toBeInTheDocument()
  })
})
