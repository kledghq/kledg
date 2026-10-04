import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm, useWatch } from 'react-hook-form'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Address } from '@/lib/utils/address'

import { AddressSelector } from '../address-selector'
import { AddressForm, getDefaultAddressValue } from '../address-form'

type Values = { addressId?: string | null; address?: Address | null; headquarters?: Address | null }

function Harness({
  defaults = {},
  children,
}: {
  defaults?: Values
  children: React.ReactNode
}) {
  const methods = useForm<Values>({ defaultValues: defaults })
  return (
    <FormProvider {...methods}>
      {children}
      <Show />
    </FormProvider>
  )
}

function Show() {
  const values = useWatch<Values>()
  return <output data-testid="values">{JSON.stringify(values)}</output>
}

const values = () => JSON.parse(screen.getByTestId('values').textContent ?? '{}') as Values

const saved = { id: 'addr1', street: '12 rue de la Paix', street2: null, postalCode: '75002', city: 'Paris', country: 'FR' }

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.startsWith('/api/addresses?')) return Response.json([saved])
    if (url.startsWith('/api/addresses/addr1?')) return Response.json(saved)
    if (url === '/api/addresses' && init?.method === 'POST') return Response.json({ id: 'addr-new' }, { status: 201 })
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('AddressSelector storing an id', () => {
  it('searches the company addresses after two characters and stores the chosen id', async () => {
    const user = userEvent.setup()
    render(
      <Harness>
        <AddressSelector companyId="alpha co" fieldPrefix="addressId" label="Adresse" />
      </Harness>,
    )
    const input = screen.getByRole('combobox')
    await user.click(input)
    expect(await screen.findByText('Tapez au moins 2 caractères pour rechercher')).toBeInTheDocument()
    await user.type(input, 'pa')
    const option = await screen.findByRole('option', { name: /12 rue de la Paix/ })
    expect(fetchMock).toHaveBeenCalledWith('/api/addresses?companyId=alpha%20co&search=pa&limit=10')
    await user.click(option)
    expect(values().addressId).toBe('addr1')
    expect(input).toHaveAttribute('placeholder', expect.stringContaining('12 rue de la Paix'))
  })

  it('loads the label of an address already set, scoped to the company, and clears it', async () => {
    const user = userEvent.setup()
    render(
      <Harness defaults={{ addressId: 'addr1' }}>
        <AddressSelector companyId="alpha" fieldPrefix="addressId" />
      </Harness>,
    )
    await waitFor(() =>
      expect(screen.getByRole('combobox')).toHaveAttribute('placeholder', expect.stringContaining('75002 Paris')),
    )
    expect(fetchMock).toHaveBeenCalledWith('/api/addresses/addr1?companyId=alpha')
    await user.click(screen.getByTitle("Effacer l'adresse"))
    expect(values().addressId).toBeNull()
    expect(screen.queryByTitle("Effacer l'adresse")).toBeNull()
  })

  it('creates a new address for the company when none matches, then stores its id', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).startsWith('/api/addresses?')) return Response.json([])
      if (init?.method === 'POST') return Response.json({ id: 'addr-new' }, { status: 201 })
      return new Response(null, { status: 404 })
    })
    render(
      <Harness>
        <AddressSelector companyId="alpha" fieldPrefix="addressId" />
      </Harness>,
    )
    await user.type(screen.getByRole('combobox'), 'xyz')
    await user.click(await screen.findByRole('button', { name: /Créer une nouvelle adresse/ }))
    expect(screen.getByText('Nouvelle adresse')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Rue et numéro/), '1 place du Marché')
    await user.type(screen.getByLabelText(/Code postal/), '69001')
    await user.type(screen.getByLabelText(/Ville/), 'Lyon')
    await user.click(screen.getByRole('button', { name: "Enregistrer l'adresse" }))

    await waitFor(() => expect(values().addressId).toBe('addr-new'))
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(post[0]).toBe('/api/addresses')
    expect(JSON.parse(String(post[1]?.body))).toEqual({
      street: '1 place du Marché',
      postalCode: '69001',
      city: 'Lyon',
      country: 'FR',
      companyId: 'alpha',
    })
    expect(screen.getByRole('combobox')).toHaveAttribute('placeholder', expect.stringContaining('1 place du Marché'))
  })

  it('says what is missing instead of saving an incomplete new address', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async () => Response.json([]))
    render(
      <Harness>
        <AddressSelector companyId="alpha" fieldPrefix="addressId" />
      </Harness>,
    )
    await user.type(screen.getByRole('combobox'), 'xyz')
    await user.click(await screen.findByRole('button', { name: /Créer une nouvelle adresse/ }))
    await user.type(screen.getByLabelText(/Rue et numéro/), '1 place du Marché')
    await user.click(screen.getByRole('button', { name: "Enregistrer l'adresse" }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Renseignez la rue, le code postal et la ville.')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('shows the API error when the new address cannot be saved', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === 'POST') return Response.json({ error: 'Code postal invalide' }, { status: 400 })
      return Response.json([])
    })
    render(
      <Harness>
        <AddressSelector companyId="alpha" fieldPrefix="addressId" />
      </Harness>,
    )
    await user.type(screen.getByRole('combobox'), 'xyz')
    await user.click(await screen.findByRole('button', { name: /Créer une nouvelle adresse/ }))
    await user.type(screen.getByLabelText(/Rue et numéro/), '1 place du Marché')
    await user.type(screen.getByLabelText(/Code postal/), '6')
    await user.type(screen.getByLabelText(/Ville/), 'Lyon')
    await user.click(screen.getByRole('button', { name: "Enregistrer l'adresse" }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Code postal invalide')
    expect(values().addressId).toBeUndefined()
    // The form stays open to correct the address.
    expect(screen.getByText('Nouvelle adresse')).toBeInTheDocument()
  })

  it('goes back to the search when the new address is cancelled', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async () => Response.json([saved]))
    render(
      <Harness>
        <AddressSelector companyId="alpha" fieldPrefix="addressId" />
      </Harness>,
    )
    await user.type(screen.getByRole('combobox'), 'pa')
    await user.click(await screen.findByRole('option', { name: /Créer une nouvelle adresse/ }))
    expect(screen.getByText('Nouvelle adresse')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })
})

describe('AddressSelector storing an address object', () => {
  it('stores the chosen address itself', async () => {
    const user = userEvent.setup()
    render(
      <Harness>
        <AddressSelector companyId="alpha" fieldPrefix="address" />
      </Harness>,
    )
    await user.type(screen.getByRole('combobox'), 'pa')
    await user.click(await screen.findByRole('option', { name: /12 rue de la Paix/ }))
    expect(values().address).toEqual({ street: '12 rue de la Paix', postalCode: '75002', city: 'Paris', country: 'FR' })
  })
})

describe('AddressForm', () => {
  it('edits the nested fields of its prefix and shows the required marks', async () => {
    const user = userEvent.setup()
    render(
      <Harness defaults={{ headquarters: getDefaultAddressValue(null, 'BE') }}>
        <AddressForm fieldPrefix="headquarters" required label="Siège" />
      </Harness>,
    )
    expect(screen.getByText('Siège')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Rue et numéro/), '5 avenue Louise')
    await user.type(screen.getByLabelText(/Code postal/), '1050')
    await user.type(screen.getByLabelText(/Ville/), 'Bruxelles')
    expect(screen.getByRole('combobox')).toHaveTextContent('Belgique (BE)')
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Luxembourg (LU)' }))
    expect(values().headquarters).toMatchObject({
      street: '5 avenue Louise',
      postalCode: '1050',
      city: 'Bruxelles',
      country: 'LU',
    })
  })

  it('shows the nested error messages of the form', () => {
    const errors = { address: { city: { type: 'required', message: 'La ville est requise' } } }
    const defaultValues = { address: getDefaultAddressValue(null) }
    function WithErrors() {
      const methods = useForm<Values>({ defaultValues, errors })
      return (
        <FormProvider {...methods}>
          <AddressForm />
        </FormProvider>
      )
    }
    render(<WithErrors />)
    expect(screen.getByText('La ville est requise')).toBeInTheDocument()
    expect(screen.getByLabelText(/Ville/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/Rue et numéro/)).toHaveAttribute('aria-invalid', 'false')
  })

  it('refuses to render outside a form', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<AddressForm />)).toThrow(/requires either a `control` prop or to be used within a FormProvider/)
    vi.mocked(console.error).mockRestore()
  })

  it('fills the default value from an existing address', () => {
    expect(
      getDefaultAddressValue({ street: '1 rue A', street2: null, postalCode: '75001', city: 'Paris', country: '' }, 'FR'),
    ).toEqual({ street: '1 rue A', street2: '', postalCode: '75001', city: 'Paris', country: 'FR' })
  })
})
