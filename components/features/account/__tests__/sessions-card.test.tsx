import { createRef } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountSession } from '@/lib/account/sessions.service'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { SessionsCard, type SessionsCardHandle } from '../sessions-card'

const current: AccountSession = {
  id: 's-current',
  device: 'Firefox sur macOS',
  ipAddress: '203.0.113.7',
  createdAt: '2026-09-01T10:00:00.000Z',
  lastActiveAt: '2026-10-03T10:00:00.000Z',
  current: true,
}
const phone: AccountSession = {
  id: 's/phone',
  device: 'Safari sur iPhone',
  ipAddress: null,
  createdAt: '2026-08-15T10:00:00.000Z',
  lastActiveAt: '2026-10-02T10:00:00.000Z',
  current: false,
}
const laptop: AccountSession = { ...phone, id: 's-laptop', device: 'Chrome sur Windows', ipAddress: '198.51.100.2' }

let sessions: AccountSession[]
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  sessions = [current, phone, laptop]
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    if (init?.method === 'DELETE' && url === '/api/account/sessions') {
      sessions = sessions.filter((s) => s.current)
      return new Response(null, { status: 204 })
    }
    if (init?.method === 'DELETE') {
      const id = decodeURIComponent(url.split('/').pop()!)
      sessions = sessions.filter((s) => s.id !== id)
      return new Response(null, { status: 204 })
    }
    return Response.json(sessions)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

const deleteCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) => String(url))

describe('SessionsCard', () => {
  it('shows a loading list, then each session with the current one marked and no button on it', async () => {
    render(<SessionsCard />)
    expect(screen.getByLabelText('Chargement des sessions')).toHaveAttribute('aria-busy', 'true')
    const row = (await screen.findByText('Firefox sur macOS')).closest('li')!
    expect(within(row).getByText('Cette session')).toBeInTheDocument()
    expect(row).toHaveTextContent('IP 203.0.113.7')
    expect(row).toHaveTextContent('connectée le 1 septembre 2026')
    expect(within(row).queryByRole('button')).toBeNull()
    expect(screen.getByText('Safari sur iPhone').closest('li')).not.toHaveTextContent('IP')
    expect(screen.getByRole('button', { name: 'Déconnecter la session Safari sur iPhone' })).toBeEnabled()
  })

  it('asks before signing out one session, then deletes it by its encoded id and reloads', async () => {
    const user = userEvent.setup()
    render(<SessionsCard />)
    await user.click(await screen.findByRole('button', { name: 'Déconnecter la session Safari sur iPhone' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Déconnecter la session Safari sur iPhone ?')).toBeInTheDocument()
    expect(deleteCalls()).toEqual([])

    await user.click(within(dialog).getByRole('button', { name: 'Déconnecter' }))
    await waitFor(() => expect(screen.queryByText('Safari sur iPhone')).toBeNull())
    expect(deleteCalls()).toEqual(['/api/account/sessions/s%2Fphone'])
    expect(toast.success).toHaveBeenCalledWith('Session déconnectée')
  })

  it('does nothing when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    render(<SessionsCard />)
    await user.click(await screen.findByRole('button', { name: 'Déconnecter la session Chrome sur Windows' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(deleteCalls()).toEqual([])
    expect(screen.getByText('Chrome sur Windows')).toBeInTheDocument()
  })

  it('signs out every other session after confirming how many will close', async () => {
    const user = userEvent.setup()
    render(<SessionsCard />)
    await screen.findByText('Firefox sur macOS')
    await user.click(screen.getByRole('button', { name: 'Déconnecter les autres sessions' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent("2 sessions sur d'autres navigateurs ou appareils seront fermées. Cette session reste ouverte.")
    await user.click(within(dialog).getByRole('button', { name: 'Déconnecter' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Autres sessions déconnectées'))
    expect(deleteCalls()).toEqual(['/api/account/sessions'])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Déconnecter les autres sessions' })).toBeDisabled())
  })

  it('disables the sign-out of others when only the current session is open', async () => {
    sessions = [current]
    render(<SessionsCard />)
    await screen.findByText('Firefox sur macOS')
    expect(screen.getByRole('button', { name: 'Déconnecter les autres sessions' })).toBeDisabled()
  })

  it('shows the load error with a retry that loads again', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Session expirée' }, { status: 401 }))
    render(<SessionsCard />)
    expect(await screen.findByText(/Les sessions n'ont pas pu être chargées. Session expirée/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Firefox sur macOS')).toBeInTheDocument()
    expect(screen.queryByText(/n'ont pas pu être chargées/)).toBeNull()
  })

  it('toasts the error of a failed sign-out', async () => {
    const user = userEvent.setup()
    render(<SessionsCard />)
    await screen.findByText('Firefox sur macOS')
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Session introuvable' }, { status: 404 }))
    await user.click(screen.getByRole('button', { name: 'Déconnecter la session Chrome sur Windows' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Déconnecter' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Session introuvable'))
  })

  it('exposes reload() so the password card can refresh the list after revoking sessions', async () => {
    const ref = createRef<SessionsCardHandle>()
    render(<SessionsCard ref={ref} />)
    await screen.findByText('Safari sur iPhone')
    sessions = [current]
    await act(async () => {
      await ref.current!.reload()
    })
    expect(screen.queryByText('Safari sur iPhone')).toBeNull()
  })
})
