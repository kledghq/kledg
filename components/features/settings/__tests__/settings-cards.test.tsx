import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { CreateUserForm } from '../create-user-form'
import { isLocalOrigin, McpConnectCard } from '../mcp-connect-card'
import { putAccess, useAiAccessGrants, useMyCompanies } from '../use-ai-access'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

describe('CreateUserForm', () => {
  it('validates the email, length and confirmation before calling the API', async () => {
    const user = userEvent.setup()
    render(<CreateUserForm />)
    await user.type(screen.getByLabelText(/Email/), 'pas-un-email')
    await user.type(screen.getByLabelText(/^Mot de passe/), 'court')
    await user.type(screen.getByLabelText(/Confirmer le mot de passe/), 'autre')
    await user.click(screen.getByRole('button', { name: 'Créer le compte' }))
    expect(await screen.findByText('Adresse email invalide')).toBeInTheDocument()
    expect(screen.getByText('Au moins 10 caractères')).toBeInTheDocument()
    expect(screen.getByText('Les mots de passe ne correspondent pas')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts the email and password (not the confirmation) and resets on success', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({ id: 'u2' }, { status: 201 }))
    render(<CreateUserForm />)
    await user.type(screen.getByLabelText(/Email/), ' paul@acme.fr ')
    await user.type(screen.getByLabelText(/^Mot de passe/), 'long-password')
    await user.type(screen.getByLabelText(/Confirmer le mot de passe/), 'long-password')
    await user.click(screen.getByRole('button', { name: 'Créer le compte' }))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Compte paul@acme.fr créé', {
        description: 'Ajoutez-le maintenant à une société depuis sa page Membres.',
      }),
    )
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/users')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'paul@acme.fr', password: 'long-password' })
    expect(screen.getByLabelText(/Email/)).toHaveValue('')
  })

  it('toasts the API error, or a connection message when the request fails', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Un compte existe déjà avec cette adresse' }, { status: 409 }))
    render(<CreateUserForm />)
    await user.type(screen.getByLabelText(/Email/), 'paul@acme.fr')
    await user.type(screen.getByLabelText(/^Mot de passe/), 'long-password')
    await user.type(screen.getByLabelText(/Confirmer le mot de passe/), 'long-password')
    await user.click(screen.getByRole('button', { name: 'Créer le compte' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Un compte existe déjà avec cette adresse'))
    expect(screen.getByLabelText(/Email/)).toHaveValue('paul@acme.fr')

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await user.click(screen.getByRole('button', { name: 'Créer le compte' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Le compte n'a pas pu être créé. Vérifiez votre connexion et réessayez."),
    )
  })
})

describe('McpConnectCard', () => {
  it('shows the MCP URL of this origin and copies it', async () => {
    const user = userEvent.setup()
    render(<McpConnectCard connected={new Set()} hasApiKey={false} />)
    const url = `${window.location.origin}/api/mcp`
    expect(await screen.findByText(url)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Copier' })[0]!)
    await expect(navigator.clipboard.readText()).resolves.toBe(url)
    expect(toast.success).toHaveBeenCalledWith('Copié')
    expect(screen.queryByText('Claude est connecté')).toBeNull()
  })

  it('warns that claude.ai and ChatGPT cannot reach a local address', async () => {
    render(<McpConnectCard connected={new Set()} hasApiKey={false} />)
    // jsdom runs on localhost
    expect(await screen.findByText('Adresse locale')).toBeInTheDocument()
    expect(screen.getByText(/ne peuvent pas joindre cette adresse/)).toBeInTheDocument()
  })

  it('tells local addresses from public ones', () => {
    expect(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://kledg.local', 'http://192.168.1.20', 'http://10.0.0.5', 'http://172.20.0.2'].map(isLocalOrigin)).toEqual([true, true, true, true, true, true])
    expect(['https://compta.example.fr', 'https://app.kledg.com', 'http://172.40.0.2', 'pas une url'].map(isLocalOrigin)).toEqual([false, false, false, false])
  })

  it('says when the browser refuses to copy', async () => {
    const user = userEvent.setup()
    render(<McpConnectCard connected={new Set()} hasApiKey={false} />)
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'))
    await user.click(screen.getAllByRole('button', { name: 'Copier' })[0]!)
    expect(toast.error).toHaveBeenCalledWith('Copie impossible dans ce navigateur\u00a0: sélectionnez le texte puis copiez-le.')
  })

  it('marks connected assistants and gives the Claude Code command with the key placeholder', async () => {
    const user = userEvent.setup()
    render(<McpConnectCard connected={new Set(['claude'] as const)} hasApiKey />)
    expect(screen.getByText('Claude est connecté')).toBeInTheDocument()
    expect(screen.getAllByLabelText('connecté')).toHaveLength(2)

    await user.click(screen.getByRole('tab', { name: /Claude Code/ }))
    expect(screen.getByText('Clé API active')).toBeInTheDocument()
    expect(
      screen.getByText(`claude mcp add --transport http kledg ${window.location.origin}/api/mcp --header "Authorization: Bearer VOTRE_CLE"`),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clés API' })).toHaveAttribute('href', '/settings/api-keys')
  })

  it('says Claude Code is connected when it is, without an API key', async () => {
    const user = userEvent.setup()
    render(<McpConnectCard connected={new Set(['claude-code', 'chatgpt'] as const)} hasApiKey={false} />)
    await user.click(screen.getByRole('tab', { name: /Claude Code/ }))
    expect(screen.getByText('Claude Code est connecté')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /ChatGPT/ }))
    expect(screen.getByText('ChatGPT est connecté')).toBeInTheDocument()
  })
})

describe('useMyCompanies', () => {
  it('loads the companies without caching and keeps id, name and SIREN', async () => {
    fetchMock.mockResolvedValue(Response.json([{ id: 'c1', name: 'Alpha', siren: '123456789', slug: 'alpha' }]))
    const { result } = renderHook(() => useMyCompanies())
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.companies).toEqual([{ id: 'c1', name: 'Alpha', siren: '123456789' }])
    expect(result.current.error).toBe(false)
    expect(fetchMock).toHaveBeenCalledWith('/api/companies', { cache: 'no-store' })
  })

  it('flags an error instead of reporting no company', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Non autorisé' }, { status: 401 }))
    const { result } = renderHook(() => useMyCompanies())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe(true)
    expect(result.current.companies).toEqual([])
  })
})

describe('useAiAccessGrants', () => {
  it('indexes assistant grants by client id and key grants by key id, and reloads', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        assistants: [{ clientId: 'cl1', allCompanies: true, companyIds: [], executionMode: 'automatic' }],
        apiKeys: [{ apiKeyId: 'k1', allCompanies: false, companyIds: ['c1'], executionMode: 'validation' }],
      }),
    )
    const { result } = renderHook(() => useAiAccessGrants())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.assistants.get('cl1')).toEqual({ allCompanies: true, companyIds: [], executionMode: 'automatic' })
    expect(result.current.apiKeys.get('k1')).toEqual({ allCompanies: false, companyIds: ['c1'], executionMode: 'validation' })
    expect(fetchMock).toHaveBeenCalledWith('/api/ai-access/grants', { cache: 'no-store' })

    fetchMock.mockResolvedValue(Response.json({ assistants: [], apiKeys: [] }))
    await act(() => result.current.reload())
    expect(result.current.apiKeys.size).toBe(0)
  })

  it('stays not loaded when the grants cannot be read', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }))
    const { result } = renderHook(() => useAiAccessGrants())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.loaded).toBe(false)
  })
})

describe('putAccess', () => {
  it('PUTs the JSON body and returns the saved access', async () => {
    fetchMock.mockResolvedValue(Response.json({ allCompanies: false, companyIds: ['c1'] }))
    await expect(putAccess('/api/ai-access/assistants', { clientId: 'cl1' })).resolves.toEqual({
      allCompanies: false,
      companyIds: ['c1'],
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/ai-access/assistants', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"clientId":"cl1"}',
    })
  })

  it('throws the API message, or a generic one', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Société inaccessible' }, { status: 403 }))
    await expect(putAccess('/x', {})).rejects.toThrow('Société inaccessible')
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 502 }))
    await expect(putAccess('/x', {})).rejects.toThrow("L'accès n'a pas pu être enregistré. Réessayez.")
  })
})
