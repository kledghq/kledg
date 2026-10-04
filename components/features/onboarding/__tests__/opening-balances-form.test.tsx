import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OpeningBalancesForm } from '../opening-balances-form'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/components/features/accounting/account-combobox', () => ({
  AccountCombobox: ({
    accounts,
    value,
    onValueChange,
    excludeAccountIds = [],
  }: {
    accounts: Array<{ id: string; code: string; label: string }>
    value: string
    onValueChange: (v: string) => void
    excludeAccountIds?: string[]
  }) => (
    <select aria-label="Ajouter un compte" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">Ajouter un compte (classes 1 à 5)</option>
      {accounts
        .filter((a) => !excludeAccountIds.includes(a.id))
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.code}
          </option>
        ))}
    </select>
  ),
}))

const COMPANY = 'co-1'
const FY = { id: 'fy-2025', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31', isClosed: false }

const accounts = [
  { id: 'a-1013', code: '1013', label: 'Capital souscrit, appelé, versé' },
  { id: 'a-164', code: '164', label: 'Emprunts auprès des établissements de crédit' },
  { id: 'a-512', code: '512', label: 'Banques' },
  { id: 'a-2183', code: '2183', label: 'Matériel de bureau et informatique' },
]

const json = (data: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 400, json: async () => data }) as unknown as Response

let fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>

function installFetch(opts: { target?: unknown; post?: Response; targetOk?: boolean } = {}) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    if (url === `/api/companies/${COMPANY}/opening-balances` && init?.method === 'POST') {
      return opts.post ?? json({ id: 'entry-an' })
    }
    if (url === `/api/companies/${COMPANY}/opening-balances`) {
      return json({ target: opts.target === undefined ? { fiscalYear: FY, existingEntry: null } : opts.target }, opts.targetOk ?? true)
    }
    if (url === `/api/accounts?companyId=${COMPANY}&fiscalYearId=fy-2025`) return json(accounts)
    return json({}, false)
  })
  vi.stubGlobal('fetch', fetchMock)
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ')

function postedBody() {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
  return call ? JSON.parse(String(call[1]?.body)) : undefined
}

async function renderForm(canEdit = true) {
  render(<OpeningBalancesForm companyId={COMPANY} canEdit={canEdit} />)
  const user = userEvent.setup()
  return { user }
}

describe('OpeningBalancesForm', () => {
  beforeEach(() => {
    pushMock.mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lists the preset lines of the accounts the chart has, in the balance sheet order', async () => {
    installFetch()
    await renderForm()

    expect(await screen.findByLabelText('Débit du compte 1013')).toBeInTheDocument()
    // Presets without a matching account (1061, 401, 411...) are left out.
    const debitFields = screen.getAllByLabelText(/^Débit du compte/).map((el) => el.getAttribute('aria-label'))
    expect(debitFields).toEqual(['Débit du compte 1013', 'Débit du compte 164', 'Débit du compte 512'])
    expect(screen.getByText('Solde bancaire au jour de la clôture (relevé).')).toBeInTheDocument()
    expect(norm(screen.getByText(/Ils seront enregistrés/).textContent)).toContain('le 1 janvier 2025')
    expect(screen.getByText('Saisissez les soldes du dernier bilan.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enregistrer les à-nouveaux' })).toBeDisabled()
  })

  it('shows the gap until debits equal credits, then books the balanced entry in cents', async () => {
    installFetch()
    const { user } = await renderForm()

    await user.type(await screen.findByLabelText('Débit du compte 512'), '12 500,50')
    // Code de commerce art. L123-19 and PCG art. 112-2: the opening balance
    // sheet is the previous closing one, so the entry must balance.
    expect(norm(screen.getByText(/Écart de/).textContent)).toBe('Écart de 12 500,50 € : il manque cette somme au crédit.')

    await user.click(screen.getByRole('button', { name: 'Enregistrer les à-nouveaux' }))
    expect(screen.getByText("À corriger avant d'enregistrer")).toBeInTheDocument()
    expect(screen.getByText('Saisissez au moins deux soldes (par exemple la banque et le capital).')).toBeInTheDocument()
    expect(
      screen.getByText('Le total des débits doit égaler le total des crédits : le bilan d’ouverture doit être équilibré.')
    ).toBeInTheDocument()
    expect(postedBody()).toBeUndefined()

    await user.type(screen.getByLabelText('Crédit du compte 1013'), '10000')
    // Typing clears the previous submit errors.
    expect(screen.queryByText("À corriger avant d'enregistrer")).not.toBeInTheDocument()
    expect(norm(screen.getByText(/Écart de/).textContent)).toBe('Écart de 2 500,50 € : il manque cette somme au crédit.')

    await user.type(screen.getByLabelText('Crédit du compte 164'), '2500.50')
    expect(screen.getByText('Le bilan d’ouverture est équilibré.')).toBeInTheDocument()
    const totals = screen.getByText('Total').closest('tr') as HTMLElement
    expect(norm(totals.textContent)).toBe('Total12 500,50 €12 500,50 €')

    await user.click(screen.getByRole('button', { name: 'Enregistrer les à-nouveaux' }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/${COMPANY}/entries/entry-an`))
    expect(postedBody()).toEqual({
      lines: [
        { accountCode: '1013', debitCents: 0, creditCents: 1_000_000 },
        { accountCode: '164', debitCents: 0, creditCents: 250_050 },
        { accountCode: '512', debitCents: 1_250_050, creditCents: 0 },
      ],
      validate: false,
    })
    expect(toast.success).toHaveBeenCalledWith('À-nouveaux enregistrés en brouillon')
  })

  it('tells which side is short when credits exceed debits', async () => {
    installFetch()
    const { user } = await renderForm()
    await user.type(await screen.findByLabelText('Crédit du compte 1013'), '1000')
    await user.type(screen.getByLabelText('Débit du compte 512'), '400')
    expect(norm(screen.getByText(/Écart de/).textContent)).toBe('Écart de 600,00 € : il manque cette somme au débit.')
  })

  it('refuses a line with both a debit and a credit', async () => {
    installFetch()
    const { user } = await renderForm()
    await user.type(await screen.findByLabelText('Débit du compte 512'), '100')
    await user.type(screen.getByLabelText('Crédit du compte 512'), '50')
    await user.type(screen.getByLabelText('Crédit du compte 1013'), '50')
    await user.click(screen.getByRole('button', { name: 'Enregistrer les à-nouveaux' }))
    expect(screen.getByText('Ligne 2 : un solde est soit au débit, soit au crédit.')).toBeInTheDocument()
    expect(postedBody()).toBeUndefined()
  })

  it('adds another balance sheet account, removes a line, and validates the entry at once', async () => {
    installFetch()
    const { user } = await renderForm()
    await screen.findByLabelText('Débit du compte 512')

    await user.selectOptions(screen.getByLabelText('Ajouter un compte'), 'a-2183')
    expect(screen.getByLabelText('Débit du compte 2183')).toBeInTheDocument()
    // An account already listed is no longer offered.
    expect(screen.queryByRole('option', { name: '2183' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retirer le compte 164' }))
    expect(screen.queryByLabelText('Débit du compte 164')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Débit du compte 2183'), '1500')
    await user.type(screen.getByLabelText('Crédit du compte 1013'), '1500')
    await user.click(screen.getByRole('checkbox', { name: "Valider l'écriture tout de suite" }))
    await user.click(screen.getByRole('button', { name: 'Enregistrer les à-nouveaux' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('À-nouveaux enregistrés et validés'))
    expect(postedBody()).toEqual({
      lines: [
        { accountCode: '1013', debitCents: 0, creditCents: 150_000 },
        { accountCode: '2183', debitCents: 150_000, creditCents: 0 },
      ],
      validate: true,
    })
  })

  it('shows the API error and stays on the page', async () => {
    installFetch({ post: json({ error: "Les à-nouveaux de l'exercice 2025 sont déjà saisis." }, false) })
    const { user } = await renderForm()
    await user.type(await screen.findByLabelText('Débit du compte 512'), '100')
    await user.type(screen.getByLabelText('Crédit du compte 1013'), '100')
    await user.click(screen.getByRole('button', { name: 'Enregistrer les à-nouveaux' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Les à-nouveaux de l'exercice 2025 sont déjà saisis."))
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('is read only for a role that cannot book entries', async () => {
    installFetch()
    await renderForm(false)
    expect(await screen.findByLabelText('Débit du compte 512')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Enregistrer les à-nouveaux' })).not.toBeInTheDocument()
    expect(screen.getByText('Votre rôle permet de consulter cette page, pas de saisir des écritures.')).toBeInTheDocument()
  })

  it('points to the existing entry once the opening balances are booked', async () => {
    installFetch({ target: { fiscalYear: FY, existingEntry: { id: 'e-1', entryNumber: 'AN-1', status: 'validated' } } })
    await renderForm()
    expect(await screen.findByText("Les à-nouveaux de l'exercice 2025 sont saisis")).toBeInTheDocument()
    // PCG art. 1031-3: a validated entry is corrected by a reversal, not edited.
    expect(
      screen.getByText(/^L.écriture n° AN-1 est validée\s: une erreur se corrige par une écriture de contre-passation\.$/)
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: "Voir l'écriture" })).toHaveAttribute('href', `/${COMPANY}/entries/e-1`)
  })

  it('says a closed fiscal year can no longer take opening balances', async () => {
    installFetch({ target: { fiscalYear: { ...FY, isClosed: true }, existingEntry: null } })
    await renderForm()
    expect(await screen.findByText("L'exercice 2025 est clôturé")).toBeInTheDocument()
  })

  it('asks to create a fiscal year when there is none', async () => {
    installFetch({ target: null })
    await renderForm()
    expect(await screen.findByRole('link', { name: 'Créer un exercice' })).toHaveAttribute('href', `/${COMPANY}/fiscal-years`)
  })

  it('offers a retry when loading fails', async () => {
    installFetch({ targetOk: false })
    const { user } = await renderForm()
    expect(await screen.findByText("Les informations de l'exercice n'ont pas pu être chargées. Réessayez.")).toBeInTheDocument()

    installFetch()
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByLabelText('Débit du compte 512')).toBeInTheDocument()
  })
})
