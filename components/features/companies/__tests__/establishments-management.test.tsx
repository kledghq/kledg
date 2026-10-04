import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import { EstablishmentsManagement } from '../establishments-management'

const head = {
  id: 'e1',
  companyId: 'alpha',
  siret: '12345678900011',
  siren: '123456789',
  name: 'Siège',
  address: { street: '12 rue de la Paix', postalCode: '75002', city: 'Paris', country: 'FR' },
  addressId: 'addr1',
  activityCode: '6201Z',
  isMain: true,
  isActive: true,
  notes: null,
  isTrainingOrganization: true,
  trainingActivityDeclarationNumber: '11 75 12345 75',
  trainingActivityDeclarationDate: '2025-03-15T00:00:00.000Z',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
}
const closed = {
  ...head,
  id: 'e2',
  siret: '12345678900029',
  name: null,
  address: null,
  addressId: null,
  activityCode: null,
  isMain: false,
  isActive: false,
  isTrainingOrganization: false,
  trainingActivityDeclarationNumber: null,
  trainingActivityDeclarationDate: null,
}

let establishments: Array<Record<string, unknown>>
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  establishments = [head, closed]
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url === '/api/companies/alpha/establishments' && method === 'GET') return Response.json(establishments)
    if (url.startsWith('/api/addresses/addr1')) return Response.json({ id: 'addr1', ...head.address, street2: null })
    if (method === 'POST') return Response.json({ id: 'e3' }, { status: 201 })
    if (method === 'PATCH' || method === 'DELETE') return Response.json({ success: true })
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

function sent(method: string) {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method)
  return call ? { url: String(call[0]), body: call[1]?.body ? JSON.parse(String(call[1].body)) : undefined } : undefined
}

describe('EstablishmentsManagement', () => {
  it('lists each establishment with its address, status and training organization number', async () => {
    render(<EstablishmentsManagement companyId="alpha" />)
    const headRow = (await screen.findByText('12345678900011')).closest('tr')!
    expect(headRow).toHaveTextContent('Siège')
    expect(headRow).toHaveTextContent('12 rue de la Paix')
    expect(headRow).toHaveTextContent('6201Z')
    expect(within(headRow).getByText('Principal')).toBeInTheDocument()
    expect(within(headRow).getByText('Oui')).toBeInTheDocument()
    expect(headRow).toHaveTextContent('NDA : 11 75 12345 75')
    const closedRow = screen.getByText('12345678900029').closest('tr')!
    expect(within(closedRow).getByText('Inactif')).toBeInTheDocument()
    expect(within(closedRow).getByText('Non')).toBeInTheDocument()
  })

  it('shows the empty state and toasts a load failure', async () => {
    establishments = []
    const { unmount } = render(<EstablishmentsManagement companyId="alpha" />)
    expect(await screen.findByText(/Aucun établissement/)).toBeInTheDocument()
    unmount()
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
    render(<EstablishmentsManagement companyId="alpha" />)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Erreur lors du chargement des établissements'))
  })

  it('requires a SIRET of exactly 14 digits', async () => {
    const user = userEvent.setup()
    render(<EstablishmentsManagement companyId="alpha" />)
    await screen.findByText('12345678900011')
    await user.click(screen.getByRole('button', { name: /Ajouter un établissement/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/SIRET/), '1234567890')
    await user.click(within(dialog).getByRole('button', { name: /Créer/ }))
    expect(await within(dialog).findByText('Le SIRET doit contenir 14 chiffres')).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText(/SIRET/))
    await user.type(within(dialog).getByLabelText(/SIRET/), '1234567890123A')
    await user.click(within(dialog).getByRole('button', { name: /Créer/ }))
    expect(await within(dialog).findByText('Le SIRET doit contenir exactement 14 chiffres')).toBeInTheDocument()
    expect(sent('POST')).toBeUndefined()
  })

  it('creates an establishment with its exact POST body, then reloads the list', async () => {
    const user = userEvent.setup()
    render(<EstablishmentsManagement companyId="alpha" />)
    await screen.findByText('12345678900011')
    await user.click(screen.getByRole('button', { name: /Ajouter un établissement/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/SIRET/), '98765432100017')
    await user.type(within(dialog).getByLabelText("Nom de l'établissement"), 'Agence Lyon')
    await user.type(within(dialog).getByLabelText('Code APE/NAF'), '8559A')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Organisme de formation' }))
    await user.type(within(dialog).getByLabelText("Numéro de déclaration d'activité"), '84 69 00000 69')
    await user.click(within(dialog).getByRole('button', { name: /Créer/ }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Établissement créé avec succès'))
    expect(sent('POST')).toEqual({
      url: '/api/companies/alpha/establishments',
      body: {
        companyId: 'alpha',
        siret: '98765432100017',
        name: 'Agence Lyon',
        addressId: null,
        activityCode: '8559A',
        isMain: false,
        isActive: true,
        notes: '',
        isTrainingOrganization: true,
        trainingActivityDeclarationNumber: '84 69 00000 69',
        trainingActivityDeclarationDate: null,
      },
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/companies/alpha/establishments' && !init?.method)).toHaveLength(2)
  })

  it('edits an establishment without changing its SIRET, keeping its declaration date', async () => {
    const user = userEvent.setup()
    render(<EstablishmentsManagement companyId="alpha" />)
    const row = (await screen.findByText('12345678900011')).closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Modifier' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/SIRET/)).toBeDisabled()
    expect(within(dialog).getByText('Le SIRET ne peut pas être modifié après création')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: "Date de déclaration d'activité" })).toHaveTextContent('15 mars 2025')

    await user.click(within(dialog).getByRole('checkbox', { name: 'Établissement actif' }))
    await user.click(within(dialog).getByRole('button', { name: /Modifier/ }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Établissement modifié avec succès'))
    expect(sent('PATCH')?.url).toBe('/api/companies/alpha/establishments/e1')
    expect(sent('PATCH')?.body).toMatchObject({
      siret: '12345678900011',
      addressId: 'addr1',
      isMain: true,
      isActive: false,
      trainingActivityDeclarationDate: '2025-03-15',
    })
  })

  it('names the establishment in the confirmation before deleting it', async () => {
    const user = userEvent.setup()
    render(<EstablishmentsManagement companyId="alpha" />)
    const row = (await screen.findByText('12345678900029')).closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Supprimer' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText("Supprimer l'établissement 12345678900029 ?")).toBeInTheDocument()
    expect(sent('DELETE')).toBeUndefined()
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Établissement supprimé avec succès'))
    expect(sent('DELETE')?.url).toBe('/api/companies/alpha/establishments/e2')
  })

  it('toasts the API error of a refused creation', async () => {
    const user = userEvent.setup()
    render(<EstablishmentsManagement companyId="alpha" />)
    await screen.findByText('12345678900011')
    fetchMock.mockImplementation(async (input, init) =>
      init?.method === 'POST' ? Response.json({ error: 'Ce SIRET existe déjà' }, { status: 409 }) : Response.json(establishments),
    )
    await user.click(screen.getByRole('button', { name: /Ajouter un établissement/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/SIRET/), '12345678900011')
    await user.click(within(dialog).getByRole('button', { name: /Créer/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Ce SIRET existe déjà'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
