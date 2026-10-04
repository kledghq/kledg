import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

import { QontoConnectDialog } from '../qonto-connect-dialog'

/** Testing Library normalises DOM text, not attributes or toast arguments: compare without NBSP. */
const norm = (text: string | null | undefined) => (text ?? '').replace(/[\u202f\u00a0]/g, ' ')

const fetchMock = vi.fn()
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

interface Call {
  url: string
  method: string
  body: unknown
}

const calls = (): Call[] =>
  fetchMock.mock.calls.map((call) => {
    const [url, init] = call as [string, RequestInit | undefined]
    return {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    }
  })

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.warning).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function renderConnect(props: Partial<React.ComponentProps<typeof QontoConnectDialog>> = {}) {
  const onConnected = vi.fn()
  const onOpenChange = vi.fn()
  render(<QontoConnectDialog companyId="co-1" open onOpenChange={onOpenChange} onConnected={onConnected} {...props} />)
  return { onConnected, onOpenChange }
}

describe('QontoConnectDialog: new connection', () => {
  it('refuses to submit without the login and the secret key', async () => {
    const user = userEvent.setup()
    renderConnect()
    expect(screen.getByRole('heading', { name: /Connecter/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Connecter Qonto' }))
    expect(await screen.findByText("Collez l'identifiant de l'organisation Qonto.")).toBeInTheDocument()
    expect(screen.getByText('Collez la clé secrète.')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Identifiant/)).toHaveAttribute('aria-invalid', 'true')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checks the key, stores the connection, runs a first sync and reports it', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(json(200, { ok: true }))
      .mockResolvedValueOnce(json(201, { integration: { id: 'int-9' } }))
      .mockResolvedValueOnce(json(200, { itemsSynced: 3 }))
    const { onConnected } = renderConnect()

    // Pasted values come with stray spaces: they are trimmed before being sent
    await user.type(screen.getByLabelText(/^Identifiant/), '  atelier-lumen-1234 ')
    await user.type(screen.getByLabelText(/^Clé secrète/), 'sk_live_abc ')
    await user.click(screen.getByRole('button', { name: 'Connecter Qonto' }))

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
    const credentials = { login: 'atelier-lumen-1234', secretKey: 'sk_live_abc' }
    expect(calls()).toEqual([
      { url: '/api/integrations/verify', method: 'POST', body: { companyId: 'co-1', provider: 'QONTO', credentials } },
      {
        url: '/api/integrations',
        method: 'POST',
        body: {
          companyId: 'co-1',
          provider: 'QONTO',
          type: 'BANKING',
          name: 'Qonto',
          credentials,
          features: ['BANKING_ACCOUNTS', 'BANKING_TRANSACTIONS'],
        },
      },
      { url: '/api/integrations/int-9/sync', method: 'POST', body: undefined },
    ])
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' })
    expect(norm(vi.mocked(toast.success).mock.calls[0][0] as string)).toBe('Qonto connecté : vos comptes et opérations arrivent.')
    // The form is emptied for the next time
    expect(screen.getByLabelText(/^Identifiant/)).toHaveValue('')
  })

  it('shows a field error and stores nothing when Qonto refuses the key', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(401, { error: 'Unauthorized' }))
    const { onConnected } = renderConnect()

    await user.type(screen.getByLabelText(/^Identifiant/), 'atelier-lumen-1234')
    await user.type(screen.getByLabelText(/^Clé secrète/), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Connecter Qonto' }))

    expect(await screen.findByText(/Qonto refuse ces identifiants/)).toBeInTheDocument()
    expect(norm(screen.getByRole('alert').textContent)).toBe(
      "Qonto refuse ces identifiants : vérifiez l'identifiant et la clé secrète.",
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onConnected).not.toHaveBeenCalled()
  })

  it('shows the API error when the connection cannot be stored', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(200, {})).mockResolvedValueOnce(json(409, { error: 'Qonto est déjà connecté pour cette société.' }))
    const { onConnected } = renderConnect()

    await user.type(screen.getByLabelText(/^Identifiant/), 'atelier-lumen-1234')
    await user.type(screen.getByLabelText(/^Clé secrète/), 'sk')
    await user.click(screen.getByRole('button', { name: 'Connecter Qonto' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Qonto est déjà connecté pour cette société.'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onConnected).not.toHaveBeenCalled()
  })

  it('falls back to a French message when the error body is unreadable', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(200, {})).mockResolvedValueOnce(new Response('oops', { status: 500 }))
    renderConnect()

    await user.type(screen.getByLabelText(/^Identifiant/), 'atelier-lumen-1234')
    await user.type(screen.getByLabelText(/^Clé secrète/), 'sk')
    await user.click(screen.getByRole('button', { name: 'Connecter Qonto' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("La connexion n'a pas pu être enregistrée. Réessayez."))
  })

  it('warns, but still completes, when the first sync fails', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(json(200, {}))
      .mockResolvedValueOnce(json(201, { integration: { id: 'int-9' } }))
      .mockResolvedValueOnce(json(502, { error: 'Qonto indisponible' }))
    const { onConnected } = renderConnect()

    await user.type(screen.getByLabelText(/^Identifiant/), 'atelier-lumen-1234')
    await user.type(screen.getByLabelText(/^Clé secrète/), 'sk')
    await user.click(screen.getByRole('button', { name: 'Connecter Qonto' }))

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
    expect(toast.success).not.toHaveBeenCalled()
    expect(norm(vi.mocked(toast.warning).mock.calls[0][0] as string)).toBe(
      'Qonto connecté. La première synchronisation a échoué : relancez-la depuis la page des comptes.',
    )
  })

  it('closes on Annuler', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderConnect()
    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('QontoConnectDialog: API key update', () => {
  function credentialsThen(...rest: Response[]) {
    fetchMock.mockResolvedValueOnce(json(200, { credentials: { login: 'atelier-lumen-1234', secretKeyMasked: '••••c9f2' } }))
    for (const r of rest) fetchMock.mockResolvedValueOnce(r)
  }

  it('prefills the login and the masked hint, never the secret', async () => {
    credentialsThen()
    renderConnect({ integrationId: 'int-7' })

    expect(screen.getByRole('heading', { name: /Mettre à jour la clé API/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText(/^Identifiant/)).toHaveValue('atelier-lumen-1234'))
    expect(fetchMock).toHaveBeenCalledWith('/api/integrations/int-7/credentials')
    expect(screen.getByLabelText(/^Clé secrète/)).toHaveValue('')
    expect(
      screen.getByText("Laissez vide pour garder la clé actuelle (••••c9f2). Chiffrée sur votre instance, elle n'est jamais réaffichée."),
    ).toBeInTheDocument()
  })

  it('keeps the default hint when the stored credentials cannot be read', async () => {
    fetchMock.mockResolvedValueOnce(json(404, { error: 'Introuvable' }))
    renderConnect({ integrationId: 'int-7' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.getByText("Chiffrée sur votre instance, elle n'est jamais réaffichée.")).toBeInTheDocument()
    expect(screen.getByLabelText(/^Identifiant/)).toHaveValue('')
  })

  it('saves with an empty secret (keep the stored one), then syncs again', async () => {
    const user = userEvent.setup()
    credentialsThen(json(200, { integration: { id: 'int-7' } }), json(200, {}))
    const { onConnected } = renderConnect({ integrationId: 'int-7' })
    await waitFor(() => expect(screen.getByLabelText(/^Identifiant/)).toHaveValue('atelier-lumen-1234'))

    await user.click(screen.getByRole('button', { name: 'Enregistrer la clé' }))

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
    expect(calls().slice(1)).toEqual([
      { url: '/api/integrations/int-7', method: 'PUT', body: { credentials: { login: 'atelier-lumen-1234', secretKey: '' } } },
      { url: '/api/integrations/int-7/sync', method: 'POST', body: undefined },
    ])
    expect(norm(vi.mocked(toast.success).mock.calls[0][0] as string)).toBe('Clé API Qonto mise à jour : la synchronisation reprend.')
  })

  it('warns when the sync after a key update fails', async () => {
    const user = userEvent.setup()
    credentialsThen(json(200, {}), json(500, {}))
    const { onConnected } = renderConnect({ integrationId: 'int-7' })
    await waitFor(() => expect(screen.getByLabelText(/^Identifiant/)).toHaveValue('atelier-lumen-1234'))

    await user.type(screen.getByLabelText(/^Clé secrète/), 'sk_new')
    await user.click(screen.getByRole('button', { name: 'Enregistrer la clé' }))

    await waitFor(() => expect(onConnected).toHaveBeenCalled())
    expect(calls()[1].body).toEqual({ credentials: { login: 'atelier-lumen-1234', secretKey: 'sk_new' } })
    expect(norm(vi.mocked(toast.warning).mock.calls[0][0] as string)).toBe(
      'Clé API Qonto mise à jour. La synchronisation a échoué : relancez-la depuis la page des comptes.',
    )
  })

  it('shows a key refused by Qonto (400) under the secret field', async () => {
    const user = userEvent.setup()
    credentialsThen(json(400, { error: 'Qonto refuse cette clé API.' }))
    const { onConnected } = renderConnect({ integrationId: 'int-7' })
    await waitFor(() => expect(screen.getByLabelText(/^Identifiant/)).toHaveValue('atelier-lumen-1234'))

    await user.type(screen.getByLabelText(/^Clé secrète/), 'bad')
    await user.click(screen.getByRole('button', { name: 'Enregistrer la clé' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Qonto refuse cette clé API.')
    expect(screen.getByLabelText(/^Clé secrète/)).toHaveAttribute('aria-invalid', 'true')
    expect(toast.error).not.toHaveBeenCalled()
    expect(onConnected).not.toHaveBeenCalled()
  })

  it('toasts other server errors', async () => {
    const user = userEvent.setup()
    credentialsThen(json(500, {}))
    renderConnect({ integrationId: 'int-7' })
    await waitFor(() => expect(screen.getByLabelText(/^Identifiant/)).toHaveValue('atelier-lumen-1234'))

    await user.click(screen.getByRole('button', { name: 'Enregistrer la clé' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("La clé API n'a pas pu être enregistrée. Réessayez."))
  })

  it('does not load the credentials while closed', () => {
    render(<QontoConnectDialog companyId="co-1" open={false} onOpenChange={vi.fn()} onConnected={vi.fn()} integrationId="int-7" />)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
