import { render, screen, waitFor, within } from '@testing-library/react'
import { ACCOUNT_CODE_MESSAGE } from '@/lib/accounting/account-code'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

// The account combobox is a Radix popover with a search list: a plain <select> keeps the tests on the mapping logic.
vi.mock('@/components/features/accounting/account-combobox', () => ({
  AccountCombobox: ({
    accounts,
    value,
    onValueChange,
    placeholder,
    showNoneOption,
    noneOptionLabel,
    id,
  }: {
    accounts: Array<{ id: string; code: string; label: string }>
    value?: string
    onValueChange?: (v: string) => void
    placeholder?: string
    showNoneOption?: boolean
    noneOptionLabel?: string
    id?: string
  }) => (
    <select
      id={id}
      aria-label={placeholder}
      data-testid="account-combobox"
      value={value ?? ''}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {showNoneOption ? <option value="none">{noneOptionLabel}</option> : null}
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.code} - {a.label}
        </option>
      ))}
    </select>
  ),
}))

import { AccountMappingComponent } from '../account-mapping'
import type { FECColumnMapping } from '@/lib/import/types'

const MAPPING: FECColumnMapping = {
  JournalCode: 'JournalCode',
  JournalLib: 'JournalLib',
  EcritureNum: 'EcritureNum',
  EcritureDate: 'EcritureDate',
  CompteNum: 'CompteNum',
  CompteLib: 'CompteLib',
  Debit: 'Debit',
  Credit: 'Credit',
}

const FEC = [
  'JournalCode\tJournalLib\tEcritureNum\tEcritureDate\tCompteNum\tCompteLib\tDebit\tCredit',
  'VT\tVentes\t1\t20260105\t41100000\tClients\t1200,00\t0,00',
  'VT\tVentes\t1\t20260105\t70600000\tPrestations\t0,00\t1000,00',
  'VT\tVentes\t1\t20260105\t44571000\tTVA collectée\t0,00\t200,00',
  'BQ\tBanque\t2\t20260110\t51200000\tBanque\t1200,00\t0,00',
  'BQ\tBanque\t2\t20260110\t41100000\tClients\t0,00\t1200,00',
].join('\n')

const EXISTING = [
  { id: 'acc-411', code: '411', label: 'Clients' },
  { id: 'acc-706', code: '706000', label: 'Prestations de services' },
  { id: 'acc-4457', code: '4457', label: 'Taxes sur le chiffre d’affaires collectées' },
  { id: 'acc-5121', code: '5121', label: 'Banque BNP' },
]
const JOURNALS = [
  { id: 'j-bq', code: 'BQ', label: 'Banque' },
  { id: 'j-ac', code: 'AC', label: 'Achats' },
]

const fetchMock = vi.fn()
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

interface Handlers {
  accounts?: () => Response
  journals?: () => Response
  checkExists?: (code: string) => boolean
  create?: (body: Record<string, unknown>) => Response
}

function install(handlers: Handlers = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/accounts/check-exists')) {
      const code = new URL(url, 'http://x').searchParams.get('code') ?? ''
      return json(200, { exists: handlers.checkExists?.(code) ?? false })
    }
    if (url.startsWith('/api/accounts') && init?.method === 'POST') {
      return handlers.create?.(JSON.parse(init.body as string)) ?? json(201, {})
    }
    if (url.startsWith('/api/accounts')) return handlers.accounts?.() ?? json(200, EXISTING)
    if (url.startsWith('/api/journals')) return handlers.journals?.() ?? json(200, JOURNALS)
    throw new Error(`unexpected ${url}`)
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function renderMapping(props: Partial<React.ComponentProps<typeof AccountMappingComponent>> = {}) {
  const onMappingComplete = vi.fn()
  const onCancel = vi.fn()
  render(
    <AccountMappingComponent
      fileContent={FEC}
      columnMapping={MAPPING}
      companyId="co-1"
      fiscalYearId="fy-26"
      fiscalYearYear={2026}
      onMappingComplete={onMappingComplete}
      onCancel={onCancel}
      {...props}
    />,
  )
  return { onMappingComplete, onCancel }
}

/** The table row of a FEC account code. */
const accountRow = (code: string) => screen.getByText(code, { selector: '.font-mono.font-semibold' }).closest('tr') as HTMLElement

describe('AccountMappingComponent', () => {
  it('matches file accounts to existing ones by code without trailing zeros, and counts the accounts to create', async () => {
    install()
    renderMapping()

    expect(screen.getByText('Chargement des comptes...')).toBeInTheDocument()
    expect(await screen.findByText(/2 nouveaux comptes seront créés\./)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/accounts?companyId=co-1&fiscalYearId=fy-26')
    expect(fetchMock).toHaveBeenCalledWith('/api/journals?companyId=co-1')

    // 41100000 and 411 are the same account once the trailing zeros are dropped (PCG art. 932-1 numbering)
    expect(within(accountRow('41100000')).getByText('Existant')).toBeInTheDocument()
    expect(within(accountRow('41100000')).getByText('Clients', { selector: '.ml-1' })).toBeInTheDocument()
    expect(within(accountRow('70600000')).getByText('Existant')).toBeInTheDocument()
    // 44571 is not 4457, and 512 is not 5121: new accounts
    expect(within(accountRow('44571000')).getByText('Nouveau')).toBeInTheDocument()
    expect(within(accountRow('51200000')).getByText('Nouveau')).toBeInTheDocument()
    // Sorted by code
    expect(screen.getAllByText(/^\d{8}$/, { selector: '.font-mono.font-semibold' }).map((el) => el.textContent)).toEqual([
      '41100000',
      '44571000',
      '51200000',
      '70600000',
    ])
  })

  it('passes the automatic matches, their short codes and the journals matched by code', async () => {
    const user = userEvent.setup()
    install()
    const { onMappingComplete } = renderMapping()
    await screen.findByText(/2 nouveaux comptes/)

    // BQ is found among the journals of the company; VT is left to be created
    const bq = screen.getByText('BQ', { selector: '.font-mono' }).closest('tr') as HTMLElement
    expect(within(bq).getByText('→ BQ - Banque')).toBeInTheDocument()
    const vt = screen.getByText('VT', { selector: '.font-mono' }).closest('tr') as HTMLElement
    expect(within(vt).getByRole('combobox')).toHaveTextContent('Créer ou garder tel quel')

    await user.click(screen.getByRole('button', { name: 'Confirmer et continuer' }))
    expect(onMappingComplete).toHaveBeenCalledWith({
      accountMapping: { '41100000': 'acc-411', '411': 'acc-411', '70600000': 'acc-706', '706': 'acc-706' },
      journalMapping: { BQ: 'j-bq' },
    })
  })

  it('redirects a new account to an existing one, and a journal to another journal', async () => {
    const user = userEvent.setup()
    install()
    const { onMappingComplete } = renderMapping()
    await screen.findByText(/2 nouveaux comptes/)

    await user.selectOptions(within(accountRow('51200000')).getByTestId('account-combobox'), 'acc-5121')
    expect(within(accountRow('51200000')).getByText('Redirigé')).toBeInTheDocument()
    expect(screen.getByText(/1 nouveau compte sera créé\./)).toBeInTheDocument()

    const vt = screen.getByText('VT', { selector: '.font-mono' }).closest('tr') as HTMLElement
    await user.click(within(vt).getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'AC - Achats' }))
    expect(within(vt).getByText('→ AC - Achats')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirmer et continuer' }))
    expect(onMappingComplete).toHaveBeenCalledWith({
      accountMapping: {
        '41100000': 'acc-411',
        '411': 'acc-411',
        '70600000': 'acc-706',
        '706': 'acc-706',
        '51200000': 'acc-5121',
        '512': 'acc-5121',
      },
      journalMapping: { BQ: 'j-bq', VT: 'j-ac' },
    })
  })

  it('takes a redirect and a journal choice back', async () => {
    const user = userEvent.setup()
    install()
    const { onMappingComplete } = renderMapping()
    await screen.findByText(/2 nouveaux comptes/)

    const select = within(accountRow('51200000')).getByTestId('account-combobox')
    await user.selectOptions(select, 'acc-5121')
    await user.selectOptions(select, 'none')
    expect(within(accountRow('51200000')).getByText('Nouveau')).toBeInTheDocument()

    const bq = screen.getByText('BQ', { selector: '.font-mono' }).closest('tr') as HTMLElement
    await user.click(within(bq).getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Créer ou garder tel quel' }))

    await user.click(screen.getByRole('button', { name: 'Confirmer et continuer' }))
    expect(onMappingComplete).toHaveBeenCalledWith({
      accountMapping: { '41100000': 'acc-411', '411': 'acc-411', '70600000': 'acc-706', '706': 'acc-706' },
      journalMapping: {},
    })
  })

  // Choosing "Créer" on an account matched automatically is shown as such, not as the match
  it('shows the create choice on an account matched automatically', async () => {
    const user = userEvent.setup()
    install()
    renderMapping()
    await screen.findByText(/2 nouveaux comptes/)
    const select = within(accountRow('41100000')).getByTestId('account-combobox')
    await user.selectOptions(select, 'none')
    expect(select).toHaveValue('none')
  })

  it('creates an account under a parent and maps the file account to it', async () => {
    const user = userEvent.setup()
    install({ create: (body) => json(201, { id: 'acc-new', code: body.code, label: body.label }) })
    const { onMappingComplete } = renderMapping()
    await screen.findByText(/2 nouveaux comptes/)

    await user.click(screen.getByRole('button', { name: 'Créer un compte pour 44571000' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Créez un nouveau compte pour mapper le compte FEC "44571000"')).toBeInTheDocument()
    // Prefilled from the file
    expect(within(dialog).getByLabelText('Code *')).toHaveValue('44571000')
    expect(within(dialog).getByLabelText('Libellé *')).toHaveValue('TVA collectée')

    // Choosing the parent prefills its code, which the user extends
    await user.selectOptions(within(dialog).getByTestId('account-combobox'), 'acc-4457')
    expect(within(dialog).getByLabelText('Code *')).toHaveValue('4457')
    expect(within(dialog).getByText(/Compte parent sélectionné/)).toHaveTextContent('4457 - Taxes sur le chiffre d’affaires collectées')
    await user.type(within(dialog).getByLabelText('Code *'), '1000')

    // The code is checked against the chart after a pause in typing
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/accounts/check-exists?code=44571000&companyId=co-1&fiscalYearId=fy-26'), {
      timeout: 2000,
    })
    await user.click(within(dialog).getByRole('button', { name: 'Créer le compte' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Compte créé avec succès'))
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(post?.[0]).toBe('/api/accounts')
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({
      code: '44571000',
      label: 'TVA collectée',
      parentId: 'acc-4457',
      companyId: 'co-1',
      fiscalYearId: 'fy-26',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(within(accountRow('44571000')).getByText('Redirigé')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirmer et continuer' }))
    expect(onMappingComplete.mock.calls[0][0].accountMapping).toMatchObject({ '44571000': 'acc-new', '44571': 'acc-new' })
  })

  it('requires a parent account', async () => {
    const user = userEvent.setup()
    install()
    renderMapping()
    await screen.findByText(/2 nouveaux comptes/)

    await user.click(screen.getByRole('button', { name: 'Créer un compte pour 51200000' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Créer le compte' }))
    expect(await within(dialog).findByText('Le compte parent est requis')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false)
  })

  it('validates the code format', async () => {
    const user = userEvent.setup()
    install()
    renderMapping()
    await screen.findByText(/2 nouveaux comptes/)

    await user.click(screen.getByRole('button', { name: 'Créer un compte pour 51200000' }))
    const dialog = await screen.findByRole('dialog')
    const code = within(dialog).getByLabelText('Code *')
    await user.clear(code)
    await user.type(code, '51a')
    await user.click(within(dialog).getByRole('button', { name: 'Créer le compte' }))
    expect((await within(dialog).findAllByText((text) => text.replace(/\s+/g, ' ') === ACCOUNT_CODE_MESSAGE.replace(/\s+/g, ' '))).length).toBeGreaterThan(0)
  })

  it('refuses a code that does not start with the parent code', async () => {
    const user = userEvent.setup()
    install()
    renderMapping()
    await screen.findByText(/2 nouveaux comptes/)

    await user.click(screen.getByRole('button', { name: 'Créer un compte pour 51200000' }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByTestId('account-combobox'), 'acc-411')
    const code = within(dialog).getByLabelText('Code *')
    await user.clear(code)
    await user.type(code, '51200000')
    await user.click(within(dialog).getByRole('button', { name: 'Créer le compte' }))

    // A sub-account extends the number of its parent (PCG art. 932-1 numbering)
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Le code du compte enfant doit commencer par le code du parent (411)'),
    )
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false)
  })

  it('refuses a code that already exists in the chart', async () => {
    const user = userEvent.setup()
    install({ checkExists: (code) => code === '5121' })
    renderMapping()
    await screen.findByText(/2 nouveaux comptes/)

    await user.click(screen.getByRole('button', { name: 'Créer un compte pour 51200000' }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByTestId('account-combobox'), 'acc-5121')
    expect(await within(dialog).findByText('Un compte avec ce numéro existe déjà', {}, { timeout: 2000 })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Créer le compte' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Un compte avec ce numéro existe déjà'))
  })

  it('shows the API error when the account cannot be created, and closes on Annuler', async () => {
    const user = userEvent.setup()
    install({ create: () => json(409, { error: 'Le compte 51200000 existe déjà.' }) })
    renderMapping()
    await screen.findByText(/2 nouveaux comptes/)

    await user.click(screen.getByRole('button', { name: 'Créer un compte pour 51200000' }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByTestId('account-combobox'), 'acc-5121')
    const code = within(dialog).getByLabelText('Code *')
    await user.clear(code)
    await user.type(code, '51210000')
    await user.click(within(dialog).getByRole('button', { name: 'Créer le compte' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Le compte 51200000 existe déjà.'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(within(accountRow('51200000')).getByText('Nouveau')).toBeInTheDocument()
  })

  it('works without a fiscal year and without any existing account or journal', async () => {
    const user = userEvent.setup()
    install({ accounts: () => json(500, {}), journals: () => json(500, {}) })
    const { onMappingComplete } = renderMapping({ fiscalYearId: undefined })

    expect(await screen.findByText(/4 nouveaux comptes seront créés\./)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/accounts?companyId=co-1')
    expect(screen.getAllByText('Nouveau')).toHaveLength(4)

    await user.click(screen.getByRole('button', { name: 'Confirmer et continuer' }))
    expect(onMappingComplete).toHaveBeenCalledWith({ accountMapping: {}, journalMapping: {} })
  })

  it('says when the account column finds nothing in the file, and cancels', async () => {
    const user = userEvent.setup()
    install()
    const { onCancel } = renderMapping({ columnMapping: { ...MAPPING, CompteNum: 'NumeroDeCompte' } })

    expect(await screen.findByText(/Aucun compte trouvé dans le fichier/)).toBeInTheDocument()
    expect(screen.getByText(/Aucun nouveau compte ne sera créé\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
