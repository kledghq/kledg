import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
  $fetch: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/auth-client', () => ({
  authClient: { apiKey: { list: auth.list, delete: auth.remove }, $fetch: auth.$fetch },
}))

import ApiKeysPage from '../api-keys/page'
import AssistantsPage from '../assistants/page'

const key = {
  id: 'k1',
  name: 'Claude Code',
  start: 'kl_ab',
  createdAt: '2026-09-01T10:00:00.000Z',
  lastRequest: null,
  expiresAt: null,
  permissions: { kledg: ['read', 'write'] },
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === '/api/companies') return Response.json([{ id: 'c1', name: 'Alpha SAS' }])
    if (url === '/api/ai-access/grants') {
      return Response.json({
        assistants: [{ clientId: 'https://claude.ai/oauth/x', allCompanies: false, companyIds: ['c1'], executionMode: 'automatic' }],
        apiKeys: [{ apiKeyId: 'k1', allCompanies: false, companyIds: ['c1'], executionMode: 'automatic' }],
      })
    }
    if (url === '/api/ai-access/api-keys' && init?.method === 'POST') return Response.json({ key: 'kledg_new_secret' })
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

const grantLoads = () => fetchMock.mock.calls.filter(([url]) => url === '/api/ai-access/grants').length

describe('Clés API page', () => {
  it('lists the keys with their companies from the saved grants', async () => {
    auth.list.mockResolvedValue({ data: { apiKeys: [key] }, error: null })
    render(<ApiKeysPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Clés API' })).toBeInTheDocument()
    const row = (await screen.findByText('Claude Code')).closest('li')!
    await waitFor(() => expect(row).toHaveTextContent('Sociétés : Alpha SAS'))
    expect(row).toHaveTextContent("Accès : Lecture et brouillons d'écritures")
    expect(screen.getByText('1 clé')).toBeInTheDocument()
  })

  it('accepts the list as a plain array too', async () => {
    auth.list.mockResolvedValue({ data: [key, { ...key, id: 'k2', name: 'Script' }], error: null })
    render(<ApiKeysPage />)
    expect(await screen.findByText('2 clés')).toBeInTheDocument()
  })

  it('says when the keys cannot be loaded', async () => {
    auth.list.mockResolvedValue({ data: null, error: { message: 'Session expirée' } })
    render(<ApiKeysPage />)
    expect(await screen.findByText('Session expirée')).toBeInTheDocument()
  })

  it('reloads the keys and their grants after creating a key', async () => {
    const user = userEvent.setup()
    auth.list.mockResolvedValue({ data: { apiKeys: [] }, error: null })
    render(<ApiKeysPage />)
    await screen.findByText('0 clé')
    await waitFor(() => expect(grantLoads()).toBe(1))
    auth.list.mockResolvedValue({ data: { apiKeys: [key] }, error: null })
    await user.click(screen.getByRole('button', { name: 'Créer la clé' }))
    expect(await screen.findByText('kledg_new_secret')).toBeInTheDocument()
    expect(await screen.findByText('1 clé')).toBeInTheDocument()
    expect(auth.list).toHaveBeenCalledTimes(2)
    expect(grantLoads()).toBe(2)
  })
})

describe('Assistants IA page', () => {
  beforeEach(() => {
    auth.$fetch.mockImplementation(async (path: string) => {
      if (path === '/oauth2/get-consents') {
        return { data: [{ id: 'consent-1', clientId: 'https://claude.ai/oauth/x', scopes: ['kledg:read'], createdAt: '2026-09-10T08:00:00.000Z' }] }
      }
      if (path === '/oauth2/public-client') return { data: { client_name: 'Claude' } }
      return { data: null }
    })
  })

  it('lists the authorized assistants with their companies and marks them connected', async () => {
    auth.list.mockResolvedValue({ data: { apiKeys: [] }, error: null })
    render(<AssistantsPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Assistants IA' })).toBeInTheDocument()
    const card = (await screen.findByText('Assistants autorisés')).closest('[data-slot="card"]') as HTMLElement
    const row = (await within(card).findByText('Claude')).closest('li')!
    expect(row).toHaveTextContent('Lecture seule · autorisé le 10 septembre 2026')
    await waitFor(() => expect(row).toHaveTextContent('Sociétés : Alpha SAS'))
    expect(await screen.findByText('Claude est connecté')).toBeInTheDocument()
  })

  it('marks Claude Code connected when the user has an API key', async () => {
    const user = userEvent.setup()
    auth.list.mockResolvedValue({ data: [key], error: null })
    render(<AssistantsPage />)
    await screen.findByText('Claude est connecté')
    await user.click(screen.getByRole('tab', { name: /Claude Code/ }))
    expect(await screen.findByText('Clé API active')).toBeInTheDocument()
  })

  it('labels an unverified assistant as such', async () => {
    auth.list.mockResolvedValue({ data: [], error: null })
    auth.$fetch.mockImplementation(async (path: string) => {
      if (path === '/oauth2/get-consents') return { data: [{ id: 'consent-2', clientId: 'dcr-1', scopes: ['kledg:read'] }] }
      if (path === '/oauth2/public-client') return { data: { client_name: 'Claude' } }
      return { data: null }
    })
    render(<AssistantsPage />)
    expect(await screen.findByText('Claude (non vérifiée)')).toBeInTheDocument()
    expect(screen.queryByText('Claude est connecté')).toBeNull()
  })
})
