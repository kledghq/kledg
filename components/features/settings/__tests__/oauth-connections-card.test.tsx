import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionAccess } from '@/lib/ai-access/access'
import type { AssistantConsent } from '../use-assistant-connections'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const authFetch = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/auth-client', () => ({ authClient: { $fetch: authFetch } }))

import { OAuthConnectionsCard } from '../oauth-connections-card'

const companies = [
  { id: 'c1', name: 'Alpha SAS' },
  { id: 'c2', name: 'Beta SARL' },
]

const claude: AssistantConsent = {
  id: 'consent-1',
  clientId: 'https://claude.ai/oauth/client',
  scopes: ['openid', 'offline_access', 'kledg:read', 'kledg:write'],
  createdAt: '2026-09-10T08:00:00.000Z',
  name: 'Claude',
  kind: 'claude',
}
const chatgpt: AssistantConsent = {
  id: 'consent-2',
  clientId: 'https://chatgpt.com/client',
  scopes: ['kledg:read', 'kledg:write', 'kledg:admin'],
  name: 'ChatGPT',
  kind: 'chatgpt',
}

const grants = new Map<string, ConnectionAccess>([
  [chatgpt.clientId, { allCompanies: false, companyIds: ['c1'], executionMode: 'validation' }],
])

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockResolvedValue(Response.json({ allCompanies: true, companyIds: [] }))
  vi.stubGlobal('fetch', fetchMock)
  authFetch.mockResolvedValue({ error: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

function renderCard(props: Partial<Parameters<typeof OAuthConnectionsCard>[0]> = {}) {
  const onChange = vi.fn()
  const onGrantChange = vi.fn(async () => {})
  render(
    <OAuthConnectionsCard
      consents={[claude, chatgpt]}
      loading={false}
      onChange={onChange}
      grants={grants}
      companies={companies}
      companiesLoading={false}
      onGrantChange={onGrantChange}
      {...props}
    />,
  )
  return { onChange, onGrantChange }
}

describe('OAuthConnectionsCard', () => {
  it('describes each assistant: level, mode, authorization date and companies', () => {
    renderCard()
    const claudeRow = screen.getByText('Claude').closest('li')!
    expect(claudeRow).toHaveTextContent("Lecture et brouillons d'écritures · autorisé le 10 septembre 2026")
    expect(claudeRow).toHaveTextContent('Sociétés : Toutes les sociétés')
    const chatgptRow = screen.getByText('ChatGPT').closest('li')!
    expect(chatgptRow).toHaveTextContent('Contrôle total, exécution avec validation dans Kledg')
    expect(chatgptRow).toHaveTextContent('Sociétés : Alpha SAS')
  })

  it('shows loading and empty states', () => {
    const { unmount } = render(
      <OAuthConnectionsCard consents={[]} loading onChange={vi.fn()} grants={new Map()} companies={[]} companiesLoading={false} onGrantChange={vi.fn()} />,
    )
    expect(screen.getByText('Chargement...')).toBeInTheDocument()
    unmount()
    renderCard({ consents: [] })
    expect(screen.getByText('Aucun assistant autorisé.')).toBeInTheDocument()
  })

  it('revokes an assistant after confirmation through the delete-consent endpoint', async () => {
    const user = userEvent.setup()
    const { onChange, onGrantChange } = renderCard()
    await user.click(screen.getByRole('button', { name: "Révoquer l'accès de Claude" }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText("Révoquer l'accès de Claude ?")).toBeInTheDocument()
    expect(authFetch).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Révoquer' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Accès révoqué'))
    expect(authFetch).toHaveBeenCalledWith('/oauth2/delete-consent', { method: 'POST', body: { id: 'consent-1' } })
    expect(onChange).toHaveBeenCalled()
    expect(onGrantChange).toHaveBeenCalled()
  })

  it('toasts a failed revocation without refreshing', async () => {
    const user = userEvent.setup()
    authFetch.mockResolvedValue({ error: { status: 500 } })
    const { onChange } = renderCard()
    await user.click(screen.getByRole('button', { name: "Révoquer l'accès de ChatGPT" }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Révoquer' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Impossible de révoquer l'accès"))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('offers no level above the granted one, and saves the companies without touching the consent', async () => {
    const user = userEvent.setup()
    const { onGrantChange } = renderCard()
    await user.click(screen.getByRole('button', { name: "Modifier l'accès de Claude" }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /Lecture et brouillons/ })).toBeChecked()
    expect(within(dialog).getByRole('radio', { name: /Contrôle total/ })).toBeDisabled()
    expect(within(dialog).getByText(/reconnectez l'assistant/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('radio', { name: /Seulement les sociétés choisies/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: /Beta SARL/ }))
    await user.click(within(dialog).getByRole('button', { name: "Enregistrer l'accès" }))

    await waitFor(() => expect(onGrantChange).toHaveBeenCalled())
    expect(authFetch).not.toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/ai-access/assistants')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({
      clientId: 'https://claude.ai/oauth/client',
      access: { allCompanies: false, companyIds: ['c2'] },
    })
  })

  it('lowers the level through update-consent, keeping the non Kledg scopes', async () => {
    const user = userEvent.setup()
    const { onChange } = renderCard()
    await user.click(screen.getByRole('button', { name: "Modifier l'accès de Claude" }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: /Lecture seule/ }))
    await user.click(within(dialog).getByRole('button', { name: "Enregistrer l'accès" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(authFetch).toHaveBeenCalledWith('/oauth2/update-consent', {
      method: 'POST',
      body: { id: 'consent-1', update: { scopes: ['openid', 'offline_access', 'kledg:read'] } },
    })
    expect(onChange).toHaveBeenCalled()
  })

  it('saves the execution mode of a full control assistant', async () => {
    const user = userEvent.setup()
    renderCard()
    await user.click(screen.getByRole('button', { name: "Modifier l'accès de ChatGPT" }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /Validation dans Kledg/ })).toBeChecked()
    await user.click(within(dialog).getByRole('radio', { name: /Automatique/ }))
    await user.click(within(dialog).getByRole('button', { name: "Enregistrer l'accès" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({
      clientId: 'https://chatgpt.com/client',
      access: { allCompanies: false, companyIds: ['c1'] },
      executionMode: 'automatic',
    })
  })

  it('keeps the dialog open with the error when lowering the level fails', async () => {
    const user = userEvent.setup()
    authFetch.mockResolvedValue({ error: { status: 400 } })
    renderCard()
    await user.click(screen.getByRole('button', { name: "Modifier l'accès de Claude" }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: /Lecture seule/ }))
    await user.click(within(dialog).getByRole('button', { name: "Enregistrer l'accès" }))
    expect(await within(dialog).findByText("L'accès n'a pas pu être modifié. Réessayez.")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
