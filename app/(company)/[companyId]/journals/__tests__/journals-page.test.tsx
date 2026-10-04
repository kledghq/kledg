/**
 * Journaux page: creating a journal (code normalized and checked before the
 * request), adding back the default journals, deleting one. fetch is mocked;
 * the requests the page sends are asserted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/journals',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from 'sonner'
import JournalsPage from '../page'

type Journal = { id: string; code: string; label: string; companyId: string }
let journals: Journal[]
let replies: Record<string, { status?: number; body: unknown }>
let fetchMock: ReturnType<typeof vi.fn>

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  journals = [
    { id: 'j-ac', code: 'AC', label: 'Achats', companyId: 'c1' },
    { id: 'j-bq', code: 'BQ', label: 'Banque', companyId: 'c1' },
  ]
  replies = {}
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`
    if (replies[key]) return respond(replies[key].status ?? 200, replies[key].body)
    if (key === 'GET /api/journals?companyId=c1') return respond(200, journals)
    return respond(404, { error: `unexpected ${key}` })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const requestsTo = (method: string, url: string) =>
  fetchMock.mock.calls.filter(([input, init]) => String(input) === url && (init?.method ?? 'GET') === method)

describe('journals page', () => {
  it('creates a journal with its code in upper case', async () => {
    replies['POST /api/journals'] = { status: 201, body: { id: 'j-bq2', code: 'BQ2', label: 'Banque 2', companyId: 'c1' } }
    const user = userEvent.setup()
    render(<JournalsPage />)
    await user.click(await screen.findByRole('button', { name: /Ajouter un journal/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Code/), 'bq2')
    await user.type(within(dialog).getByLabelText(/Libellé/), 'Banque 2')
    await user.click(within(dialog).getByRole('button', { name: 'Créer le journal' }))

    await waitFor(() => expect(requestsTo('POST', '/api/journals')).toHaveLength(1))
    expect(JSON.parse(String(requestsTo('POST', '/api/journals')[0][1]?.body))).toEqual({ companyId: 'c1', code: 'BQ2', label: 'Banque 2' })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Journal créé avec succès'))
  })

  it('refuses a one-letter code before sending anything', async () => {
    const user = userEvent.setup()
    render(<JournalsPage />)
    await user.click(await screen.findByRole('button', { name: /Ajouter un journal/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Code/), 'b')
    await user.type(within(dialog).getByLabelText(/Libellé/), 'Banque')
    await user.click(within(dialog).getByRole('button', { name: 'Créer le journal' }))

    expect(await within(dialog).findByText('Le code doit contenir 2 à 3 caractères (ex: BQ, AC, BQ2)')).toBeInTheDocument()
    expect(requestsTo('POST', '/api/journals')).toHaveLength(0)
  })

  it('shows the conflict returned by the API in the dialog', async () => {
    replies['POST /api/journals'] = { status: 409, body: { error: 'Un journal avec le code BQ existe déjà pour cette société' } }
    const user = userEvent.setup()
    render(<JournalsPage />)
    await user.click(await screen.findByRole('button', { name: /Ajouter un journal/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Code/), 'BQ')
    await user.type(within(dialog).getByLabelText(/Libellé/), 'Banque')
    await user.click(within(dialog).getByRole('button', { name: 'Créer le journal' }))
    expect(await within(dialog).findByText('Un journal avec le code BQ existe déjà pour cette société')).toBeInTheDocument()
  })

  it('adds back the missing default journals and lists the ones it created', async () => {
    replies['POST /api/journals/defaults'] = {
      body: {
        created: ['VE', 'OD', 'AN'],
        journals: [
          ...journals,
          { id: 'j-ve', code: 'VE', label: 'Ventes', companyId: 'c1' },
          { id: 'j-od', code: 'OD', label: 'Opérations diverses', companyId: 'c1' },
          { id: 'j-an', code: 'AN', label: 'À-nouveaux', companyId: 'c1' },
        ],
      },
    }
    const user = userEvent.setup()
    render(<JournalsPage />)
    await user.click(await screen.findByRole('button', { name: /Ajouter les journaux par défaut/ }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Journaux ajoutés : VE, OD, AN'))
    expect(JSON.parse(String(requestsTo('POST', '/api/journals/defaults')[0][1]?.body))).toEqual({ companyId: 'c1' })
    expect(screen.getByText('À-nouveaux')).toBeInTheDocument()
  })

  it('says so when every default journal already exists', async () => {
    replies['POST /api/journals/defaults'] = { body: { created: [], journals } }
    const user = userEvent.setup()
    render(<JournalsPage />)
    await user.click(await screen.findByRole('button', { name: /Ajouter les journaux par défaut/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Les journaux par défaut existent déjà'))
  })

  it('deletes a journal after confirmation and shows the refusal of a journal with entries', async () => {
    replies['DELETE /api/journals/j-bq'] = { status: 409, body: { error: 'Le journal BQ contient des écritures : il ne peut pas être supprimé.' } }
    const user = userEvent.setup()
    render(<JournalsPage />)
    await user.click(await screen.findByRole('button', { name: 'Supprimer le journal BQ' }))
    expect(requestsTo('DELETE', '/api/journals/j-bq')).toHaveLength(0)
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Supprimer' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Le journal BQ contient des écritures : il ne peut pas être supprimé.'))
    expect(requestsTo('DELETE', '/api/journals/j-bq')).toHaveLength(1)
  })
})
