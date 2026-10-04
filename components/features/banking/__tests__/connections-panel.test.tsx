import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

import { ConnectionsPanel, connectionStatus } from '../connections-panel'
import type { BankConnectionRow } from '../types'

const norm = (text: string | null | undefined) => (text ?? '').replace(/[\u202f\u00a0]/g, ' ')

const account = (id: string) => ({ id, name: `Compte ${id}`, displayName: null, iban: null, supersededById: null })

function connection(over: Partial<BankConnectionRow> = {}): BankConnectionRow {
  return {
    id: 'conn-q',
    provider: 'QONTO',
    status: 'active',
    lastSyncAt: null,
    lastSyncAttemptAt: null,
    lastSyncError: null,
    lastManualSyncAt: null,
    consentExpiresAt: null,
    integration: { id: 'int-q', provider: 'QONTO', status: 'active', name: 'Qonto' },
    bankAccounts: [account('a1')],
    ...over,
  }
}

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

function renderPanel(props: Partial<React.ComponentProps<typeof ConnectionsPanel>> = {}) {
  const onChanged = vi.fn()
  render(
    <ConnectionsPanel companyId="co-1" connections={[connection()]} loading={false} canManage canRefresh onChanged={onChanged} {...props} />,
  )
  return { onChanged }
}

describe('connectionStatus', () => {
  it('names each state of a bank connection', () => {
    expect(connectionStatus(connection({ provider: 'MANUAL', integration: null }))).toEqual({ tone: 'neutral', label: 'Import de relevés' })
    expect(connectionStatus(connection({ status: 'inactive' }))).toEqual({ tone: 'neutral', label: 'Déconnectée' })
    expect(connectionStatus(connection({ integration: null }))).toEqual({ tone: 'neutral', label: 'Déconnectée' })
    expect(
      connectionStatus(connection({ integration: { id: 'i', provider: 'REVOLUT', status: 'pending', name: 'Revolut' } })),
    ).toEqual({ tone: 'warning', label: 'Autorisation à terminer' })
    expect(connectionStatus(connection({ lastSyncError: 'Jeton expiré' }))).toEqual({ tone: 'danger', label: 'Erreur de synchronisation' })
    expect(connectionStatus(connection())).toEqual({ tone: 'success', label: 'Connectée' })
  })
})

describe('ConnectionsPanel', () => {
  it('offers to connect a bank when there is none, to a role that may manage', () => {
    renderPanel({ connections: [] })
    expect(screen.getByText('Aucune connexion bancaire')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connecter une banque' })).toHaveAttribute('href', '/co-1/banking/connect')
  })

  it('shows the empty state without the action to other roles, and nothing while loading', () => {
    const { unmount } = render(
      <ConnectionsPanel companyId="co-1" connections={[]} loading={false} canManage={false} canRefresh={false} onChanged={vi.fn()} />,
    )
    expect(screen.getByText('Aucune connexion bancaire')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Connecter une banque' })).not.toBeInTheDocument()
    unmount()

    render(<ConnectionsPanel companyId="co-1" connections={[]} loading canManage canRefresh onChanged={vi.fn()} />)
    expect(screen.queryByText('Aucune connexion bancaire')).not.toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('lists each connection with its status, accounts, last sync and sync error', () => {
    renderPanel({
      connections: [
        connection({ bankAccounts: [account('a1'), account('a2')], lastSyncAt: '2026-10-03T08:15:00.000Z' }),
        connection({
          id: 'conn-p',
          provider: 'PONTO',
          integration: { id: 'int-p', provider: 'PONTO', status: 'active', name: 'Ponto' },
          lastSyncError: 'La banque a refusé la demande.',
        }),
      ],
    })
    const [qonto, ponto] = screen.getAllByRole('listitem')
    expect(within(qonto).getByText('Connectée')).toBeInTheDocument()
    expect(norm(within(qonto).getByText(/2 comptes/).textContent)).toMatch(/^2 comptes · Dernière synchronisation le /)
    // Local time for people, the exact instant for machines
    expect(qonto.querySelector('time')).toHaveAttribute('dateTime', '2026-10-03T08:15:00.000Z')

    expect(within(ponto).getByText('Erreur de synchronisation')).toBeInTheDocument()
    expect(within(ponto).getByText('La banque a refusé la demande.')).toBeInTheDocument()
    expect(within(ponto).getByText('1 compte')).toBeInTheDocument()
    expect(within(ponto).getByRole('button', { name: 'Actualiser' })).toHaveAttribute('title', 'Ponto accepte une actualisation toutes les 5 minutes')
    expect(within(qonto).getByRole('button', { name: 'Actualiser' })).not.toHaveAttribute('title')
  })

  it('refreshes a connection and says the accounts are up to date', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(200, { itemsSynced: 4, errors: [], bankRefreshRequested: false }))
    const { onChanged } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Actualiser' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/banking/connections/conn-q/refresh', { method: 'POST' })
    expect(toast.success).toHaveBeenCalledWith('Comptes à jour')
  })

  it('explains that Ponto asks the bank when a bank refresh was requested', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(200, { itemsSynced: 0, errors: [], bankRefreshRequested: true }))
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Actualiser' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(norm(vi.mocked(toast.success).mock.calls[0][0] as string)).toBe(
      "Actualisation demandée : Ponto interroge votre banque, les nouvelles opérations arrivent d'ici quelques minutes.",
    )
  })

  it('shows the first sync error of a refresh, and the API error of a refused one', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(json(200, { itemsSynced: 0, errors: ['Compte a1 : jeton expiré', 'autre'], bankRefreshRequested: false }))
      .mockResolvedValueOnce(json(429, { error: 'Trop de demandes, réessayez dans 5 minutes.' }))
    const { onChanged } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Actualiser' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Compte a1 : jeton expiré'))
    expect(onChanged).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Actualiser' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Trop de demandes, réessayez dans 5 minutes.'))
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('asks before disconnecting, then deletes the connection', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(200, { success: true }))
    const { onChanged } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Déconnecter Qonto' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Déconnecter Qonto ?')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Déconnecter' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/banking/connections/conn-q', { method: 'DELETE' })
    expect(toast.success).toHaveBeenCalledWith('Banque déconnectée')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('keeps the confirmation open with the API error when the disconnection fails', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }))
    const { onChanged } = renderPanel({
      connections: [connection({ id: 'conn-r', provider: 'REVOLUT', integration: { id: 'int-r', provider: 'REVOLUT', status: 'active', name: 'Revolut' } })],
    })

    await user.click(screen.getByRole('button', { name: 'Déconnecter Revolut Business' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Déconnecter' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('La déconnexion a échoué. Réessayez.'))
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('opens the Qonto API key dialog on the connection integration', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(json(404, {}))
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Mettre à jour la clé API' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Mettre à jour la clé API/ })).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/integrations/int-q/credentials'))

    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('links a pending Revolut authorization to its end, and offers no refresh before', () => {
    renderPanel({
      connections: [connection({ id: 'conn-r', provider: 'REVOLUT', integration: { id: 'int-r', provider: 'REVOLUT', status: 'pending', name: 'Revolut' } })],
    })
    expect(screen.getByRole('link', { name: 'Terminer la connexion' })).toHaveAttribute('href', '/co-1/banking/connect/revolut')
    expect(screen.getByText('Autorisation à terminer')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Actualiser' })).not.toBeInTheDocument()
    // A pending connection can still be disconnected
    expect(screen.getByRole('button', { name: 'Déconnecter Revolut Business' })).toBeInTheDocument()
  })

  it('gives no action on a manual account or a disconnected bank', () => {
    renderPanel({
      connections: [
        connection({ id: 'm', provider: 'MANUAL', integration: null }),
        connection({ id: 'x', status: 'inactive' }),
      ],
    })
    expect(screen.getByText('Import de relevés')).toBeInTheDocument()
    expect(screen.getByText('Déconnectée')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('hides refresh, key update and disconnect from roles without the rights', () => {
    renderPanel({ canManage: false, canRefresh: false })
    expect(screen.getByText('Connectée')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
