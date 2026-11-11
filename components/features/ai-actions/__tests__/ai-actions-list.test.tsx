import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { AiActionsList, requesterName } from '../ai-actions-list'

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
    // The name an OAuth client chose is shown as data (KLEDG-R3-MCP-12; the text matcher turns non-breaking spaces into spaces).
    expect(screen.getAllByText(/demandée par l'assistant « Claude » le/).length).toBeGreaterThan(0)
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

describe('requesterName', () => {
  it('quotes the name of the assistant, without invisible characters, and cuts it short', () => {
    expect(requesterName('Kledg')).toBe("l'assistant «\u00a0Kledg\u00a0»")
    expect(requesterName('Kl\u202Eedg\u200B')).toBe("l'assistant «\u00a0Kledg\u00a0»")
    expect(requesterName(null)).toBe('un assistant')
    expect(requesterName('x'.repeat(100))).toHaveLength("l'assistant «\u00a0".length + 60 + 2)
  })
})

describe('readable preview of a bulk action', () => {
  it('lists the rules of run_rules with their accounts, transactions and the assistant that created one', async () => {
    actions = [
      action({
        id: 'rules',
        tool: 'run_rules',
        args: {},
        preview: {
          processed: 43,
          wouldApply: 42,
          rulesTotal: 2,
          rulesChangedByAssistant: 1,
          rules: [
            { ruleId: 'r1', name: 'Virements Martin', journalCode: 'BQ', accounts: ['455'], transactions: 40, byAssistant: { change: 'created', tool: 'create_rule', assistant: 'Claude', at: '2026-10-03T09:58:00.000Z' } },
            { ruleId: 'r2', name: 'Frais bancaires', journalCode: 'BQ', accounts: ['627'], transactions: 2, byAssistant: null },
          ],
        },
      }),
    ]
    render(<AiActionsList highlight={null} />)
    expect(await screen.findByText('Virements Martin')).toBeInTheDocument()
    expect(screen.getByText('40 transactions')).toBeInTheDocument()
    expect(screen.getByText('455')).toBeInTheDocument()
    expect(screen.getByText(/Créée par l'assistant «.Claude.» le/)).toBeInTheDocument()
    expect(screen.getByText('1 créée ou modifiée par un assistant')).toBeInTheDocument()
    expect(screen.getByText('Frais bancaires')).toBeInTheDocument()
  })

  it('lists the transaction and entry pairs of auto_match, with the total', async () => {
    actions = [
      action({
        id: 'match',
        tool: 'bulk_reconcile',
        args: { action: 'auto_match' },
        preview: {
          action: 'auto_match',
          pairsTotal: 51,
          pairs: [{ transaction: { id: 't1', date: '2025-04-02', label: 'VIR MARTIN', amount: 250, side: 'debit' }, entry: { id: 'e1', number: 'BQ-0001', date: '2025-04-02', description: 'Fournisseur Martin' } }],
        },
      }),
    ]
    render(<AiActionsList highlight={null} />)
    expect(await screen.findByText('Rapprochements qui seront faits (51)')).toBeInTheDocument()
    expect(screen.getByText('VIR MARTIN')).toBeInTheDocument()
    expect(screen.getByText('Fournisseur Martin', { exact: false, selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('Les 1 premiers sont listés.')).toBeInTheDocument()
  })
})
