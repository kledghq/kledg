import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTOMATIC_MODE_WARNING } from '@/lib/ai-access/access'

const nav = vi.hoisted(() => ({ search: new URLSearchParams() }))
const auth = vi.hoisted(() => ({
  client: null as Record<string, string> | null,
  consent: vi.fn(),
  $fetch: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useSearchParams: () => nav.search }))
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { email: 'marie@acme.fr' } } }),
    $fetch: auth.$fetch,
    oauth2: { consent: auth.consent },
  },
}))

import ConsentPage from '../page'

const CLAUDE = 'https://claude.ai/oauth/claude-client'
const ALL_SCOPES = 'openid offline_access kledg:read kledg:write kledg:admin'

let grants: { assistants: unknown[]; apiKeys: unknown[] }
const fetchMock = vi.fn<typeof fetch>()
const location = { href: 'http://localhost/consent' }

function request(clientId: string, scope: string, redirect = 'https://claude.ai/api/mcp/auth_callback') {
  nav.search = new URLSearchParams({ client_id: clientId, scope, redirect_uri: redirect })
}

beforeEach(() => {
  request(CLAUDE, ALL_SCOPES)
  grants = { assistants: [], apiKeys: [] }
  auth.client = { client_name: 'Claude' }
  auth.$fetch.mockImplementation(async () => ({ data: auth.client }))
  auth.consent.mockResolvedValue({ data: { redirect_uri: 'https://claude.ai/api/mcp/auth_callback?code=xyz' }, error: null })
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === '/api/companies') {
      return Response.json([
        { id: 'c1', name: 'Alpha SAS', siren: '123456789' },
        { id: 'c2', name: 'Beta SARL', siren: null },
      ])
    }
    if (url === '/api/ai-access/grants') return Response.json(grants)
    if (url === '/api/ai-access/assistants' && init?.method === 'PUT') return Response.json({ allCompanies: true, companyIds: [] })
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  location.href = 'http://localhost/consent'
  vi.stubGlobal('location', location)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

const putBody = () => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
  return call ? JSON.parse(String(call[1]?.body)) : undefined
}

describe('Consent page', () => {
  it('names a verified assistant, where it redirects, and preselects read and drafts, never full control', async () => {
    render(<ConsentPage />)
    expect(screen.getByRole('heading', { name: "Claude demande l'accès à votre comptabilité" })).toBeInTheDocument()
    expect(screen.getByText(/Vous serez redirigé vers/).parentElement).toHaveTextContent('Vous serez redirigé vers claude.ai')
    expect(screen.getByText(/Application identifiée par le domaine/)).toHaveTextContent('claude.ai')
    expect(screen.getByText('marie@acme.fr')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Lecture et brouillons/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Contrôle total/ })).not.toBeChecked()
    // Scopes shown are those of the chosen level only.
    expect(screen.getByText('Proposer des écritures en brouillon, que vous validerez vous-même')).toBeInTheDocument()
    expect(screen.queryByText(/Agir comme vous : valider, rapprocher/)).toBeNull()
    expect(screen.queryByText('Exécution des actions importantes')).toBeNull()
    await waitFor(() => expect(screen.getByRole('radio', { name: /Toutes mes sociétés/ })).toBeChecked())
  })

  it('approves with the companies saved first, and narrows the scopes to the chosen level', async () => {
    const user = userEvent.setup()
    render(<ConsentPage />)
    await waitFor(() => expect(screen.getByRole('radio', { name: /Seulement les sociétés choisies/ })).toBeEnabled())
    await user.click(screen.getByRole('radio', { name: /Seulement les sociétés choisies/ }))
    await user.click(await screen.findByRole('checkbox', { name: /Beta SARL/ }))
    await user.click(screen.getByRole('button', { name: 'Autoriser' }))

    await waitFor(() => expect(location.href).toBe('https://claude.ai/api/mcp/auth_callback?code=xyz'))
    expect(putBody()).toEqual({ clientId: CLAUDE, access: { allCompanies: false, companyIds: ['c2'] } })
    expect(auth.consent).toHaveBeenCalledWith({ accept: true, scope: 'openid offline_access kledg:read kledg:write' })
    const putOrder = fetchMock.mock.invocationCallOrder[fetchMock.mock.calls.findIndex(([, init]) => init?.method === 'PUT')]!
    expect(putOrder).toBeLessThan(auth.consent.mock.invocationCallOrder[0]!)
  })

  it('grants full control only when chosen, with the execution mode', async () => {
    const user = userEvent.setup()
    render(<ConsentPage />)
    await user.click(screen.getByRole('radio', { name: /Contrôle total/ }))
    expect(screen.getByText(/Agir comme vous : valider, rapprocher/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Automatique/ })).toBeChecked()
    expect(screen.getByText(AUTOMATIC_MODE_WARNING)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Validation dans Kledg/ }))
    await user.click(screen.getByRole('button', { name: 'Autoriser' }))

    await waitFor(() => expect(auth.consent).toHaveBeenCalled())
    expect(putBody()).toEqual({ clientId: CLAUDE, access: { allCompanies: true, companyIds: [] }, executionMode: 'validation' })
    // Everything requested is granted: no narrowed scope.
    expect(auth.consent).toHaveBeenCalledWith({ accept: true })
  })

  it('offers no level choice when only reading is requested', () => {
    request(CLAUDE, 'openid kledg:read')
    render(<ConsentPage />)
    expect(screen.queryByRole('radio', { name: /Contrôle total/ })).toBeNull()
    expect(screen.queryByRole('radio', { name: /Lecture seule/ })).toBeNull()
    expect(screen.getByText(/Consulter votre comptabilité/)).toBeInTheDocument()
    expect(screen.getByText(/sans pouvoir proposer d'écritures/)).toBeInTheDocument()
  })

  it('refuses without saving any access', async () => {
    const user = userEvent.setup()
    auth.consent.mockResolvedValue({ data: { url: 'https://claude.ai/api/mcp/auth_callback?error=access_denied' }, error: null })
    render(<ConsentPage />)
    await user.click(screen.getByRole('button', { name: 'Refuser' }))
    await waitFor(() => expect(location.href).toBe('https://claude.ai/api/mcp/auth_callback?error=access_denied'))
    expect(auth.consent).toHaveBeenCalledWith({ accept: false })
    expect(putBody()).toBeUndefined()
  })

  it('requires at least one company before approving', async () => {
    const user = userEvent.setup()
    render(<ConsentPage />)
    await waitFor(() => expect(screen.getByRole('radio', { name: /Seulement les sociétés choisies/ })).toBeEnabled())
    await user.click(screen.getByRole('radio', { name: /Seulement les sociétés choisies/ }))
    await user.click(screen.getByRole('button', { name: 'Autoriser' }))
    expect(screen.getByText('Choisissez au moins une société, ou toutes vos sociétés.')).toBeInTheDocument()
    expect(putBody()).toBeUndefined()
    expect(auth.consent).not.toHaveBeenCalled()
  })

  it('starts from the companies a reconnected assistant had', async () => {
    grants = {
      assistants: [{ clientId: CLAUDE, allCompanies: false, companyIds: ['c1', 'gone'], executionMode: 'validation' }],
      apiKeys: [],
    }
    render(<ConsentPage />)
    expect(await screen.findByRole('checkbox', { name: /Alpha SAS/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Beta SARL/ })).not.toBeChecked()
  })

  it('does not ask the authorization server when the access cannot be saved', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (input, init) =>
      init?.method === 'PUT'
        ? Response.json({ error: 'Société inaccessible' }, { status: 403 })
        : String(input) === '/api/companies'
          ? Response.json([])
          : Response.json({ assistants: [], apiKeys: [] }),
    )
    render(<ConsentPage />)
    await user.click(screen.getByRole('button', { name: 'Autoriser' }))
    expect(await screen.findByText('Société inaccessible')).toBeInTheDocument()
    expect(auth.consent).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Autoriser' })).toBeEnabled()
  })

  it('says the request expired when the server gives no redirect', async () => {
    const user = userEvent.setup()
    auth.consent.mockResolvedValue({ data: null, error: null })
    render(<ConsentPage />)
    await user.click(screen.getByRole('button', { name: 'Refuser' }))
    expect(await screen.findByText("La demande d'accès a expiré. Relancez la connexion depuis votre assistant.")).toBeInTheDocument()
    expect(location.href).toBe('http://localhost/consent')
  })

  it('never presents the name a dynamically registered client declares as its identity', async () => {
    request('dcr-client-123', 'openid kledg:read kledg:write', 'https://evil.example/callback')
    auth.client = { client_name: 'Claude', client_uri: 'https://claude.ai.evil.example' }
    render(<ConsentPage />)
    expect(
      screen.getByRole('heading', { name: "Une application non vérifiée demande l'accès à votre comptabilité" }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Vous serez redirigé vers/).parentElement).toHaveTextContent('Vous serez redirigé vers evil.example')
    const warning = await screen.findByText(/Application non vérifiée\./)
    const alert = warning.closest('[role="alert"]') as HTMLElement
    await waitFor(() => expect(alert).toHaveTextContent('Elle se présente comme « Claude » (claude.ai.evil.example), mais'))
    expect(within(alert).getByText(/Kledg ne peut pas confirmer/)).toBeInTheDocument()
    expect(screen.queryByText(/Application : https/)).toBeNull()
    expect(auth.$fetch).toHaveBeenCalledWith('/oauth2/public-client', { query: { client_id: 'dcr-client-123' } })
  })

  it('reads the client from the pre-login endpoint when the session one fails', async () => {
    auth.$fetch.mockImplementation(async (path: string) =>
      path === '/oauth2/public-client' ? { data: null } : { data: { client_name: 'Claude' } },
    )
    render(<ConsentPage />)
    await waitFor(() =>
      expect(auth.$fetch).toHaveBeenCalledWith('/oauth2/public-client-prelogin', { method: 'POST', body: { client_id: CLAUDE } }),
    )
  })
})
