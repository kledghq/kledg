import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EntryFormReconciliation, type ReconciliationAccount } from '../entry-form-reconciliation'
import type { ReconciliationContext } from '@/lib/reconciliation/types'

const ACCOUNTS: ReconciliationAccount[] = [
  { id: 'bank', code: '512000', label: 'Banque' },
  { id: 'supplies', code: '606100', label: 'Fournitures' },
  { id: 'vat', code: '445660', label: 'TVA déductible' },
]

const context = (overrides: Partial<ReconciliationContext> = {}): ReconciliationContext => ({
  transaction: {
    id: 'tx-1',
    date: '2026-03-05',
    amountCents: 12000,
    side: 'debit',
    label: 'CB PAPETERIE',
    reference: null,
    counterpartyName: 'Papeterie Martin',
    reconciled: false,
    reconciledWith: null,
    vatRatePercent: null,
    vatAmountCents: null,
  },
  bankLine: { debitCents: 0, creditCents: 12000 },
  bankAccount: { code: '512000', label: 'Banque' },
  fiscalYears: [
    { id: 'fy25', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31', isClosed: true },
    { id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false },
  ],
  fiscalYearId: 'fy26',
  suggestion: null,
  ...overrides,
})

const fetchMock = vi.fn()

function renderForm(ctx = context(), props: Partial<React.ComponentProps<typeof EntryFormReconciliation>> = {}) {
  const handlers = { onSaved: vi.fn(), onConflict: vi.fn(), onCancel: vi.fn() }
  render(
    <EntryFormReconciliation
      context={ctx}
      journals={[{ id: 'bq', code: 'BQ', label: 'Banque' }]}
      accountsFor={() => ACCOUNTS}
      loadAccounts={() => {}}
      hasNext
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

async function chooseAccount(user: ReturnType<typeof userEvent.setup>, lineIndex: number, search: string) {
  const combobox = screen.getAllByRole('combobox').filter((el) => el.tagName === 'INPUT')[lineIndex]
  await user.click(combobox)
  await user.type(combobox, search)
  const option = await screen.findByRole('option', { name: new RegExp(search) })
  await user.click(option)
}

const saveButton = () => screen.getByRole('button', { name: /^Enregistrer$/ })
const saveNextButton = () => screen.getByRole('button', { name: /Enregistrer et suivant/ })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EntryFormReconciliation', () => {
  it('shows the bank line locked, with its account, side and amount', () => {
    renderForm()
    const bankLine = screen.getByLabelText('Ligne bancaire verrouillée')
    expect(bankLine).toHaveTextContent('512000 - Banque')
    expect(bankLine).toHaveTextContent(/120,00\s€/)
    expect(within(bankLine).queryByRole('textbox')).toBeNull()
    expect(within(bankLine).queryByRole('combobox')).toBeNull()
  })

  it('blocks saving until every line has an account, without flagging a fresh form', async () => {
    const user = userEvent.setup()
    renderForm()
    // Not shown before the user works on the line or tries to save
    expect(screen.queryByText('Choisissez un compte.')).toBeNull()
    expect(saveButton()).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /afficher les erreurs/ }))
    expect(screen.getByText('Choisissez un compte.')).toBeInTheDocument()
    await chooseAccount(user, 0, '606100')
    expect(screen.queryByText('Choisissez un compte.')).toBeNull()
    expect(saveButton()).toBeEnabled()
  })

  it('shows what is missing when saving is attempted with the shortcut', async () => {
    renderForm()
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(await screen.findByText('Choisissez un compte.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows no error and keeps saving disabled while the accounts load', () => {
    renderForm(
      context({
        suggestion: {
          source: 'rule',
          title: 'Suggestion de la règle « Fournitures »',
          vatRatePercent: null,
          lines: [{ accountCode: '606100', accountLabel: 'Fournitures', debitCents: 12000, creditCents: 0, description: null }],
        },
      }),
      { accountsFor: () => undefined },
    )
    expect(screen.getByRole('status')).toHaveTextContent('Chargement du plan comptable')
    expect(screen.getByPlaceholderText('Chargement des comptes...')).toBeInTheDocument()
    expect(screen.queryByText('Choisissez un compte.')).toBeNull()
    expect(screen.queryByText(/n'existe pas dans l'exercice/)).toBeNull()
    expect(saveButton()).toBeDisabled()
    expect(saveNextButton()).toBeDisabled()
  })

  it('shows the imbalance and lets the user fix it with French amounts', async () => {
    const user = userEvent.setup()
    renderForm()
    await chooseAccount(user, 0, '606100')
    const debit = screen.getByLabelText('Débit de la ligne 1')
    await user.clear(debit)
    await user.type(debit, '100')
    expect(screen.getByText(/n'est pas équilibrée/)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Ajouter une ligne' }))
    await chooseAccount(user, 1, '445660')
    await user.type(screen.getByLabelText('Débit de la ligne 2'), '20,00')
    expect(screen.queryByText(/n'est pas équilibrée/)).toBeNull()
    expect(saveButton()).toBeEnabled()
  })

  it('refuses a date in a closed fiscal year', async () => {
    const user = userEvent.setup()
    renderForm()
    await chooseAccount(user, 0, '606100')
    const date = screen.getByLabelText('Date')
    await user.clear(date)
    await user.type(date, '31/12/2025')
    expect(screen.getByText(/L'exercice 2025 est clôturé/)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it('posts the counterpart lines once, even when clicked twice', async () => {
    const user = userEvent.setup()
    let resolve: (value: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)))
    const { onSaved } = renderForm()
    await chooseAccount(user, 0, '606100')

    fireEvent.click(saveButton())
    fireEvent.click(saveButton())
    fireEvent.click(saveNextButton())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/transactions/tx-1/reconcile')
    expect(JSON.parse(init.body)).toMatchObject({
      journalId: 'bq',
      date: '2026-03-05',
      lines: [{ accountId: 'supplies', debit: '120.00', credit: null }],
    })
    await waitFor(() => expect(saveButton()).toBeDisabled())

    resolve(new Response(JSON.stringify({ entryId: 'e1', entryNumber: '7' }), { status: 201 }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ entryId: 'e1', entryNumber: '7', status: 'draft' }, false))
  })

  it('saves and moves to the next transaction with Ctrl+Entrée', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ entryId: 'e1', entryNumber: '1' }), { status: 201 }))
    const { onSaved } = renderForm()
    await chooseAccount(user, 0, '606100')
    fireEvent.keyDown(screen.getByLabelText('Débit de la ligne 1'), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ entryId: 'e1', entryNumber: '1', status: 'draft' }, true))
  })

  it('reports a transaction reconciled meanwhile (409)', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Cette transaction est déjà rapprochée.' }), { status: 409 }))
    const { onConflict, onSaved } = renderForm()
    await chooseAccount(user, 0, '606100')
    await user.click(saveButton())
    await waitFor(() => expect(onConflict).toHaveBeenCalledWith('Cette transaction est déjà rapprochée.'))
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('shows the server validation error and lets the user retry', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Journal introuvable' }), { status: 404 }))
    renderForm()
    await chooseAccount(user, 0, '606100')
    await user.click(saveButton())
    expect(await screen.findByText('Journal introuvable')).toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
  })

  it('prefills the suggestion, marked as such, and can drop it', async () => {
    const user = userEvent.setup()
    renderForm(
      context({
        suggestion: {
          source: 'history',
          title: "Suggestion d'après le dernier rapprochement avec Papeterie Martin (05/02/2026)",
          vatRatePercent: 20,
          lines: [
            { accountCode: '606100', accountLabel: 'Fournitures', debitCents: 10000, creditCents: 0, description: null },
            { accountCode: '445660', accountLabel: 'TVA déductible', debitCents: 2000, creditCents: 0, description: null },
          ],
        },
      }),
    )
    expect(screen.getByText(/dernier rapprochement avec Papeterie Martin \(05\/02\/2026\), TVA 20 %/)).toBeInTheDocument()
    expect(screen.getAllByText('Suggestion')).toHaveLength(2)
    expect(screen.getByDisplayValue('606100 - Fournitures')).toBeInTheDocument()
    expect(screen.getByLabelText('Débit de la ligne 2')).toHaveValue('20,00')
    expect(saveButton()).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /Ignorer la suggestion/ }))
    expect(screen.queryAllByText('Suggestion')).toHaveLength(0)
    expect(screen.getByLabelText('Débit de la ligne 1')).toHaveValue('120,00')
    expect(saveButton()).toBeDisabled()
  })

  it('splits VAT with a template, keeping the chosen account', async () => {
    const user = userEvent.setup()
    renderForm()
    await chooseAccount(user, 0, '606100')
    await user.click(screen.getByRole('button', { name: 'Achat TVA 20 %' }))
    expect(screen.getByLabelText('Débit de la ligne 1')).toHaveValue('100,00')
    expect(screen.getByLabelText('Débit de la ligne 2')).toHaveValue('20,00')
    expect(screen.getByDisplayValue('445660 - TVA déductible')).toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
  })

  it('blocks saving when the company has no bank account', () => {
    renderForm(context({ bankAccount: null }))
    expect(screen.getAllByText(/Aucun compte bancaire 512/).length).toBeGreaterThan(0)
    expect(saveButton()).toBeDisabled()
  })
})
