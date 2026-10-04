import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import { ShareholdersManagement, shareholderKindLabel } from '../shareholders-management'
import { shareholderSchema } from '../company-informations-schemas'

type Row = Record<string, unknown>

const marie: Row = {
  id: 'sh1',
  type: 'PHYSICAL',
  name: null,
  siret: null,
  sharePercentage: 33.33,
  numberOfShares: 333,
  capitalAmount: 333.3,
  companyShareholderId: null,
  personId: 'p1',
  person: { id: 'p1', firstName: 'Marie', name: 'Dupont', email: 'marie@acme.fr', phone: null, address: null },
}
const holding: Row = {
  id: 'sh2',
  type: 'LEGAL',
  name: null,
  siret: null,
  sharePercentage: 33.33,
  numberOfShares: null,
  capitalAmount: null,
  companyShareholderId: 'c-holding',
  personId: null,
  companyShareholder: { id: 'c-holding', name: 'Holding SAS', siret: '12345678900011', legalType: 'SAS' },
}
const external: Row = {
  id: 'sh3',
  type: 'LEGAL',
  name: 'Fonds Externe',
  siret: '98765432100022',
  sharePercentage: 33.34,
  numberOfShares: 1,
  capitalAmount: null,
  companyShareholderId: null,
  personId: null,
}

let shareholders: Row[]
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  shareholders = [marie, holding, external]
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url === '/api/companies') {
      return Response.json([
        { id: 'c1', name: 'Alpha', slug: 'alpha' },
        { id: 'c-holding', name: 'Holding SAS', slug: 'holding' },
      ])
    }
    if (url === '/api/companies/alpha/persons' && method === 'GET') {
      return Response.json([
        { id: 'p1', firstName: 'Marie', name: 'Dupont', email: 'marie@acme.fr' },
        { id: 'p2', firstName: 'Paul', name: 'Martin', email: null },
      ])
    }
    if (url === '/api/companies/alpha/shareholders' && method === 'GET') return Response.json(shareholders)
    if (url === '/api/companies/alpha/shareholders' && method === 'POST') {
      return Response.json({ id: 'sh-new', ...JSON.parse(String(init?.body)), person: null }, { status: 201 })
    }
    if (url.startsWith('/api/companies/alpha/shareholders/') && method === 'PATCH') {
      return Response.json({ ...marie, ...JSON.parse(String(init?.body)) })
    }
    if (url.startsWith('/api/companies/alpha/shareholders/') && method === 'DELETE') return Response.json({ success: true })
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

async function chooseOption(trigger: HTMLElement, name: string | RegExp) {
  const user = userEvent.setup()
  await user.click(trigger)
  await user.click(await screen.findByRole('option', { name }))
}

describe('ShareholdersManagement', () => {
  it('lists each shareholder with its kind, name, share and capital, and totals the shares exactly', async () => {
    render(<ShareholdersManagement companyId="alpha" />)
    const marieRow = (await screen.findByText('Marie Dupont')).closest('tr')!
    expect(within(marieRow).getByText('Personne physique')).toBeInTheDocument()
    expect(within(marieRow).getByText('Personne liée')).toBeInTheDocument()
    expect(marieRow).toHaveTextContent('33,33 %')
    expect(marieRow).toHaveTextContent('333 parts')
    expect(marieRow).toHaveTextContent('333,30 €')

    const holdingRow = screen.getByText('Holding SAS').closest('tr')!
    expect(within(holdingRow).getByText('Société')).toBeInTheDocument()
    expect(holdingRow).toHaveTextContent('SIRET : 12345678900011')
    expect(holdingRow).toHaveTextContent('Non renseigné')

    const externalRow = screen.getByText('Fonds Externe').closest('tr')!
    expect(within(externalRow).getByText('Personne morale')).toBeInTheDocument()
    expect(externalRow).toHaveTextContent('1 part')

    // 33,33 + 33,33 + 33,34 sums to exactly 100 %, not 99,99... or 100,00000001.
    expect(screen.getByText(/Total des participations/)).toHaveTextContent('Total des participations : 100 %')
  })

  it('shows the empty state when there is no shareholder', async () => {
    shareholders = []
    render(<ShareholdersManagement companyId="alpha" />)
    expect(await screen.findByText('Aucun actionnaire enregistré')).toBeInTheDocument()
  })

  it('names the shareholder in the confirmation before deleting it', async () => {
    const user = userEvent.setup()
    render(<ShareholdersManagement companyId="alpha" />)
    const row = (await screen.findByText('Marie Dupont')).closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Supprimer' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Supprimer Marie Dupont des actionnaires ?')).toBeInTheDocument()
    expect(sent('DELETE')).toBeUndefined()
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }))
    await waitFor(() => expect(screen.queryByText('Marie Dupont')).toBeNull())
    expect(sent('DELETE')?.url).toBe('/api/companies/alpha/shareholders/sh1')
    expect(toast.success).toHaveBeenCalledWith('Actionnaire supprimé avec succès')
    expect(screen.getByText(/Total des participations/)).toHaveTextContent('66,67 %')
  })

  it('keeps the shareholder when the deletion is refused', async () => {
    const user = userEvent.setup()
    render(<ShareholdersManagement companyId="alpha" />)
    const row = (await screen.findByText('Fonds Externe')).closest('tr')!
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Accès refusé' }, { status: 403 }))
    await user.click(within(row).getByRole('button', { name: 'Supprimer' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Supprimer Fonds Externe des actionnaires ?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Accès refusé'))
    expect(screen.getByText('Fonds Externe')).toBeInTheDocument()
  })

  it('adds a natural person shareholder with the share and its exact POST body', async () => {
    const user = userEvent.setup()
    render(<ShareholdersManagement companyId="alpha" />)
    await screen.findByText('Marie Dupont')
    await user.click(screen.getByRole('button', { name: 'Ajouter un actionnaire' }))
    const dialog = await screen.findByRole('dialog')
    await chooseOption(within(dialog).getByLabelText(/Personne \*/), 'Paul Martin')
    await user.clear(within(dialog).getByLabelText(/Pourcentage de participation/))
    await user.type(within(dialog).getByLabelText(/Pourcentage de participation/), '25.5')
    await user.type(within(dialog).getByLabelText('Nombre de parts'), '255')
    await user.type(within(dialog).getByLabelText(/Montant du capital/), '255')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Actionnaire ajouté avec succès'))
    expect(sent('POST')).toEqual({
      url: '/api/companies/alpha/shareholders',
      body: {
        type: 'PHYSICAL',
        personId: 'p2',
        createPerson: false,
        sharePercentage: 25.5,
        numberOfShares: 255,
        capitalAmount: 255,
        notes: '',
      },
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('adds a shareholder whose number of shares and capital are left blank', async () => {
    const user = userEvent.setup()
    render(<ShareholdersManagement companyId="alpha" />)
    await screen.findByText('Marie Dupont')
    await user.click(screen.getByRole('button', { name: 'Ajouter un actionnaire' }))
    const dialog = await screen.findByRole('dialog')
    await chooseOption(within(dialog).getByLabelText(/Personne \*/), 'Paul Martin')
    await user.clear(within(dialog).getByLabelText(/Pourcentage de participation/))
    await user.type(within(dialog).getByLabelText(/Pourcentage de participation/), '10')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Actionnaire ajouté avec succès'))
    expect(sent('POST')?.body).toEqual({ type: 'PHYSICAL', personId: 'p2', createPerson: false, sharePercentage: 10, notes: '' })
  })

  it('says a person must be chosen for a natural person shareholder', async () => {
    const user = userEvent.setup()
    render(<ShareholdersManagement companyId="alpha" />)
    await screen.findByText('Marie Dupont')
    await user.click(screen.getByRole('button', { name: 'Ajouter un actionnaire' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Pourcentage de participation/), '10')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    expect(await within(dialog).findByText('Sélectionnez une personne, ou créez-en une avec le bouton +.')).toBeInTheDocument()
    expect(sent('POST')).toBeUndefined()
  })

  it('refuses a share above 100 % (the browser blocks the input above its max)', async () => {
    const user = userEvent.setup()
    render(<ShareholdersManagement companyId="alpha" />)
    await screen.findByText('Marie Dupont')
    await user.click(screen.getByRole('button', { name: 'Ajouter un actionnaire' }))
    const dialog = await screen.findByRole('dialog')
    await chooseOption(within(dialog).getByLabelText(/Personne \*/), 'Paul Martin')
    await user.clear(within(dialog).getByLabelText(/Pourcentage de participation/))
    await user.type(within(dialog).getByLabelText(/Pourcentage de participation/), '120')
    expect(within(dialog).getByLabelText(/Pourcentage de participation/)).toBeInvalid()
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    expect(sent('POST')).toBeUndefined()
    expect(shareholderSchema.safeParse({ type: 'PHYSICAL', personId: 'p2', sharePercentage: 120 }).error?.issues[0]?.message).toBe(
      'Le pourcentage doit être entre 0 et 100',
    )
  })

  it('adds an external legal entity by name and SIRET, and requires the name', async () => {
    const user = userEvent.setup()
    render(<ShareholdersManagement companyId="alpha" />)
    await screen.findByText('Marie Dupont')
    await user.click(screen.getByRole('button', { name: 'Ajouter un actionnaire' }))
    const dialog = await screen.findByRole('dialog')
    await chooseOption(within(dialog).getByLabelText(/Type \*/), 'Personne morale')
    await user.clear(within(dialog).getByLabelText(/Pourcentage de participation/))
    await user.type(within(dialog).getByLabelText(/Pourcentage de participation/), '40')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    expect(await within(dialog).findByText('La raison sociale est requise.')).toBeInTheDocument()
    expect(sent('POST')).toBeUndefined()

    await user.type(within(dialog).getByLabelText(/Raison sociale/), 'Fonds Beta')
    await user.type(within(dialog).getByLabelText('SIRET'), '11122233300044')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Actionnaire ajouté avec succès'))
    expect(sent('POST')?.body).toEqual({
      type: 'LEGAL',
      name: 'Fonds Beta',
      siret: '11122233300044',
      sharePercentage: 40,
      notes: '',
      createPerson: false,
    })
  })

  it('offers the other companies of the instance as shareholder, never the company itself', async () => {
    const user = userEvent.setup()
    render(<ShareholdersManagement companyId="alpha" />)
    await screen.findByText('Marie Dupont')
    await user.click(screen.getByRole('button', { name: 'Ajouter un actionnaire' }))
    const dialog = await screen.findByRole('dialog')
    await chooseOption(within(dialog).getByLabelText(/Type \*/), 'Personne morale')
    await user.click(within(dialog).getByLabelText(/Société actionnaire/))
    expect(await screen.findByRole('option', { name: 'Holding SAS' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Alpha' })).toBeNull()
    await user.click(screen.getByRole('option', { name: 'Holding SAS' }))
    // A company of the instance needs no name nor SIRET.
    expect(within(dialog).queryByLabelText(/Raison sociale/)).toBeNull()
    expect(within(dialog).queryByLabelText('SIRET')).toBeNull()
    await user.clear(within(dialog).getByLabelText(/Pourcentage de participation/))
    await user.type(within(dialog).getByLabelText(/Pourcentage de participation/), '60')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(sent('POST')).toBeDefined())
    expect(sent('POST')?.body).toMatchObject({ type: 'LEGAL', companyShareholderId: 'c-holding', sharePercentage: 60 })
  })

  it('edits a shareholder with PATCH, showing its current share', async () => {
    const user = userEvent.setup()
    render(<ShareholdersManagement companyId="alpha" />)
    const row = (await screen.findByText('Marie Dupont')).closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Modifier' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText("Modifier l'actionnaire")).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Participation actuelle : 33,33 % (333 parts), 333,30 €')
    expect(within(dialog).getByLabelText(/Pourcentage de participation/)).toHaveValue(33.33)

    await user.clear(within(dialog).getByLabelText(/Pourcentage de participation/))
    await user.type(within(dialog).getByLabelText(/Pourcentage de participation/), '50')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Actionnaire modifié avec succès'))
    expect(sent('PATCH')?.url).toBe('/api/companies/alpha/shareholders/sh1')
    expect(sent('PATCH')?.body).toMatchObject({ type: 'PHYSICAL', personId: 'p1', sharePercentage: 50, numberOfShares: 333 })
    await waitFor(() => expect(screen.getByText(/Total des participations/)).toHaveTextContent('116,67 %'))
  })

  it('labels the kind of each shareholder', () => {
    expect(shareholderKindLabel({ type: 'PHYSICAL', companyShareholderId: null, person: null })).toBe('Personne physique')
    expect(shareholderKindLabel({ type: 'LEGAL', companyShareholderId: 'c1', person: null })).toBe('Société')
    expect(shareholderKindLabel({ type: 'LEGAL', companyShareholderId: null, person: null })).toBe('Personne morale')
  })
})
