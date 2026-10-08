import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { AiActionsList } from '../ai-actions-list'

const action = (overrides: Record<string, unknown>) => ({
  id: 'a1',
  tool: 'validate_entries',
  companyName: 'Alpha SAS',
  callerName: 'Claude',
  args: { entryIds: ['e1', 'e2'] },
  preview: { entries: 2, total: '1 200,00 €' },
  status: 'pending',
  expiresAt: '2026-10-03T10:30:00.000Z',
  createdAt: '2026-10-03T10:00:00.000Z',
  ...overrides,
})

let actions: ReturnType<typeof action>[]
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  actions = [
    action({ id: 'done', tool: 'close_fiscal_year', status: 'executed', callerName: null }),
    action({ id: 'act/1' }),
    action({ id: 'imp', tool: 'import_statement', status: 'failed', args: { contentBase64: 'QUJDRA==', format: 'ofx' } }),
  ]
  fetchMock.mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return Response.json({ status: 'approved' })
    if (String(input) === '/api/ai-actions') return Response.json({ actions })
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

const postCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')

describe('AiActionsList', () => {
  it('lists pending actions first, with labels, status, requester and the import content hidden', async () => {
    render(<AiActionsList highlight="imp" />)
    const titles = await screen.findAllByText(/Valider des écritures|Clôturer l'exercice|Importer un relevé bancaire/)
    expect(titles.map((t) => t.textContent)).toEqual([
      'Valider des écritures',
      "Clôturer l'exercice",
      'Importer un relevé bancaire',
    ])
    expect(screen.getByText('À approuver')).toBeInTheDocument()
    expect(screen.getByText('Exécutée')).toBeInTheDocument()
    expect(screen.getByText('Échouée')).toBeInTheDocument()
    expect(screen.getAllByText(/Alpha SAS · demandée par un assistant le/)).toHaveLength(1)
    expect(screen.getByText(/"contentBase64": "\(8 caractères\)"/)).toBeInTheDocument()
    expect(screen.queryByText(/QUJDRA==/)).toBeNull()
    // Only the pending action can be decided.
    expect(screen.getAllByRole('button', { name: 'Approuver' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Refuser' })).toHaveLength(1)
  })

  it('approves with the password in a same-origin JSON POST, then reloads', async () => {
    const user = userEvent.setup()
    render(<AiActionsList highlight={null} />)
    await user.click(await screen.findByRole('button', { name: 'Approuver' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Approuver cette action ?')).toBeInTheDocument()
    expect(within(dialog).getByText(/dans les 30 minutes/)).toBeInTheDocument()
    const submit = within(dialog).getByRole('button', { name: 'Approuver' })
    expect(submit).toBeDisabled()

    await user.type(within(dialog).getByLabelText(/Mot de passe/), 'my-password')
    await user.click(submit)

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Action approuvée\u00a0: l'assistant peut maintenant l'exécuter."),
    )
    expect(postCalls()).toEqual([
      [
        '/api/ai-actions/act%2F1',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'approve', password: 'my-password' }),
        },
      ],
    ])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/ai-actions')).toHaveLength(2)
  })

  it('rejects with decision reject', async () => {
    const user = userEvent.setup()
    render(<AiActionsList highlight={null} />)
    await user.click(await screen.findByRole('button', { name: 'Refuser' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Refuser cette action ?')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/Mot de passe/), 'pw')
    await user.click(within(dialog).getByRole('button', { name: 'Refuser' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Action refusée\u00a0: elle ne sera pas exécutée.'))
    expect(JSON.parse(String(postCalls()[0]![1]?.body))).toEqual({ decision: 'reject', password: 'pw' })
  })

  it('keeps the dialog open with the API error on a wrong password', async () => {
    const user = userEvent.setup()
    render(<AiActionsList highlight={null} />)
    fetchMock.mockImplementationOnce(async () => Response.json({ error: 'Mot de passe incorrect' }, { status: 403 }))
    await user.click(await screen.findByRole('button', { name: 'Approuver' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Mot de passe/), 'wrong')
    await user.click(within(dialog).getByRole('button', { name: 'Approuver' }))
    expect(await within(dialog).findByText('Mot de passe incorrect')).toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('says to check the connection when the decision request fails', async () => {
    const user = userEvent.setup()
    render(<AiActionsList highlight={null} />)
    await user.click(await screen.findByRole('button', { name: 'Approuver' }))
    const dialog = await screen.findByRole('dialog')
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await user.type(within(dialog).getByLabelText(/Mot de passe/), 'pw')
    await user.click(within(dialog).getByRole('button', { name: 'Approuver' }))
    expect(
      await within(dialog).findByText("La décision n'a pas pu être enregistrée. Vérifiez votre connexion et réessayez."),
    ).toBeInTheDocument()
  })

  it('shows the empty state when nothing is waiting', async () => {
    actions = []
    render(<AiActionsList highlight={null} />)
    expect(await screen.findByText('Aucune action en attente')).toBeInTheDocument()
  })

  it('shows a retry when the list fails to load', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
    render(<AiActionsList highlight={null} />)
    expect(await screen.findByText("Les actions n'ont pas pu être chargées")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Valider des écritures')).toBeInTheDocument()
  })
})
