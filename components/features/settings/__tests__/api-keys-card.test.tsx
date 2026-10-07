import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionAccess } from '@/lib/ai-access/access'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const apiKeyDelete = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/auth-client', () => ({ authClient: { apiKey: { delete: apiKeyDelete } } }))

import { ApiKeysCard, NewApiKeyCard, type ApiKey } from '../api-keys-card'

const companies = [
  { id: 'c1', name: 'Alpha SAS' },
  { id: 'c2', name: 'Beta SARL' },
]

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

function requestBody(index = -1) {
  const [url, init] = fetchMock.mock.calls.at(index)!
  return { url, method: init?.method, body: JSON.parse(String(init?.body)) }
}

describe('NewApiKeyCard', () => {
  it('preselects read and drafts (never full control) and every company', () => {
    render(<NewApiKeyCard companies={companies} companiesLoading={false} onCreated={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /Lecture et brouillons/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Contrôle total/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /Toutes mes sociétés/ })).toBeChecked()
    expect(screen.queryByText('Exécution des actions importantes')).toBeNull()
  })

  it('creates a key with a default name and shows the secret once, until dismissed', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn(async () => {})
    fetchMock.mockResolvedValue(Response.json({ key: 'kledg_secret_123' }))
    render(<NewApiKeyCard companies={companies} companiesLoading={false} onCreated={onCreated} />)

    await user.type(screen.getByLabelText('Nom'), '   ')
    await user.click(screen.getByRole('button', { name: 'Créer la clé' }))

    expect(await screen.findByText('kledg_secret_123')).toBeInTheDocument()
    expect(requestBody()).toEqual({
      url: '/api/ai-access/api-keys',
      method: 'POST',
      body: { name: 'Clé MCP', access: { allCompanies: true, companyIds: [] }, level: 'write', expiresInDays: 90 },
    })
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Stockez-la en sécurité, elle ne sera plus affichée.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copier la clé' }))
    await expect(navigator.clipboard.readText()).resolves.toBe('kledg_secret_123')
    expect(toast.success).toHaveBeenCalledWith('Copié dans le presse-papier')

    await user.click(screen.getByRole('button', { name: "J'ai copié la clé" }))
    expect(screen.queryByText('kledg_secret_123')).toBeNull()
  })

  it('sends the execution mode with a full control key on chosen companies, then resets the form', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({ key: 'k' }))
    render(<NewApiKeyCard companies={companies} companiesLoading={false} onCreated={vi.fn(async () => {})} />)

    await user.type(screen.getByLabelText('Nom'), ' Claude Code ')
    await user.click(screen.getByRole('radio', { name: /Contrôle total/ }))
    expect(screen.getByRole('radio', { name: /Automatique/ })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: /Validation dans Kledg/ }))
    await user.click(screen.getByRole('radio', { name: /Seulement les sociétés choisies/ }))
    await user.click(screen.getByRole('checkbox', { name: /Beta SARL/ }))
    // Full control asks for the password again (KLEDG-R3-AUTH-01).
    await user.click(screen.getByRole('button', { name: 'Créer la clé' }))
    expect(screen.getByText('Saisissez votre mot de passe pour créer une clé à contrôle total.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText(/Votre mot de passe/), 'secret-password')
    await user.click(screen.getByRole('button', { name: 'Créer la clé' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(requestBody().body).toEqual({
      name: 'Claude Code',
      access: { allCompanies: false, companyIds: ['c2'] },
      level: 'admin',
      expiresInDays: 90,
      executionMode: 'validation',
      password: 'secret-password',
    })
    await waitFor(() => expect(screen.getByRole('radio', { name: /Lecture et brouillons/ })).toBeChecked())
    expect(screen.getByLabelText('Nom')).toHaveValue('')
    expect(screen.getByRole('radio', { name: /Toutes mes sociétés/ })).toBeChecked()
  })

  it('does not create a key restricted to no company', async () => {
    const user = userEvent.setup()
    render(<NewApiKeyCard companies={companies} companiesLoading={false} onCreated={vi.fn()} />)
    await user.click(screen.getByRole('radio', { name: /Seulement les sociétés choisies/ }))
    await user.click(screen.getByRole('button', { name: 'Créer la clé' }))
    expect(screen.getByText('Choisissez au moins une société, ou toutes vos sociétés.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('toasts the API error and shows no key', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Trop de clés actives' }, { status: 400 }))
    render(<NewApiKeyCard companies={companies} companiesLoading={false} onCreated={onCreated} />)
    await user.click(screen.getByRole('button', { name: 'Créer la clé' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Trop de clés actives'))
    expect(onCreated).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }))
    await user.click(screen.getByRole('button', { name: 'Créer la clé' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("La clé n'a pas pu être créée. Réessayez."))
  })
})

const keys: ApiKey[] = [
  {
    id: 'k/1',
    name: 'Claude Code',
    start: 'kl_ab',
    createdAt: '2026-09-01T10:00:00.000Z',
    lastRequest: '2026-10-02T10:00:00.000Z',
    expiresAt: '2026-11-30T10:00:00.000Z',
    permissions: { kledg: ['read', 'write', 'admin'] },
  },
  {
    id: 'k2',
    name: null,
    start: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    lastRequest: null,
    expiresAt: null,
    permissions: null,
  },
]

const grants = new Map<string, ConnectionAccess>([
  ['k/1', { allCompanies: false, companyIds: ['c2'], executionMode: 'validation' }],
])

describe('ApiKeysCard', () => {
  it('describes each key: prefix, dates, level and companies', () => {
    render(
      <ApiKeysCard keys={keys} loading={false} grants={grants} companies={companies} companiesLoading={false} onChange={vi.fn()} />,
    )
    expect(screen.getByText('2 clés')).toBeInTheDocument()
    const first = screen.getByText('Claude Code').closest('li')!
    expect(first).toHaveTextContent('kl_ab•••• · créée le 1 septembre 2026 · dernière utilisation le 2 octobre 2026 · expire le 30 novembre 2026')
    expect(first).toHaveTextContent('Accès : Contrôle total, exécution avec validation dans Kledg')
    expect(first).toHaveTextContent('Sociétés : Beta SARL')
    const second = screen.getByText('Sans nom').closest('li')!
    expect(second).toHaveTextContent('••• · créée le 1 août 2026 · jamais utilisée · sans expiration')
    // A key without a level is read-only (fail closed).
    expect(second).toHaveTextContent('Accès : Lecture seule')
    expect(second).toHaveTextContent('Sociétés : Toutes les sociétés')
  })

  it('points to the assistants page when there is no key', () => {
    render(<ApiKeysCard keys={[]} loading={false} grants={new Map()} companies={[]} companiesLoading={false} onChange={vi.fn()} />)
    expect(screen.getByText('0 clé')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Assistants IA' })).toHaveAttribute('href', '/settings/assistants')
  })

  it('revokes a key only after confirmation', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn(async () => {})
    apiKeyDelete.mockResolvedValue({ error: null })
    render(
      <ApiKeysCard keys={keys} loading={false} grants={grants} companies={companies} companiesLoading={false} onChange={onChange} />,
    )
    await user.click(screen.getByRole('button', { name: 'Révoquer la clé Claude Code' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Révoquer la clé « Claude Code » ?')).toBeInTheDocument()
    expect(apiKeyDelete).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Révoquer' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Clé révoquée'))
    expect(apiKeyDelete).toHaveBeenCalledWith({ keyId: 'k/1' })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('keeps the key when cancelled and toasts a failed revocation', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn(async () => {})
    render(
      <ApiKeysCard keys={keys} loading={false} grants={grants} companies={companies} companiesLoading={false} onChange={onChange} />,
    )
    await user.click(screen.getByRole('button', { name: 'Révoquer la clé sans nom' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Annuler' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(apiKeyDelete).not.toHaveBeenCalled()

    apiKeyDelete.mockResolvedValue({ error: { message: 'Clé introuvable' } })
    await user.click(screen.getByRole('button', { name: 'Révoquer la clé sans nom' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Révoquer' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Clé introuvable'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('edits the companies and mode of a full control key with PUT on its encoded id', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn(async () => {})
    fetchMock.mockResolvedValue(Response.json({ allCompanies: true, companyIds: [] }))
    render(
      <ApiKeysCard keys={keys} loading={false} grants={grants} companies={companies} companiesLoading={false} onChange={onChange} />,
    )
    await user.click(screen.getByRole('button', { name: "Modifier l'accès de la clé Claude Code" }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Accès de la clé « Claude Code »')).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: /Beta SARL/ })).toBeChecked()
    expect(within(dialog).getByRole('radio', { name: /Validation dans Kledg/ })).toBeChecked()

    await user.click(within(dialog).getByRole('checkbox', { name: /Alpha SAS/ }))
    await user.click(within(dialog).getByRole('radio', { name: /Automatique/ }))
    await user.click(within(dialog).getByRole('button', { name: "Enregistrer l'accès" }))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(requestBody()).toEqual({
      url: '/api/ai-access/api-keys/k%2F1',
      method: 'PUT',
      body: { access: { allCompanies: false, companyIds: ['c1', 'c2'] }, executionMode: 'automatic' },
    })
  })

  it('offers no execution mode for a key below full control', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({ allCompanies: true, companyIds: [] }))
    render(
      <ApiKeysCard keys={keys} loading={false} grants={grants} companies={companies} companiesLoading={false} onChange={vi.fn(async () => {})} />,
    )
    await user.click(screen.getByRole('button', { name: "Modifier l'accès de la clé sans nom" }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText('Exécution des actions importantes')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: "Enregistrer l'accès" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(requestBody().body).toEqual({ access: { allCompanies: true, companyIds: [] } })
  })
})
