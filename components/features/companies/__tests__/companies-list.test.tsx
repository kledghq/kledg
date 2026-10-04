import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import { CompaniesList } from '../companies-list'

// As the companies page passes them: through JSON, dates as ISO timestamps.
const alpha = {
  id: 'c1',
  name: 'Alpha SAS',
  slug: 'alpha',
  siren: '123456789',
  legalType: 'SAS' as const,
  closingDay: 31,
  closingMonth: 12,
  foundationDate: '2020-05-12T00:00:00.000Z',
  email: 'contact@alpha.fr',
  vatRegime: 'normal',
  corporateTaxRegime: 'simplified',
}
const beta = { id: 'c2', name: 'Beta', slug: null, siren: null, closingDay: 30, closingMonth: 6 }

const countText = (text: string) => (_: string, element: Element | null) =>
  element?.tagName === 'P' && element.textContent === text

const fetchMock = vi.fn<typeof fetch>()
const refreshEvents = vi.fn()

beforeEach(() => {
  fetchMock.mockImplementation(async (input, init) => {
    if (init?.method === 'PATCH') return Response.json({ ...alpha, ...JSON.parse(String(init.body)) })
    return Response.json({ success: true })
  })
  vi.stubGlobal('fetch', fetchMock)
  window.addEventListener('companies:refresh', refreshEvents)
})

afterEach(() => {
  window.removeEventListener('companies:refresh', refreshEvents)
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

function sent(method: string) {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method)
  return call ? { url: String(call[0]), body: call[1]?.body ? JSON.parse(String(call[1].body)) : undefined } : undefined
}

describe('CompaniesList', () => {
  it('lists each company with its link, legal form, grouped SIREN and closing date', () => {
    render(<CompaniesList companies={[alpha, beta]} />)
    expect(screen.getByText(countText('2 sociétés'))).toBeInTheDocument()
    const alphaRow = screen.getByRole('link', { name: /Alpha/ }).closest('li')!
    expect(screen.getByRole('link', { name: /Alpha/ })).toHaveAttribute('href', '/alpha')
    expect(within(alphaRow).getByRole('link', { name: 'Informations' })).toHaveAttribute('href', '/alpha/informations')
    expect(alphaRow).toHaveTextContent('SIREN 123 456 789 · clôture au 31 décembre')
    expect(within(alphaRow).getByTitle('Société par actions simplifiée')).toBeInTheDocument()
    // Without a slug, the id is the address.
    expect(screen.getByRole('link', { name: 'Beta' })).toHaveAttribute('href', '/c2')
    expect(screen.getByRole('link', { name: 'Beta' }).closest('li')).toHaveTextContent('clôture au 30 juin')
    expect(screen.queryByRole('link', { name: /Créer une société/ })).toBeNull()
  })

  it('invites an administrator to create the first company, and a member to ask for access', () => {
    const { unmount } = render(<CompaniesList companies={[]} canCreate />)
    expect(screen.getByRole('link', { name: 'Créer ma première société' })).toHaveAttribute('href', '/companies/new')
    expect(screen.getByRole('link', { name: /Créer une société/ })).toHaveAttribute('href', '/companies/new')
    unmount()
    render(<CompaniesList companies={[]} />)
    expect(screen.getByText(/Demandez à l'administrateur de l'instance/)).toBeInTheDocument()
  })

  it('opens the edit form filled with the company, foundation date included', async () => {
    const user = userEvent.setup()
    render(<CompaniesList companies={[alpha]} />)
    await user.click(screen.getByRole('button', { name: 'Modifier Alpha SAS' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/Nom/)).toHaveValue('Alpha SAS')
    expect(within(dialog).getByLabelText(/SIREN/)).toHaveValue('123456789')
    expect(within(dialog).getByLabelText('Jour de clôture')).toHaveValue(31)
    expect(within(dialog).getByLabelText('Mois de clôture')).toHaveTextContent('Décembre')
    expect(within(dialog).getByLabelText('Date de création de la société')).toHaveTextContent('12 mai 2020')
    // A member cannot archive nor delete.
    expect(within(dialog).queryByRole('button', { name: /Archiver/ })).toBeNull()
  })

  it('saves the changes with PATCH, sending the foundation date as a calendar day', async () => {
    const user = userEvent.setup()
    render(<CompaniesList companies={[alpha]} />)
    await user.click(screen.getByRole('button', { name: 'Modifier Alpha SAS' }))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText(/Nom/))
    await user.type(within(dialog).getByLabelText(/Nom/), 'Alpha Conseil')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Modifications enregistrées'))
    expect(sent('PATCH')?.url).toBe('/api/companies/c1')
    expect(sent('PATCH')?.body).toMatchObject({
      name: 'Alpha Conseil',
      siren: '123456789',
      closingDay: 31,
      closingMonth: 12,
      foundationDate: '2020-05-12',
      legalType: 'SAS',
      vatRegime: 'normal',
    })
    expect(refreshEvents).toHaveBeenCalled()
    expect(router.refresh).toHaveBeenCalled()
    expect(screen.getByRole('link', { name: /Alpha Conseil/ })).toBeInTheDocument()
  })

  it('validates the SIREN before saving', async () => {
    const user = userEvent.setup()
    render(<CompaniesList companies={[alpha]} />)
    await user.click(screen.getByRole('button', { name: 'Modifier Alpha SAS' }))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText(/SIREN/))
    await user.type(within(dialog).getByLabelText(/SIREN/), '12345')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    expect(await within(dialog).findByText('Le SIREN doit contenir 9 chiffres')).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText(/SIREN/))
    await user.type(within(dialog).getByLabelText(/SIREN/), '12345678A')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    expect(await within(dialog).findByText('Le SIREN doit contenir exactement 9 chiffres')).toBeInTheDocument()
    expect(sent('PATCH')).toBeUndefined()
  })

  it('toasts the error of a refused change', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({ error: 'Ce SIREN est déjà utilisé' }, { status: 409 }))
    render(<CompaniesList companies={[alpha]} />)
    await user.click(screen.getByRole('button', { name: 'Modifier Alpha SAS' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Ce SIREN est déjà utilisé'))
  })

  it('archives a company after confirmation (administrators)', async () => {
    const user = userEvent.setup()
    render(<CompaniesList companies={[alpha, beta]} canManage />)
    await user.click(screen.getByRole('button', { name: 'Modifier Alpha SAS' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Archiver/ }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText('Archiver « Alpha SAS » ?')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: 'Archiver' }))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Société archivée', {
        description: 'Elle est en lecture seule et ne figure plus dans les listes.',
      }),
    )
    expect(fetchMock).toHaveBeenCalledWith('/api/companies/c1/archive', { method: 'POST' })
    expect(screen.queryByRole('link', { name: /Alpha/ })).toBeNull()
    expect(screen.getByText(countText('1 société'))).toBeInTheDocument()
  })

  it('deletes a company only after the destructive confirmation', async () => {
    const user = userEvent.setup()
    render(<CompaniesList companies={[alpha]} canManage />)
    await user.click(screen.getByRole('button', { name: 'Modifier Alpha SAS' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Supprimer/ }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText('Supprimer « Alpha SAS » ?')).toBeInTheDocument()
    expect(within(confirm).getByText(/archivez-la plutôt/)).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Supprimer définitivement' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Société supprimée'))
    expect(fetchMock).toHaveBeenCalledWith('/api/companies/c1', { method: 'DELETE' })
    expect(screen.getByText('Aucune société')).toBeInTheDocument()
  })

  it('keeps the company when its deletion is refused', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({ error: 'La société a des écritures validées' }, { status: 409 }))
    render(<CompaniesList companies={[alpha]} canManage />)
    await user.click(screen.getByRole('button', { name: 'Modifier Alpha SAS' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Supprimer/ }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Supprimer définitivement' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('La société a des écritures validées'))
    expect(screen.getByRole('link', { name: /Alpha/, hidden: true })).toBeInTheDocument()
  })

  it('restores an archived company with DELETE on its archive', async () => {
    const user = userEvent.setup()
    render(
      <CompaniesList companies={[beta]} canManage archived={[{ id: 'c9', name: 'Gamma', siren: '987654321' }]} />,
    )
    const row = screen.getByText('Gamma').closest('li')!
    expect(row).toHaveTextContent('SIREN 987 654 321')
    await user.click(within(row).getByRole('button', { name: /Restaurer/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Société restaurée'))
    expect(fetchMock).toHaveBeenCalledWith('/api/companies/c9/archive', { method: 'DELETE' })
    expect(router.refresh).toHaveBeenCalled()
  })

  it('shows archived companies to administrators only', () => {
    render(<CompaniesList companies={[beta]} archived={[{ id: 'c9', name: 'Gamma' }]} />)
    expect(screen.queryByText('Sociétés archivées')).toBeNull()
  })
})
