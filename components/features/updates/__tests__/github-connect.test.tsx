import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionSummary } from '@/lib/updates/connection'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { GitHubConnect } from '../github-connect'
import { formatDate, formatDateTime, updatesApi } from '../api'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

const connection: ConnectionSummary = {
  owner: 'acme',
  repo: 'kledg',
  kind: 'fork',
  defaultBranch: 'main',
  tokenLast4: 'a1b2',
  tokenExpiresAt: '2026-12-31T12:00:00.000Z',
  expired: false,
  expiresSoon: false,
  connectedAt: '2026-10-01T12:00:00.000Z',
}

describe('updatesApi and date helpers', () => {
  it('sends JSON, returns the data and throws the route message', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }))
    await expect(updatesApi('/api/updates/channel', { method: 'PUT', body: { channel: 'main' } })).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/updates/channel', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"channel":"main"}',
      cache: 'no-store',
    })
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Jeton invalide' }, { status: 400 }))
    await expect(updatesApi('/api/updates/connection')).rejects.toThrow('Jeton invalide')
    fetchMock.mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
    await expect(updatesApi('/api/updates/connection')).rejects.toThrow('La requête a échoué. Réessayez.')
  })

  it('formats dates in French and keeps null for missing values', () => {
    expect(formatDate('2026-10-03T12:00:00.000Z')).toBe('3 octobre 2026')
    expect(formatDate(null)).toBeNull()
    expect(formatDateTime(undefined)).toBeNull()
    expect(formatDateTime('2026-10-03T12:00:00.000Z')).toMatch(/^3 octobre 2026 (à )?\d{2}:\d{2}$/)
  })
})

describe('GitHubConnect: connect form', () => {
  it('asks for owner and repository when none is detected, and posts them with the token', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    fetchMock.mockResolvedValue(Response.json({ owner: 'acme' }))
    render(<GitHubConnect detected={null} connection={null} platform="vercel" onChange={onChange} />)

    const submit = screen.getByRole('button', { name: 'Vérifier et connecter' })
    expect(submit).toBeDisabled()
    expect(screen.getByRole('link', { name: /Créer le jeton sur GitHub/ }).getAttribute('href')).not.toContain('target_name')

    await user.type(screen.getByLabelText('Propriétaire du dépôt'), 'acme')
    expect(screen.getByRole('link', { name: /Créer le jeton sur GitHub/ }).getAttribute('href')).toContain('target_name=acme')
    await user.type(screen.getByLabelText('Jeton GitHub'), 'github_pat_xyz')
    expect(submit).toBeDisabled()
    await user.type(screen.getByLabelText('Nom du dépôt'), 'kledg')
    expect(submit).toBeEnabled()
    await user.click(submit)

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/updates/connection')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ token: 'github_pat_xyz', owner: 'acme', repo: 'kledg' })
    expect(toast.success).toHaveBeenCalledWith('GitHub connecté.')
    expect(screen.getByLabelText('Jeton GitHub')).toHaveValue('')
  })

  it('sends only the token for a detected repository and shows the route error inline', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    fetchMock.mockResolvedValue(Response.json({ error: 'Le jeton n’a pas accès à acme/kledg.' }, { status: 400 }))
    render(<GitHubConnect detected={{ owner: 'acme', repo: 'kledg' }} connection={null} platform="vercel" onChange={onChange} />)
    expect(screen.queryByLabelText('Propriétaire du dépôt')).toBeNull()
    expect(screen.getByText(/Dépôt détecté/)).toHaveTextContent('acme/kledg')

    await user.type(screen.getByLabelText('Jeton GitHub'), 'github_pat_xyz')
    await user.click(screen.getByRole('button', { name: 'Vérifier et connecter' }))
    expect(await screen.findByText('Le jeton n’a pas accès à acme/kledg.')).toBeInTheDocument()
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ token: 'github_pat_xyz' })
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('GitHubConnect: connected', () => {
  it('shows the repository, masked token and expiry', () => {
    render(<GitHubConnect detected={null} connection={connection} platform="vercel" onChange={vi.fn()} />)
    expect(screen.getByText('Fork de kledghq/kledg')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'acme/kledg' })).toHaveAttribute('href', 'https://github.com/acme/kledg')
    expect(screen.getByText('github_pat_••••a1b2')).toBeInTheDocument()
    expect(screen.getByText('31 décembre 2026')).toBeInTheDocument()
    expect(screen.queryByText(/Le jeton expire/)).toBeNull()
  })

  it('warns when the token expires soon or has expired', () => {
    const { unmount } = render(
      <GitHubConnect detected={null} connection={{ ...connection, kind: 'copy', expiresSoon: true }} platform="vercel" onChange={vi.fn()} />,
    )
    expect(screen.getByText('Copie de kledghq/kledg')).toBeInTheDocument()
    expect(screen.getByText(/Le jeton expire le 31 décembre 2026. Régénérez-le sur GitHub/)).toBeInTheDocument()
    unmount()
    render(
      <GitHubConnect
        detected={null}
        connection={{ ...connection, tokenExpiresAt: null, expired: true }}
        platform="vercel"
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('Aucune')).toBeInTheDocument()
    expect(screen.getByText(/Le jeton a expiré/)).toBeInTheDocument()
  })

  it('disconnects only after confirmation', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    fetchMock.mockResolvedValue(Response.json({ success: true }))
    render(<GitHubConnect detected={null} connection={connection} platform="vercel" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Déconnecter' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Déconnecter GitHub ?')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Déconnecter' }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/updates/connection')
    expect(fetchMock.mock.calls[0]![1]?.method).toBe('DELETE')
    expect(toast.success).toHaveBeenCalledWith('GitHub déconnecté. Pensez à supprimer le jeton sur GitHub.')
  })

  it('toasts a failed disconnection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    fetchMock.mockResolvedValue(Response.json({ error: 'Action refusée' }, { status: 403 }))
    render(<GitHubConnect detected={null} connection={connection} platform="vercel" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Déconnecter' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Déconnecter' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Action refusée'))
    expect(onChange).not.toHaveBeenCalled()
  })
})
