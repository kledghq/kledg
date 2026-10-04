/**
 * "Échéances" settings card of the Informations page: what the deadline
 * calendar cannot guess (the CA3 day, CGI annexe IV art. 39; the acomptes
 * that depend on last year's amounts). Loads the settings, saves only what
 * changed with PUT, can be reverted, and is read only without the right.
 * fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from 'sonner'
import { DeadlineSettingsCard } from '../deadline-settings-card'

const SAVED = {
  vatFilingDay: null,
  vatCa3Frequency: 'auto',
  vatSimplifiedAcomptes: true,
  isAcomptes: true,
  cfeAcompte: false,
  das2: false,
  cvae: false,
  accountsFiledOnline: false,
}

let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'PUT') return respond(200, { settings: JSON.parse(String(init?.body)) })
    return respond(200, { settings: SAVED })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')

describe('deadline settings card', () => {
  it('shows the earliest CA3 day of the legal form when the day is not known (SA: the 23rd)', async () => {
    render(<DeadlineSettingsCard companyId="c1" legalType="SA" canEdit />)
    expect(await screen.findByRole('combobox', { name: 'Jour de déclaration de TVA' })).toHaveTextContent('Non renseigné (le 23, au plus tôt)')
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/companies/c1/deadline-settings')
    // Nothing changed yet: nothing to save
    expect(screen.getByRole('button', { name: /Enregistrer les paramètres/ })).toBeDisabled()
  })

  it('saves the CA3 day and the switches that changed, in one PUT of the whole settings', async () => {
    const user = userEvent.setup()
    render(<DeadlineSettingsCard companyId="c1" legalType="SARL" canEdit />)
    await user.click(await screen.findByRole('combobox', { name: 'Jour de déclaration de TVA' }))
    await user.click(await screen.findByRole('option', { name: 'Le 21' }))
    // IS of the reference year under 3 000 €: no acomptes (CGI art. 1668)
    await user.click(screen.getByRole('switch', { name: "Acomptes d'impôt sur les sociétés" }))
    await user.click(screen.getByRole('switch', { name: 'Déclaration des honoraires (DAS2)' }))
    await user.click(screen.getByRole('button', { name: /Enregistrer les paramètres/ }))

    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(String(puts()[0][0])).toBe('/api/companies/c1/deadline-settings')
    expect(JSON.parse(String(puts()[0][1]?.body))).toEqual({ ...SAVED, vatFilingDay: 21, isAcomptes: false, das2: true })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Paramètres des échéances enregistrés'))
    expect(screen.getByRole('button', { name: /Enregistrer les paramètres/ })).toBeDisabled()
  })

  it('reverts the changes not saved', async () => {
    const user = userEvent.setup()
    render(<DeadlineSettingsCard companyId="c1" canEdit />)
    const cfe = await screen.findByRole('switch', { name: 'Acompte de CFE au 15 juin' })
    await user.click(cfe)
    expect(cfe).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Annuler les modifications' }))
    expect(cfe).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'Annuler les modifications' })).not.toBeInTheDocument()
  })

  it('shows the refusal of the API and keeps the changes', async () => {
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'PUT'
        ? respond(403, { error: 'Votre rôle ne permet pas de modifier les paramètres de la société.' })
        : respond(200, { settings: SAVED }),
    )
    const user = userEvent.setup()
    render(<DeadlineSettingsCard companyId="c1" canEdit />)
    await user.click(await screen.findByRole('switch', { name: /Déclaration de valeur ajoutée/ }))
    await user.click(screen.getByRole('button', { name: /Enregistrer les paramètres/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Votre rôle ne permet pas de modifier les paramètres de la société.'))
    expect(screen.getByRole('switch', { name: /Déclaration de valeur ajoutée/ })).toBeChecked()
  })

  it('is read only without the right to change the settings', async () => {
    render(<DeadlineSettingsCard companyId="c1" canEdit={false} />)
    expect(await screen.findByRole('switch', { name: "Acomptes d'impôt sur les sociétés" })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Jour de déclaration de TVA' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Enregistrer les paramètres/ })).toBeDisabled()
  })

  it('offers to load again when the settings did not load', async () => {
    fetchMock.mockResolvedValueOnce(respond(500, { error: 'Erreur du serveur' }))
    const user = userEvent.setup()
    render(<DeadlineSettingsCard companyId="c1" canEdit />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Erreur du serveur')
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('switch', { name: "Acomptes d'impôt sur les sociétés" })).toBeChecked()
  })
})
