import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { TaxRegimeHistory } from '../tax-regime-history'

const ORIGINAL_TZ = process.env.TZ

type Regime = Record<string, unknown>

const vat: Regime[] = [
  {
    id: 'v2',
    regimeType: 'vat',
    regime: 'franchise',
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: null,
    notes: 'Passage en franchise',
    isVatExempt: true,
    vatExemptReason: 'Formation professionnelle continue',
    establishmentId: 'e1',
    establishment: { id: 'e1', siret: '12345678900011', name: 'Agence Lyon' },
  },
  {
    id: 'v1',
    regimeType: 'vat',
    regime: 'normal',
    startDate: '2024-01-01T00:00:00.000Z',
    endDate: '2025-12-31T00:00:00.000Z',
    notes: null,
    isVatExempt: false,
  },
]
const corporateTax: Regime[] = [
  { id: 'is1', regimeType: 'corporateTax', regime: 'simplified', startDate: '2024-01-01T00:00:00.000Z', endDate: null, notes: null },
]

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  process.env.TZ = 'Europe/Paris'
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url === '/api/companies/alpha/tax-regimes?regimeType=vat') return Response.json(vat)
    if (url === '/api/companies/alpha/tax-regimes?regimeType=corporateTax') return Response.json(corporateTax)
    if (url === '/api/companies/alpha/establishments') return Response.json([{ id: 'e1', siret: '12345678900011', name: 'Agence Lyon' }])
    if (method === 'POST' || method === 'PATCH' || method === 'DELETE') return Response.json({ success: true })
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

function sent(method: string) {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method)
  return call ? { url: String(call[0]), body: call[1]?.body ? JSON.parse(String(call[1].body)) : undefined } : undefined
}

async function choose(trigger: HTMLElement, name: string) {
  const user = userEvent.setup()
  await user.click(trigger)
  await user.click(await screen.findByRole('option', { name }))
}

const vatCard = () => screen.getByText('Historique des régimes de TVA').closest('[data-slot="card"]') as HTMLElement

describe('TaxRegimeHistory', () => {
  it('lists the VAT and corporate tax periods with labels, dates and exemptions', async () => {
    render(<TaxRegimeHistory companyId="alpha" />)
    const franchise = (await screen.findByText('Franchise en base')).closest('tr')!
    expect(franchise).toHaveTextContent('1 janvier 2026')
    expect(franchise).toHaveTextContent('En cours')
    expect(franchise).toHaveTextContent('Formation professionnelle continue')
    expect(franchise).toHaveTextContent('Établissement : Agence Lyon')
    const normal = within(vatCard()).getByText('Régime normal').closest('tr')!
    expect(normal).toHaveTextContent('31 décembre 2025')
    expect(within(normal).getByText('Non')).toBeInTheDocument()
    expect(screen.getByText('Régime simplifié').closest('tr')).toHaveTextContent('En cours')
  })

  it('shows the empty states', async () => {
    fetchMock.mockImplementation(async () => Response.json([]))
    render(<TaxRegimeHistory companyId="alpha" />)
    expect(await screen.findByText('Aucun régime de TVA enregistré')).toBeInTheDocument()
    expect(screen.getByText("Aucun régime d'IS enregistré")).toBeInTheDocument()
  })

  it('requires a regime and a start date before adding', async () => {
    const user = userEvent.setup()
    render(<TaxRegimeHistory companyId="alpha" />)
    await screen.findByText('Franchise en base')
    await user.click(within(vatCard()).getByRole('button', { name: /Ajouter un régime/ }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Ajouter' }))
    expect(toast.error).toHaveBeenCalledWith('Veuillez remplir tous les champs requis')
    expect(sent('POST')).toBeUndefined()
  })

  it('adds a VAT regime starting on the day picked, sent as a calendar day', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-04T10:00:00.000Z') })
    const user = userEvent.setup()
    render(<TaxRegimeHistory companyId="alpha" />)
    await screen.findByText('Franchise en base')
    await user.click(within(vatCard()).getByRole('button', { name: /Ajouter un régime/ }))
    const dialog = await screen.findByRole('dialog')
    await choose(within(dialog).getAllByRole('combobox')[1]!, 'Régime simplifié')
    await user.click(within(dialog).getByRole('button', { name: /Sélectionner la date de début/ }))
    await user.click(await screen.findByRole('button', { name: /(^|\s)1 octobre 2026/i }))
    await user.type(within(dialog).getByPlaceholderText('Notes optionnelles...'), 'Dépassement du seuil')
    await user.click(within(dialog).getByRole('button', { name: 'Ajouter' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Régime ajouté avec succès'))
    expect(sent('POST')).toEqual({
      url: '/api/companies/alpha/tax-regimes',
      body: {
        regimeType: 'vat',
        regime: 'simplified',
        startDate: '2026-10-01',
        notes: 'Dépassement du seuil',
        isVatExempt: false,
        vatExemptReason: null,
        establishmentId: null,
      },
    })
  })

  it('records a VAT exemption with its reason and establishment, and asks to specify "Autre"', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-04T10:00:00.000Z') })
    const user = userEvent.setup()
    render(<TaxRegimeHistory companyId="alpha" />)
    await screen.findByText('Franchise en base')
    await user.click(within(vatCard()).getByRole('button', { name: /Ajouter un régime/ }))
    const dialog = await screen.findByRole('dialog')
    await choose(within(dialog).getAllByRole('combobox')[1]!, 'Franchise en base')
    await user.click(within(dialog).getByRole('button', { name: /Sélectionner la date de début/ }))
    await user.click(await screen.findByRole('button', { name: /(^|\s)2 octobre 2026/i }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Exonération de TVA' }))
    const [, , reason, establishment] = within(dialog).getAllByRole('combobox')
    expect(reason).toHaveTextContent('Organisme de formation (avec attestation)')
    await choose(reason!, 'Autre (à préciser)')
    await choose(establishment!, 'Agence Lyon')

    await user.click(within(dialog).getByRole('button', { name: 'Ajouter' }))
    expect(toast.error).toHaveBeenCalledWith("Veuillez préciser la raison de l'exonération")
    expect(sent('POST')).toBeUndefined()

    await user.type(within(dialog).getByPlaceholderText("Précisez la raison de l'exonération"), 'Activité de location nue')
    await user.click(within(dialog).getByRole('button', { name: 'Ajouter' }))
    await waitFor(() => expect(sent('POST')).toBeDefined())
    expect(sent('POST')?.body).toMatchObject({
      regime: 'franchise',
      startDate: '2026-10-02',
      isVatExempt: true,
      vatExemptReason: 'Activité de location nue',
      establishmentId: 'e1',
    })
  })

  it('sends no exemption for a corporate tax regime', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-04T10:00:00.000Z') })
    const user = userEvent.setup()
    render(<TaxRegimeHistory companyId="alpha" />)
    await screen.findByText('Franchise en base')
    const isCard = screen.getByText("Historique des régimes d'IS").closest('[data-slot="card"]') as HTMLElement
    await user.click(within(isCard).getByRole('button', { name: /Ajouter un régime/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('checkbox', { name: 'Exonération de TVA' })).toBeNull()
    await choose(within(dialog).getAllByRole('combobox')[1]!, 'Micro-société')
    await user.click(within(dialog).getByRole('button', { name: /Sélectionner la date de début/ }))
    await user.click(await screen.findByRole('button', { name: /(^|\s)1 octobre 2026/i }))
    await user.click(within(dialog).getByRole('button', { name: 'Ajouter' }))
    await waitFor(() => expect(sent('POST')).toBeDefined())
    expect(sent('POST')?.body).toMatchObject({ regimeType: 'corporateTax', regime: 'micro', isVatExempt: false, vatExemptReason: null })
  })

  it.each(['Europe/Paris', 'America/Guadeloupe', 'Pacific/Kiritimati'])(
    'keeps the start date of an edited regime in %s',
    async (zone) => {
      process.env.TZ = zone
      const user = userEvent.setup()
      render(<TaxRegimeHistory companyId="alpha" />)
      const row = (await screen.findByText('Franchise en base')).closest('tr')!
      expect(row).toHaveTextContent('1 janvier 2026')
      await user.click(within(row).getByRole('button', { name: 'Modifier' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('Modifier le régime')).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: /1 janvier 2026/ })).toBeInTheDocument()
      expect(within(dialog).getAllByRole('combobox')[2]).toHaveTextContent('Formation professionnelle continue')
      await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Régime mis à jour avec succès'))
      expect(sent('PATCH')).toEqual({
        url: '/api/companies/alpha/tax-regimes',
        body: {
          id: 'v2',
          regime: 'franchise',
          startDate: '2026-01-01',
          notes: 'Passage en franchise',
          isVatExempt: true,
          vatExemptReason: 'Formation professionnelle continue',
          establishmentId: 'e1',
        },
      })
    },
  )

  it('deletes a regime only after confirmation', async () => {
    const user = userEvent.setup()
    render(<TaxRegimeHistory companyId="alpha" />)
    const row = (await screen.findByText('Régime simplifié')).closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Supprimer' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Supprimer ce régime ?')).toBeInTheDocument()
    expect(sent('DELETE')).toBeUndefined()
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Régime supprimé avec succès'))
    expect(sent('DELETE')?.url).toBe('/api/companies/alpha/tax-regimes?id=is1')
  })

  it('toasts the API error of a refused regime', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-04T10:00:00.000Z') })
    const user = userEvent.setup()
    render(<TaxRegimeHistory companyId="alpha" />)
    await screen.findByText('Franchise en base')
    fetchMock.mockImplementation(async (input, init) =>
      init?.method === 'POST' ? Response.json({ error: 'Un régime commence déjà à cette date' }, { status: 409 }) : Response.json([]),
    )
    await user.click(within(vatCard()).getByRole('button', { name: /Ajouter un régime/ }))
    const dialog = await screen.findByRole('dialog')
    await choose(within(dialog).getAllByRole('combobox')[1]!, 'Régime normal')
    await user.click(within(dialog).getByRole('button', { name: /Sélectionner la date de début/ }))
    await user.click(await screen.findByRole('button', { name: /(^|\s)1 octobre 2026/i }))
    await user.click(within(dialog).getByRole('button', { name: 'Ajouter' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Un régime commence déjà à cette date'))
  })
})
