import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { AccountSyncSwitch, canToggleSync } from '../account-sync-switch'
import { bankAccount } from './bank-account-fixture'

const norm = (text: string | null | undefined) => (text ?? '').replace(/[\u202f\u00a0]/g, ' ')

const fetchMock = vi.fn()
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('canToggleSync', () => {
  it('allows the switch on connected, current, active accounts only', () => {
    expect(canToggleSync(bankAccount())).toBe(true)
    expect(canToggleSync(bankAccount({ bankConnection: { id: 'c', provider: 'MANUAL', status: 'active' } }))).toBe(false)
    expect(canToggleSync(bankAccount({ supersededBy: { id: 'ba-9', name: 'Compte courant', provider: 'QONTO' } }))).toBe(false)
    expect(canToggleSync(bankAccount({ bankConnection: { id: 'c', provider: 'PONTO', status: 'inactive' } }))).toBe(false)
  })
})

describe('AccountSyncSwitch', () => {
  it('suspends the sync with a PUT, names the account in the toast and refreshes the page data', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(200, { id: 'ba-1', shouldSync: false }))
    const onChanged = vi.fn()
    render(<AccountSyncSwitch account={bankAccount({ displayName: 'Compte pro' })} onChanged={onChanged} />)

    const toggle = screen.getByRole('switch', { name: 'Synchroniser Compte pro' })
    expect(toggle).toBeChecked()
    await user.click(toggle)

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/banking/accounts/ba-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shouldSync: false }),
    })
    expect(toggle).not.toBeChecked()
    expect(toast.success).toHaveBeenCalledWith('Synchronisation suspendue pour Compte pro')
    expect(toggle).toBeEnabled()
  })

  it('resumes a suspended sync', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(200, {}))
    render(<AccountSyncSwitch account={bankAccount({ shouldSync: false })} onChanged={vi.fn()} />)

    await user.click(screen.getByRole('switch', { name: 'Synchroniser Compte courant' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Synchronisation reprise pour Compte courant'))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ shouldSync: true })
  })

  it('moves back and shows the API error when the server refuses', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(409, { error: 'Ce compte a été remplacé par une autre connexion.' }))
    const onChanged = vi.fn()
    render(<AccountSyncSwitch account={bankAccount()} onChanged={onChanged} />)

    const toggle = screen.getByRole('switch')
    await user.click(toggle)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Ce compte a été remplacé par une autre connexion.'))
    expect(toggle).toBeChecked()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('moves back with a French message when the network fails', async () => {
    const user = userEvent.setup()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<AccountSyncSwitch account={bankAccount()} onChanged={vi.fn()} />)

    const toggle = screen.getByRole('switch')
    await user.click(toggle)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("La synchronisation n'a pas pu être modifiée. Réessayez."))
    expect(toggle).toBeChecked()
    expect(toggle).toBeEnabled()
  })

  it('is disabled with the reason for a role that cannot manage banking', () => {
    render(
      <CompanyAccessProvider value={{ granted: { banking: ['read', 'reconcile'] }, roleLabel: 'Comptable' }}>
        <AccountSyncSwitch account={bankAccount()} onChanged={vi.fn()} />
      </CompanyAccessProvider>,
    )
    const toggle = screen.getByRole('switch')
    expect(toggle).toBeDisabled()
    expect(norm(toggle.parentElement?.getAttribute('title'))).toBe(
      'Votre rôle (Comptable) ne permet pas de suspendre ou reprendre la synchronisation : demandez-le à un administrateur de la société.',
    )
  })
})
