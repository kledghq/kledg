import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => search,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import RulesPage from '../page'

const rule = (id: string, name: string, enabled: boolean) => ({
  id,
  name,
  description: null,
  enabled,
  priority: 0,
  journalCode: 'BQ',
  defaultVatAccountCode: null,
  autoCreate: false,
  usageCount: 3,
  conditions: [],
  entryLines: [],
})

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/transaction-rules?')) {
      return Response.json({ rules: [rule('r1', 'Loyer', true), rule('r2', 'Frais bancaires', false)] })
    }
    if (init?.method === 'DELETE') return Response.json({ success: true })
    return Response.json([])
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  replace.mockReset()
  search = new URLSearchParams()
})

describe('Règles d’affectation page', () => {
  it('shows the status of each rule with a status badge', async () => {
    render(<RulesPage />)
    const row = (await screen.findByText('Loyer')).closest('tr') as HTMLElement
    expect(within(row).getByText('Active').closest('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'success')
    const other = screen.getByText('Frais bancaires').closest('tr') as HTMLElement
    expect(within(other).getByText('Inactive').closest('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'neutral')
  })

  it('asks in a dialog naming the rule before deleting it', async () => {
    const user = userEvent.setup()
    const nativeConfirm = vi.fn(() => true)
    vi.stubGlobal('confirm', nativeConfirm)
    render(<RulesPage />)
    await screen.findByText('Loyer')

    await user.click(screen.getByRole('button', { name: 'Autres actions sur la règle Loyer' }))
    await user.click(await screen.findByRole('menuitem', { name: /Supprimer/ }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Supprimer la règle « Loyer » ?')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/transaction-rules/r1', expect.anything())

    await user.click(within(dialog).getByRole('button', { name: 'Supprimer la règle' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/transaction-rules/r1', { method: 'DELETE' }),
    )
    expect(nativeConfirm).not.toHaveBeenCalled()
  })

  it('opens the rule pages instead of a dialog', async () => {
    render(<RulesPage />)
    expect(await screen.findByRole('link', { name: 'Loyer' })).toHaveAttribute('href', '/c1/rules/r1')
    expect(screen.getByRole('link', { name: 'Modifier la règle Loyer' })).toHaveAttribute('href', '/c1/rules/r1')
    expect(screen.getByRole('link', { name: 'Nouvelle règle' })).toHaveAttribute('href', '/c1/rules/new')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('sends a link of an earlier version with a prefill to the new rule page, prefill kept', async () => {
    search = new URLSearchParams({ fromTransaction: 'tx-1', ruleName: 'Adobe' })
    render(<RulesPage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/c1/rules/new?fromTransaction=tx-1&ruleName=Adobe'))
  })
})
