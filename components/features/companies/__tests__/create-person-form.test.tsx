import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import { CreatePersonForm } from '../create-person-form'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockImplementation(async () =>
    Response.json([{ id: 'addr1', street: '12 rue de la Paix', street2: null, postalCode: '75002', city: 'Paris', country: 'FR' }]),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

describe('CreatePersonForm', () => {
  it('requires the first and last name', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    render(<CreatePersonForm companyId="alpha" onSubmit={onSubmit} onCancel={vi.fn()} loading={false} />)
    await user.click(screen.getByRole('button', { name: 'Créer' }))
    expect(await screen.findByText('Le prénom est requis')).toBeInTheDocument()
    expect(screen.getByText('Le nom est requis')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('creates a person without an address', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    render(<CreatePersonForm companyId="alpha" onSubmit={onSubmit} onCancel={vi.fn()} loading={false} />)
    await user.type(screen.getByLabelText(/Prénom/), 'Paul')
    await user.type(screen.getByLabelText(/^Nom/), 'Martin')
    await user.click(screen.getByRole('button', { name: 'Créer' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith({
      firstName: 'Paul',
      name: 'Martin',
      email: undefined,
      phone: undefined,
      photo: undefined,
      address: undefined,
    })
    await waitFor(() => expect(screen.getByLabelText(/Prénom/)).toHaveValue(''))
  })

  it('sends the address picked for the person', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    render(<CreatePersonForm companyId="alpha" onSubmit={onSubmit} onCancel={vi.fn()} loading={false} />)
    await user.type(screen.getByLabelText(/Prénom/), 'Paul')
    await user.type(screen.getByLabelText(/^Nom/), 'Martin')
    await user.type(screen.getByLabelText('Email'), 'paul@acme.fr')
    await user.type(screen.getByRole('combobox'), 'pa')
    await user.click(await screen.findByRole('option', { name: /12 rue de la Paix/ }))
    await user.click(screen.getByRole('button', { name: 'Créer' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'paul@acme.fr',
        address: { street: '12 rue de la Paix', postalCode: '75002', city: 'Paris', country: 'FR' },
      }),
    )
  })

  it('keeps what was typed when the creation fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {
      throw new Error('Refusé')
    })
    render(<CreatePersonForm companyId="alpha" onSubmit={onSubmit} onCancel={vi.fn()} loading={false} />)
    await user.type(screen.getByLabelText(/Prénom/), 'Paul')
    await user.type(screen.getByLabelText(/^Nom/), 'Martin')
    await user.click(screen.getByRole('button', { name: 'Créer' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(screen.getByLabelText(/Prénom/)).toHaveValue('Paul')
  })

  it('refuses a file that is not an image, or above 2 Mo', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const { container } = render(<CreatePersonForm companyId="alpha" onSubmit={vi.fn()} onCancel={vi.fn()} loading={false} />)
    const input = container.querySelector('#person-photo-input') as HTMLInputElement
    await user.upload(input, new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' }))
    expect(toast.error).toHaveBeenCalledWith('Veuillez sélectionner un fichier image')
    await user.upload(input, new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))
    expect(toast.error).toHaveBeenCalledWith("L'image ne doit pas dépasser 2 Mo")
  })
})
