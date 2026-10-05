import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { ManualAccountDialog } from '../manual-account-dialog'
import { StatementImportDialog } from '../statement-import-dialog'

type Row = { id: string; code: string; label: string }

function mockFetch(ledger: Row[]) {
  const calls: Array<{ url: string; body?: unknown }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.startsWith('/api/accounts')) return new Response(JSON.stringify(ledger), { status: 200 })
      return new Response(JSON.stringify({ id: 'ba-1' }), { status: 201 })
    }),
  )
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('ManualAccountDialog', () => {
  it('chooses the only 512 account of a new company, so a name is enough to add the account', async () => {
    const calls = mockFetch([
      { id: 'a1', code: '512', label: 'Banques' },
      { id: 'a2', code: '601', label: 'Achats' },
    ])
    const user = userEvent.setup()
    render(<ManualAccountDialog companyId="co-1" />)
    await user.click(screen.getByRole('button', { name: 'Ajouter un compte bancaire' }))
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('512 Banques'))
    await user.type(screen.getByLabelText(/Nom du compte/), 'Compte courant')
    await user.click(screen.getByRole('button', { name: 'Ajouter le compte' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/banking/manual-accounts')).toBe(true))
    expect(calls.find((c) => c.url === '/api/banking/manual-accounts')?.body).toMatchObject({ name: 'Compte courant', ledgerAccountCode: '512' })
  })

  it('lets the user choose when the company has several 512 accounts', async () => {
    mockFetch([
      { id: 'a1', code: '512100', label: 'Banque A' },
      { id: 'a2', code: '512200', label: 'Banque B' },
    ])
    const user = userEvent.setup()
    render(<ManualAccountDialog companyId="co-1" />)
    await user.click(screen.getByRole('button', { name: 'Ajouter un compte bancaire' }))
    await user.click(screen.getByRole('button', { name: 'Ajouter le compte' }))
    expect(await screen.findByText('Choisissez le compte comptable 512 de ce compte bancaire.')).toBeTruthy()
  })
})

describe('StatementImportDialog without bank account', () => {
  it('says to add the account first instead of offering an empty list', async () => {
    const user = userEvent.setup()
    render(<StatementImportDialog companyId="co-1" accounts={[]} />)
    await user.click(screen.getByRole('button', { name: 'Importer un relevé' }))
    expect(screen.getByRole('combobox', { name: 'Compte bancaire' })).toBeDisabled()
    expect(screen.getByText(/ajoutez d’abord le compte avec .+Ajouter un compte bancaire.+puis importez son relevé/)).toBeTruthy()
  })
})
