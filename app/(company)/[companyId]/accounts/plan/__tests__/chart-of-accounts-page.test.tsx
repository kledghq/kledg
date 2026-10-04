/**
 * Plan comptable page: the account tree (classes first, sorted by number,
 * search that opens the parents of what it finds) and the creation of a
 * sub-account under a parent. PCG art. 932-1: the chart is organised in
 * classes, and a sub-account number starts with the number of the account it
 * details. fetch is mocked; the requests the page sends are asserted.
 */

import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/accounts/plan',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// The fiscal year selector picks the open year on mount
vi.mock('@/components/features/accounting/fiscal-year-selector', () => ({
  FiscalYearSelector: ({ onValueChange }: { onValueChange: (id: string) => void }) => {
    useEffect(() => onValueChange('fy-2026'), [onValueChange])
    return null
  },
}))
// A plain select stands in for the searchable combobox
vi.mock('@/components/features/accounting/account-combobox', () => ({
  AccountCombobox: ({
    id,
    accounts,
    value,
    onValueChange,
  }: {
    id: string
    accounts: Array<{ id: string; code: string; label: string }>
    value: string
    onValueChange: (value: string) => void
  }) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">-</option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>{`${account.code} ${account.label}`}</option>
      ))}
    </select>
  ),
}))

import { toast } from 'sonner'
import ChartOfAccountsPage from '../page'

const ACCOUNTS = [
  { id: 'a5', code: '5', label: 'Comptes financiers', parentId: null, isPCG: true },
  { id: 'a4', code: '4', label: 'Comptes de tiers', parentId: null, isPCG: true },
  { id: 'a41', code: '41', label: 'Clients et comptes rattachés', parentId: 'a4', isPCG: true },
  { id: 'a411', code: '411', label: 'Clients', parentId: 'a41', isPCG: true },
  { id: 'a40', code: '40', label: 'Fournisseurs et comptes rattachés', parentId: 'a4', isPCG: true },
  { id: 'a51', code: '51', label: 'Banques, établissements financiers', parentId: 'a5', isPCG: true },
  { id: 'a512', code: '512', label: 'Banques', parentId: 'a51', isPCG: true },
  { id: 'a5121', code: '512100', label: 'Banque Qonto', parentId: 'a512', isPCG: false },
]

let existingCodes: string[]
let fetchMock: ReturnType<typeof vi.fn>

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  existingCodes = ['411']
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url.pathname === '/api/accounts') return respond(200, ACCOUNTS)
    if (method === 'GET' && url.pathname === '/api/accounts/check-exists') {
      return respond(200, { exists: existingCodes.includes(url.searchParams.get('code') ?? '') })
    }
    if (method === 'POST' && url.pathname === '/api/accounts') {
      const body = JSON.parse(String(init?.body)) as { code: string; label: string; parentId: string }
      return respond(201, { id: 'new', isPCG: false, ...body })
    }
    return respond(404, { error: `unexpected ${method} ${url.pathname}` })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/** Account numbers of the visible rows (account rows link to the account ledger). */
const accountCodes = () =>
  screen
    .queryAllByRole('link')
    .filter((link) => link.getAttribute('href')?.endsWith('/entries'))
    .map((link) => link.textContent?.match(/^\d+/)?.[0])
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')

describe('chart of accounts page: tree', () => {
  it('lists the accounts of the selected year, classes open and sorted by number', async () => {
    render(<ChartOfAccountsPage />)
    await waitFor(() => expect(accountCodes()).toEqual(['4', '40', '41', '5', '51']))
    expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/accounts?companyId=c1&fiscalYearId=fy-2026')).toBe(true)
  })

  it('finds an account by label and opens its parents, hiding the branches without a match', async () => {
    const user = userEvent.setup()
    render(<ChartOfAccountsPage />)
    await waitFor(() => expect(accountCodes()).toContain('51'))
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher un compte' }), 'qonto')
    await waitFor(() => expect(accountCodes()).toEqual(['5', '51', '512', '512100']))
    // A custom account (not in the PCG) is marked as such
    expect(screen.getByRole('link', { name: /Banque Qonto/ })).toHaveTextContent('Personnalisé')
  })
})

describe('chart of accounts page: creating a sub-account', () => {
  async function openDialog() {
    const user = userEvent.setup()
    render(<ChartOfAccountsPage />)
    await waitFor(() => expect(accountCodes()).toContain('41'))
    await user.click(screen.getByRole('button', { name: /Créer un compte/ }))
    const dialog = await screen.findByRole('dialog')
    return { user, dialog }
  }

  it('prefills the parent number and sends the new account for the selected year', async () => {
    const { user, dialog } = await openDialog()
    await user.selectOptions(within(dialog).getByLabelText(/Compte parent/), 'a41')
    const code = within(dialog).getByLabelText(/Code/)
    expect(code).toHaveValue('41')
    await user.type(code, '1100')
    await user.type(within(dialog).getByLabelText(/Libellé/), 'Clients France')
    // Let the debounced existence check answer before submitting
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/accounts/check-exists?code=411100'))).toBe(true),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Créer le compte' }))

    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({
      code: '411100',
      label: 'Clients France',
      parentId: 'a41',
      companyId: 'c1',
      fiscalYearId: 'fy-2026',
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Compte créé avec succès'))
  })

  it('refuses a number that does not start with the parent number', async () => {
    const { user, dialog } = await openDialog()
    await user.selectOptions(within(dialog).getByLabelText(/Compte parent/), 'a41')
    const code = within(dialog).getByLabelText(/Code/)
    await user.clear(code)
    await user.type(code, '401100')
    await user.type(within(dialog).getByLabelText(/Libellé/), 'Fournisseur')
    await user.click(within(dialog).getByRole('button', { name: 'Créer le compte' }))

    expect(await within(dialog).findByText('Le code du compte enfant doit commencer par le code du parent (41)')).toBeInTheDocument()
    expect(posts()).toHaveLength(0)
  })

  it('refuses a number that already exists in the year', async () => {
    const { user, dialog } = await openDialog()
    await user.selectOptions(within(dialog).getByLabelText(/Compte parent/), 'a41')
    await user.type(within(dialog).getByLabelText(/Code/), '1')
    await user.type(within(dialog).getByLabelText(/Libellé/), 'Clients')
    expect(await within(dialog).findByText('Un compte avec ce numéro existe déjà', {}, { timeout: 2000 })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Créer le compte' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Un compte avec ce numéro existe déjà'))
    expect(posts()).toHaveLength(0)
  })

  it('checks the number format before anything else (2 to 8 digits)', async () => {
    const { user, dialog } = await openDialog()
    await user.selectOptions(within(dialog).getByLabelText(/Compte parent/), 'a41')
    const code = within(dialog).getByLabelText(/Code/)
    await user.type(code, '1A')
    await user.type(within(dialog).getByLabelText(/Libellé/), 'Clients')
    await user.click(within(dialog).getByRole('button', { name: 'Créer le compte' }))
    expect(await within(dialog).findByText('Le code doit contenir entre 2 et 8 chiffres')).toBeInTheDocument()
    expect(posts()).toHaveLength(0)
  })
})
