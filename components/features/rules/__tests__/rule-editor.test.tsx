import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

const push = vi.fn()
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ companyId: 'c1' }),
  useSearchParams: () => search,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

// Plain <select> instead of the cmdk autocomplete, so tests pick accounts directly.
vi.mock('@/components/features/accounting/account-combobox', () => ({
  AccountCombobox: ({
    accounts,
    value,
    onValueChange,
  }: {
    accounts: Array<{ id: string; code: string; label: string }>
    value?: string
    onValueChange?: (v: string) => void
  }) => (
    <select data-testid="account-combobox" value={value} onChange={(e) => onValueChange?.(e.target.value)}>
      <option value="none">Aucun compte</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.code} - {a.label}
        </option>
      ))}
    </select>
  ),
}))

import { RuleEditor, type RuleEditorProps } from '../rule-editor'
import { RuleEditorPage } from '../rule-editor-page'
import { newRuleState, savedRuleState, priorityPresetOf, defaultVatRateSource, transactionVatOf, type SavedRule } from '../rule-form'
import { PREVIEW_DEBOUNCE_MS } from '../rule-preview'

const accounts = [
  { id: 'a-512101', code: '512101', label: 'Banque Qonto' },
  { id: 'a-626000', code: '626000', label: 'Frais postaux et télécommunications' },
  { id: 'a-706000', code: '706000', label: 'Prestations de services' },
  { id: 'a-445662', code: '445662', label: 'TVA déductible intracommunautaire' },
  { id: 'a-445660', code: '445660', label: 'TVA déductible sur ABS' },
  { id: 'a-445200', code: '445200', label: 'TVA due intracommunautaire' },
  { id: 'a-445710', code: '445710', label: 'TVA collectée' },
]
const journals = [
  { id: 'j-bq', code: 'BQ', label: 'Banque' },
  { id: 'j-od', code: 'OD', label: 'Opérations diverses' },
]

const transactions = [
  { id: 't1', date: '2026-09-28T00:00:00.000Z', label: 'ADOBE *CREATIVE CLOUD', reference: null, side: 'debit', amount: 71.99, counterpartyName: 'Adobe', vatAmount: '12.00', vatRate: null, status: 'completed' },
  { id: 't2', date: '2026-08-28T00:00:00.000Z', label: 'ADOBE *CREATIVE CLOUD', reference: null, side: 'debit', amount: 71.99, counterpartyName: 'Adobe', vatAmount: null, vatRate: null, status: 'completed' },
  { id: 't3', date: '2026-09-02T00:00:00.000Z', label: 'LOYER BUREAUX', reference: null, side: 'debit', amount: 900, counterpartyName: 'SCI Lumen', vatAmount: null, vatRate: null, status: 'completed' },
]

const balanced = {
  entryLines: [
    { account: { code: '626000', label: 'Frais' }, debit: 59.99, credit: 0, description: 'HT', vatInfo: { type: 'deductible', rate: 20, amount: 12 } },
    { account: { code: '445660', label: 'TVA déductible' }, debit: 12, credit: 0, description: 'TVA', vatInfo: { type: 'deductible', rate: 20, amount: 12 } },
    { account: { code: '512101', label: 'Banque' }, debit: 0, credit: 71.99, description: 'Paiement' },
  ],
  totalDebit: 71.99,
  totalCredit: 71.99,
  balanced: true,
}

const fetchMock = vi.fn()
let simulateResponse: () => Response = () => Response.json(balanced)
let saveResponse: () => Response = () => Response.json({ rule: { id: 'r-new' } })

function calls(fragment: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith(fragment))
}
function bodyOf(call: unknown[]) {
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>
}
function saveCalls() {
  return fetchMock.mock.calls.filter(([url, init]) => String(url).startsWith('/api/transaction-rules') && ['POST', 'PUT'].includes((init as RequestInit | undefined)?.method ?? '') && !String(url).includes('simulate') && !String(url).includes('duplicate'))
}

beforeEach(() => {
  search = new URLSearchParams()
  simulateResponse = () => Response.json(balanced)
  saveResponse = () => Response.json({ rule: { id: 'r-new' } })
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/transactions?')) return Response.json({ transactions })
    if (url === '/api/transaction-rules/simulate') return simulateResponse()
    if (url.startsWith('/api/transaction-rules') && (init?.method === 'POST' || init?.method === 'PUT')) return saveResponse()
    return Response.json({})
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

function renderEditor(props: Partial<RuleEditorProps> = {}) {
  return render(
    <RuleEditor companyId="c1" ruleId={null} initial={newRuleState()} accounts={accounts} journals={journals} bankProvidesVat={false} {...props} />,
  )
}

const lines = () => screen.queryAllByTestId('rule-entry-line')
const conditionRows = () => screen.queryAllByTestId('rule-condition')

async function pickIn(user: UserEvent, container: HTMLElement, label: string | RegExp, option: string) {
  await user.click(within(container).getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

async function save(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
}

describe('rule editor page, layout', () => {
  it('shows every section at once, as fieldsets, with the preview and no tabs', async () => {
    renderEditor()
    expect(screen.getByRole('heading', { level: 1, name: 'Nouvelle règle' })).toBeInTheDocument()
    for (const name of ['Général', 'Conditions', 'Écriture proposée', 'Options']) {
      expect(screen.getByRole('group', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('complementary', { name: 'Aperçu de la règle' })).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: "Règles d'affectation" })).toHaveAttribute('href', '/c1/rules')
    // Options are switches with one short line each
    expect(screen.getByRole('switch', { name: 'Règle active' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: "Créer automatiquement l'écriture" })).toHaveAttribute('aria-checked', 'false')
  })

  it('titles an existing rule with its name and offers Supprimer and Dupliquer', () => {
    renderEditor({ ruleId: 'r1', initial: { ...newRuleState(), name: 'Adobe' } })
    expect(screen.getByRole('heading', { level: 1, name: 'Adobe' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dupliquer' })).toBeInTheDocument()
  })
})

describe('rule editor page, priority', () => {
  it('maps the presets to the priorities the engine compares (higher wins)', () => {
    expect(priorityPresetOf(10)).toBe('high')
    expect(priorityPresetOf(0)).toBe('normal')
    expect(priorityPresetOf(-10)).toBe('low')
    expect(priorityPresetOf(3)).toBeNull()
  })

  it('saves the number of the chosen preset, Normale (0) by default', async () => {
    const user = userEvent.setup()
    renderEditor({
      initial: newRuleState({
        name: 'R',
        conditions: [{ id: 'c', conditionType: 'label', operator: 'contains', value: 'X' }],
        entryLines: [{ id: 'l', accountId: 'a-626000', lineType: 'debit', amountType: 'full', order: 0 }],
      }),
    })
    const group = screen.getByRole('group', { name: 'Priorité' })
    expect(within(group).getByRole('radio', { name: 'Normale' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(group).getByRole('radio', { name: 'Haute' }))
    await save(user)
    await waitFor(() => expect(saveCalls()).toHaveLength(1))
    expect(bodyOf(saveCalls()[0]).priority).toBe(10)
    expect(push).toHaveBeenCalledWith('/c1/rules')
  })

  it('keeps a priority that matches no preset, shown in Avancé', async () => {
    const user = userEvent.setup()
    renderEditor({ ruleId: 'r1', initial: { ...newRuleState(), name: 'R', priority: 3 } })
    const group = screen.getByRole('group', { name: 'Priorité' })
    for (const radio of within(group).getAllByRole('radio')) expect(radio).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('Priorité personnalisée : 3.')).toBeInTheDocument()
    const exact = screen.getByRole('spinbutton', { name: 'Priorité exacte' })
    expect(exact).toHaveValue(3)
    await user.click(within(group).getByRole('radio', { name: 'Basse' }))
    expect(exact).toHaveValue(-10)
  })
})

describe('rule editor page, conditions', () => {
  it('adds and removes conditions, read as sentences', async () => {
    const user = userEvent.setup()
    renderEditor()
    expect(screen.getByText(/Aucune condition définie/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ajouter une condition' }))
    await user.type(screen.getByRole('textbox', { name: 'Valeur de la condition 1' }), 'Adobe')
    expect(screen.getByRole('group', { name: /^Condition 1\s:\sLibellé contient\s«\sAdobe\s»$/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ajouter une condition' }))
    await pickIn(user, conditionRows()[1], 'Champ de la condition 2', 'Montant')
    await pickIn(user, conditionRows()[1], 'Opérateur de la condition 2', 'Entre')
    await user.type(screen.getByRole('spinbutton', { name: 'Minimum de la condition 2' }), '50')
    await user.type(screen.getByRole('spinbutton', { name: 'Maximum de la condition 2' }), '100')
    expect(screen.getByRole('group', { name: /^Condition 2\s:\sMontant entre 50\s€ et 100\s€$/ })).toBeInTheDocument()
    // AND is said once, rows are joined by "et"
    expect(screen.getByText('Une transaction est reconnue quand toutes les conditions sont remplies.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Supprimer la condition 1' }))
    expect(conditionRows()).toHaveLength(1)
    expect(screen.queryByDisplayValue('Adobe')).not.toBeInTheDocument()
  })

  it('offers only "equals" and a list of values for the side, clearing the previous value', async () => {
    const user = userEvent.setup()
    renderEditor({ initial: newRuleState({ conditions: [{ id: 'c0', conditionType: 'label', operator: 'startsWith', value: 'VIR' }] }) })
    await pickIn(user, conditionRows()[0], 'Champ de la condition 1', 'Sens (débit/crédit)')
    expect(screen.getByRole('combobox', { name: 'Opérateur de la condition 1' })).toHaveTextContent('Égal à')
    await pickIn(user, conditionRows()[0], 'Valeur de la condition 1', 'Crédit')
    expect(screen.getByRole('group', { name: /^Condition 1\s:\sSens égal à\s«\sCrédit\s»$/ })).toBeInTheDocument()
  })
})

describe('rule editor page, preview', () => {
  it('counts the recent transactions the conditions recognise and shows the entry for the latest one', async () => {
    const user = userEvent.setup()
    renderEditor({
      bankProvidesVat: true,
      initial: newRuleState({
        conditions: [{ id: 'c', conditionType: 'counterparty', operator: 'contains', value: 'adobe' }],
        entryLines: [
          { id: 'l0', accountId: 'a-626000', lineType: 'debit', amountType: 'full', order: 0, vatType: 'deductible', vatRateSource: 'transaction', vatRate: 20, vatAccountId: 'a-445660' },
        ],
      }),
    })
    expect(await screen.findByTestId('rule-preview-count')).toHaveTextContent('2 transactions reconnues sur 90 jours.')
    const examples = within(screen.getByRole('list', { name: 'Exemples de transactions reconnues' })).getAllByRole('button')
    expect(examples).toHaveLength(2)
    expect(examples[0]).toHaveAttribute('aria-pressed', 'true')
    expect(examples[0]).toHaveTextContent(/TVA détectée 12,00\s€/)
    expect(examples[1]).toHaveTextContent('Pas de TVA détectée')

    await waitFor(() => expect(calls('/api/transaction-rules/simulate')).toHaveLength(1))
    const body = bodyOf(calls('/api/transaction-rules/simulate')[0])
    // The latest matching transaction, with the VAT the bank detected
    expect(body.transactionExample).toEqual({ amount: 71.99, side: 'debit', label: 'ADOBE *CREATIVE CLOUD', vatAmount: 12 })
    expect(body.companyId).toBe('c1')
    expect(await screen.findByTestId('rule-preview-vat')).toHaveTextContent(/TVA comptabilisée : 12,00\s€ \(détectée par la banque\)/)

    // The older one has no detected VAT: the fallback rate applies
    simulateResponse = () => Response.json(balanced)
    await user.click(examples[1])
    await waitFor(() => expect(calls('/api/transaction-rules/simulate')).toHaveLength(2))
    expect(bodyOf(calls('/api/transaction-rules/simulate')[1]).transactionExample).toEqual({ amount: 71.99, side: 'debit', label: 'ADOBE *CREATIVE CLOUD' })
    expect(await screen.findByTestId('rule-preview-vat')).toHaveTextContent('taux de secours, la banque n’a pas détecté de TVA')
  })

  it('simulates once after a pause in the edits, not on every keystroke', async () => {
    const user = userEvent.setup()
    renderEditor({
      initial: newRuleState({ entryLines: [{ id: 'l0', accountId: 'a-626000', lineType: 'debit', amountType: 'full', order: 0 }] }),
    })
    await waitFor(() => expect(calls('/api/transaction-rules/simulate')).toHaveLength(1))
    // No transaction recognised: a manual example of 100 € in debit, as the former Simulation tab
    expect(bodyOf(calls('/api/transaction-rules/simulate')[0]).transactionExample).toEqual({ amount: 100, side: 'debit', label: 'Transaction exemple' })

    await user.type(screen.getByRole('textbox', { name: /Libellé/ }), 'Abonnement mensuel')
    await waitFor(() => expect(calls('/api/transaction-rules/simulate')).toHaveLength(2))
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_DEBOUNCE_MS * 2))
    expect(calls('/api/transaction-rules/simulate')).toHaveLength(2)
    expect((bodyOf(calls('/api/transaction-rules/simulate')[1]).ruleData as { entryLines: Array<{ description: string }> }).entryLines[0].description).toBe(
      'Abonnement mensuel',
    )
  })

  it('shows the API error of a failed simulation in the preview', async () => {
    simulateResponse = () => Response.json({ error: 'transactionExample avec amount et side requis' }, { status: 400 })
    renderEditor({ initial: newRuleState({ entryLines: [{ id: 'l0', accountId: 'a-626000', lineType: 'debit', amountType: 'full', order: 0 }] }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('transactionExample avec amount et side requis')
  })
})

describe('rule editor page, VAT', () => {
  it('defaults a new VAT line to the VAT detected by the bank when a Qonto connection provides it', async () => {
    const user = userEvent.setup()
    renderEditor({
      bankProvidesVat: true,
      initial: newRuleState({
        name: 'Adobe',
        conditions: [{ id: 'c', conditionType: 'label', operator: 'contains', value: 'ADOBE' }],
        entryLines: [{ id: 'l0', accountId: 'a-626000', lineType: 'debit', amountType: 'full', order: 0 }],
      }),
    })
    await pickIn(user, lines()[0], 'TVA', 'Déductible')
    const source = within(lines()[0]).getByRole('group', { name: 'Montant de TVA' })
    expect(within(source).getByRole('radio', { name: 'TVA détectée par la banque' })).toHaveAttribute('aria-checked', 'true')
    expect(within(lines()[0]).getByText(/Kledg reprend la TVA fournie par la banque \(Qonto aujourd’hui\)/)).toBeInTheDocument()
    await user.type(within(lines()[0]).getByRole('spinbutton', { name: /Taux de secours/ }), '20')
    await save(user)
    await waitFor(() => expect(saveCalls()).toHaveLength(1))
    expect((bodyOf(saveCalls()[0]).entryLines as unknown[])[0]).toMatchObject({ vatType: 'deductible', vatRateSource: 'transaction', vatRate: 20 })
  })

  it('defaults to the entered rate without such a bank, and for self-assessed VAT', async () => {
    const user = userEvent.setup()
    renderEditor({ initial: newRuleState({ entryLines: [{ id: 'l0', accountId: 'a-626000', lineType: 'debit', amountType: 'full', order: 0 }] }) })
    await pickIn(user, lines()[0], 'TVA', 'Collectée')
    expect(within(lines()[0]).getByRole('radio', { name: 'Taux saisi' })).toHaveAttribute('aria-checked', 'true')
    expect(defaultVatRateSource('collectible', false)).toBe('fixed')
    expect(defaultVatRateSource('deductible', true)).toBe('transaction')
    // The bank sees no VAT on an intracommunity or import purchase
    expect(defaultVatRateSource('intracom', true)).toBe('fixed')
    expect(defaultVatRateSource('import', true)).toBe('fixed')
  })

  it('reads the detected VAT as the rule executor does', () => {
    expect(transactionVatOf({ ...transactions[0] } as never)).toEqual({ vatRate: null, vatAmount: 12 })
    expect(transactionVatOf({ ...transactions[1] } as never)).toBeNull()
    // Qonto's -1 rate is ignored; the provider payload is read when the columns are empty
    expect(transactionVatOf({ ...transactions[1], vatRate: '-1' } as never)).toBeNull()
    expect(transactionVatOf({ ...transactions[1], providerData: { vat_amount_cents: 250 } } as never)).toEqual({ vatRate: null, vatAmount: 2.5 })
  })

  it('places the default VAT account with the VAT controls, and explains what it is for', async () => {
    const user = userEvent.setup()
    renderEditor({ initial: newRuleState({ entryLines: [{ id: 'l0', accountId: 'a-626000', lineType: 'debit', amountType: 'full', order: 0 }] }) })
    expect(screen.queryByText('Compte de TVA par défaut')).not.toBeInTheDocument()
    await pickIn(user, lines()[0], 'TVA', 'Déductible')
    const entry = screen.getByRole('group', { name: 'Écriture proposée' })
    expect(within(entry).getByText('Compte de TVA par défaut')).toBeInTheDocument()
    expect(within(entry).getByText('Pris par les lignes avec TVA qui n’ont pas leur propre compte de TVA.')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Général' })).queryByText('Compte de TVA par défaut')).not.toBeInTheDocument()
  })

  it('keeps the credit note flag of collected VAT apart from the company regime, shown in the preview', async () => {
    const user = userEvent.setup()
    renderEditor({
      servicesVatOnDebits: true,
      initial: newRuleState({
        conditions: [{ id: 'c', conditionType: 'label', operator: 'contains', value: 'STRIPE' }],
        entryLines: [{ id: 'l0', accountId: 'a-706000', lineType: 'credit', amountType: 'full', order: 0 }],
      }),
    })
    await pickIn(user, lines()[0], 'TVA', 'Collectée')
    // A new collected VAT line stays on the credit side whatever the regime: the flag books it on the debit side
    expect(within(lines()[0]).getByRole('checkbox', { name: 'TVA collectée au débit (avoir client)' })).not.toBeChecked()
    expect(await screen.findByTestId('rule-preview-vat-regime')).toHaveTextContent(
      'Régime de la société : TVA sur les prestations exigible d’après les débits (paramètres de TVA).',
    )
  })
})

describe('rule editor page, saving', () => {
  it('creates a rule with the body of the former dialog', async () => {
    const user = userEvent.setup()
    renderEditor({
      initial: newRuleState({
        name: 'Abonnement téléphone',
        entryLines: [{ id: 'l0', accountId: 'a-626000', lineType: 'auto', amountType: 'full', order: 0 }],
      }),
    })
    expect(screen.getByRole('textbox', { name: /^Nom/ })).toHaveValue('Abonnement téléphone')
    await user.type(screen.getByRole('textbox', { name: /^Description/ }), 'Box et mobile')
    await user.click(screen.getByRole('combobox', { name: 'Journal' }))
    await user.click(await screen.findByRole('option', { name: 'OD - Opérations diverses' }))
    await user.click(screen.getByRole('switch', { name: "Créer automatiquement l'écriture" }))
    await user.click(screen.getByRole('button', { name: 'Ajouter une condition' }))
    await user.type(screen.getByRole('textbox', { name: 'Valeur de la condition 1' }), 'FREE MOBILE')
    await user.click(screen.getByRole('button', { name: 'Ajouter une ligne' }))
    await user.selectOptions(within(lines()[1]).getByTestId('account-combobox'), 'a-512101')
    await pickIn(user, lines()[1], 'Sens', 'Crédit')
    await user.type(within(lines()[1]).getByPlaceholderText('Description de la ligne'), 'Paiement')
    await pickIn(user, lines()[0], 'TVA', 'Déductible')
    await user.selectOptions(screen.getAllByTestId('account-combobox').at(-1)!, 'a-445660')

    await save(user)
    await waitFor(() => expect(saveCalls()).toHaveLength(1))
    const [url, init] = saveCalls()[0] as [string, RequestInit]
    expect(url).toBe('/api/transaction-rules')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(bodyOf(saveCalls()[0])).toEqual({
      companyId: 'c1',
      name: 'Abonnement téléphone',
      description: 'Box et mobile',
      enabled: true,
      priority: 0,
      journalCode: 'OD',
      defaultVatAccountCode: '445660',
      autoCreate: true,
      conditions: [{ conditionType: 'label', operator: 'contains', value: 'FREE MOBILE', value2: null }],
      entryLines: [
        {
          accountCode: '626000',
          lineType: 'debit',
          amountType: 'full',
          amountValue: null,
          description: null,
          order: 0,
          vatType: 'deductible',
          vatRateSource: 'fixed',
          vatRate: null,
          vatAccountCode: null,
          vatAccount2Code: null,
          vatOnDebit: false,
        },
        {
          accountCode: '512101',
          lineType: 'credit',
          amountType: 'full',
          amountValue: null,
          description: 'Paiement',
          order: 1,
          vatType: 'none',
          vatRateSource: 'fixed',
          vatRate: null,
          vatAccountCode: null,
          vatAccount2Code: null,
          vatOnDebit: false,
        },
      ],
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Règle créée'))
    expect(push).toHaveBeenCalledWith('/c1/rules')
  })

  it('refuses an incomplete rule with the messages of the former dialog', async () => {
    const user = userEvent.setup()
    renderEditor()
    await save(user)
    expect(toast.error).toHaveBeenLastCalledWith('Le nom est requis')
    await user.type(screen.getByRole('textbox', { name: /^Nom/ }), 'Loyer')
    await save(user)
    expect(toast.error).toHaveBeenLastCalledWith('Au moins une condition est requise')
    await user.click(screen.getByRole('button', { name: 'Ajouter une condition' }))
    await save(user)
    expect(toast.error).toHaveBeenLastCalledWith("Au moins une ligne d'écriture est requise")
    await user.click(screen.getByRole('button', { name: 'Ajouter une ligne' }))
    await save(user)
    expect(toast.error).toHaveBeenLastCalledWith('Chaque ligne doit être associée à un compte du plan comptable')
    expect(saveCalls()).toHaveLength(0)
  })

  it('edits a saved rule: fields from the rule, account codes resolved, PUT on the rule', async () => {
    const rule: SavedRule = {
      id: 'r1',
      name: 'Achat logiciel UE',
      description: null,
      enabled: false,
      priority: 3,
      journalCode: 'BQ',
      defaultVatAccountCode: '445660',
      autoCreate: false,
      conditions: [
        { id: 'c1', conditionType: 'amount', operator: 'between', value: '10', value2: '99.99' },
        { id: 'c2', conditionType: '', operator: '', value: null, value2: null },
      ],
      entryLines: [
        { id: 'l1', accountCode: '626000', lineType: 'auto', amountType: 'percentage', amountValue: 50, description: 'Moitié', order: 0, vatType: 'intracom', vatRateSource: 'transaction', vatRate: 20, vatAccountCode: '445662', vatAccount2Code: '445200', vatOnDebit: false },
        { id: 'l2', accountCode: '512101', lineType: 'credit', amountType: 'full', amountValue: null, description: null, order: 1, vatType: null, vatRate: null, vatAccountCode: null, vatAccount2Code: null, vatOnDebit: false },
      ],
    }
    const user = userEvent.setup()
    renderEditor({ ruleId: 'r1', initial: savedRuleState(rule, accounts) })
    expect(screen.getByRole('switch', { name: 'Règle active' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('spinbutton', { name: 'Minimum de la condition 1' })).toHaveValue(10)
    await user.type(screen.getByRole('textbox', { name: 'Valeur de la condition 2' }), 'AWS')
    expect(within(lines()[0]).getByText('Compte de charge ou produit (HT)')).toBeInTheDocument()
    expect(within(lines()[0]).getByRole('radio', { name: 'TVA détectée par la banque' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument()

    saveResponse = () => Response.json({ rule: { id: 'r1' } })
    await save(user)
    await waitFor(() => expect(saveCalls()).toHaveLength(1))
    const [url, init] = saveCalls()[0] as [string, RequestInit]
    expect(url).toBe('/api/transaction-rules/r1')
    expect(init.method).toBe('PUT')
    const body = bodyOf(saveCalls()[0])
    expect(body).toMatchObject({
      name: 'Achat logiciel UE',
      description: null,
      enabled: false,
      priority: 3,
      journalCode: 'BQ',
      defaultVatAccountCode: '445660',
      conditions: [
        { conditionType: 'amount', operator: 'between', value: '10', value2: '99.99' },
        { conditionType: 'label', operator: 'contains', value: 'AWS', value2: null },
      ],
    })
    expect((body.entryLines as unknown[])[0]).toEqual({
      accountCode: '626000',
      lineType: 'debit',
      amountType: 'percentage',
      amountValue: 50,
      description: 'Moitié',
      order: 0,
      vatType: 'intracom',
      vatRateSource: 'transaction',
      vatRate: 20,
      vatAccountCode: '445662',
      vatAccount2Code: '445200',
      vatOnDebit: false,
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Règle modifiée'))
  })

  it('shows the API error and stays on the page', async () => {
    saveResponse = () => Response.json({ error: 'Expression régulière invalide.' }, { status: 400 })
    const user = userEvent.setup()
    renderEditor({
      initial: newRuleState({
        name: 'Stripe',
        conditions: [{ id: 'c0', conditionType: 'label', operator: 'regex', value: '(' }],
        entryLines: [{ id: 'l0', accountId: 'a-512101', lineType: 'debit', amountType: 'full', order: 0 }],
      }),
    })
    await save(user)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Expression régulière invalide.'))
    expect(push).not.toHaveBeenCalled()
  })

  it('blocks saving a rule with its own bank line while the preview does not balance', async () => {
    simulateResponse = () => Response.json({ ...balanced, totalCredit: 21.49, balanced: false })
    renderEditor({
      initial: newRuleState({
        name: 'R',
        conditions: [{ id: 'c', conditionType: 'label', operator: 'contains', value: 'X' }],
        entryLines: [
          { id: 'l0', accountId: 'a-626000', lineType: 'debit', amountType: 'full', order: 0 },
          { id: 'l1', accountId: 'a-512101', lineType: 'credit', amountType: 'fixed', amountValue: 50, order: 1 },
        ],
      }),
    })
    expect(await screen.findByText(/Corrigez les montants pour enregistrer/)).toHaveTextContent(/écart de 50,50\s€/)
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
  })

  it('lets the engine balance a rule without a bank line, and says so', async () => {
    simulateResponse = () => Response.json({ ...balanced, totalCredit: 0, balanced: false })
    renderEditor({
      initial: newRuleState({ name: 'R', entryLines: [{ id: 'l0', accountId: 'a-626000', lineType: 'debit', amountType: 'full', order: 0 }] }),
    })
    expect(await screen.findByText(/Kledg le solde par une ligne sur le/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled()
  })

  it('asks before leaving with unsaved changes', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(push).toHaveBeenCalledWith('/c1/rules')
    push.mockClear()
    await user.type(screen.getByRole('textbox', { name: /^Nom/ }), 'Loyer')
    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Quitter sans enregistrer ?')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Quitter sans enregistrer' }))
    expect(push).toHaveBeenCalledWith('/c1/rules')
  })

  it('duplicates a saved rule and opens the copy', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/transaction-rules/r1/duplicate') return Response.json({ rule: { id: 'r2' } })
      return Response.json({})
    })
    const user = userEvent.setup()
    renderEditor({ ruleId: 'r1', initial: { ...newRuleState(), name: 'Adobe' } })
    await user.click(screen.getByRole('button', { name: 'Dupliquer' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/c1/rules/r2'))
    expect(toast.success).toHaveBeenCalledWith('Règle dupliquée')
  })
})

describe('rule editor page, prefill', () => {
  function routePage(extra: (url: string) => Response | null = () => null) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const own = extra(url)
      if (own) return own
      if (url.startsWith('/api/accounts?')) return Response.json(accounts)
      if (url.startsWith('/api/journals?')) return Response.json(journals)
      if (url.startsWith('/api/banking/connections?')) return Response.json({ connections: [{ provider: 'QONTO' }] })
      if (url === '/api/companies/c1/vat-settings') return Response.json({ servicesVatOnDebits: false, isVatExempt: false })
      if (url.startsWith('/api/transactions?')) return Response.json({ transactions })
      if (url === '/api/transaction-rules/simulate') return Response.json(balanced)
      if (init?.method === 'POST') return Response.json({ rule: { id: 'r-new' } })
      return Response.json({})
    })
  }

  it('fills the rule from the transaction passed in the address, as the former dialog did', async () => {
    routePage()
    search = new URLSearchParams({
      fromTransaction: 't1',
      ruleName: 'Adobe',
      conditions: JSON.stringify([{ conditionType: 'counterparty', operator: 'contains', value: 'Adobe' }]),
      entryLines: JSON.stringify([{ accountId: 'a-626000', lineType: 'auto', amountType: 'full', vatType: null }]),
    })
    const user = userEvent.setup()
    render(<RuleEditorPage />)
    expect(await screen.findByRole('textbox', { name: /^Nom/ })).toHaveValue('Adobe')
    expect(screen.getByRole('textbox', { name: 'Valeur de la condition 1' })).toHaveValue('Adobe')
    expect(within(lines()[0]).getByTestId('account-combobox')).toHaveValue('a-626000')
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/create-rule'))).toBe(false)

    await save(user)
    await waitFor(() => expect(saveCalls()).toHaveLength(1))
    expect(bodyOf(saveCalls()[0])).toMatchObject({
      name: 'Adobe',
      conditions: [{ conditionType: 'counterparty', operator: 'contains', value: 'Adobe', value2: null }],
      entryLines: [{ accountCode: '626000', lineType: 'debit', order: 0, vatType: null, vatRateSource: 'fixed' }],
    })
  })

  it('asks the API for the suggested rule when the link names the transaction only', async () => {
    routePage((url) =>
      url === '/api/transactions/t3/create-rule'
        ? Response.json({ suggestedName: 'Loyer', suggestedConditions: [{ conditionType: 'label', operator: 'contains', value: 'LOYER' }], suggestedEntryLines: [] })
        : null,
    )
    search = new URLSearchParams({ fromTransaction: 't3' })
    render(<RuleEditorPage />)
    expect(await screen.findByRole('textbox', { name: /^Nom/ })).toHaveValue('Loyer')
    expect(screen.getByRole('textbox', { name: 'Valeur de la condition 1' })).toHaveValue('LOYER')
    expect(await screen.findByTestId('rule-preview-count')).toHaveTextContent('1 transaction reconnue sur 90 jours.')
  })

  it('loads a saved rule by its id, and says when it no longer exists', async () => {
    routePage((url) =>
      url.startsWith('/api/transaction-rules?')
        ? Response.json({
            rules: [{ id: 'r1', name: 'Adobe', description: null, enabled: true, priority: 10, journalCode: 'BQ', defaultVatAccountCode: null, autoCreate: true, conditions: [], entryLines: [] }],
            patternIssues: [{ ruleId: 'r1', message: 'Expression régulière refusée : groupe non fermé.' }],
          })
        : null,
    )
    const { unmount } = render(<RuleEditorPage ruleId="r1" />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Adobe' })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Priorité' })).getByRole('radio', { name: 'Haute' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Expression régulière refusée : groupe non fermé.')).toBeInTheDocument()
    unmount()

    render(<RuleEditorPage ruleId="gone" />)
    expect(await screen.findByText('Règle introuvable')).toBeInTheDocument()
  })

  it('defaults new VAT lines to bank detection when the company has a Qonto connection', async () => {
    routePage()
    const user = userEvent.setup()
    render(<RuleEditorPage />)
    await user.click(await screen.findByRole('button', { name: 'Ajouter une ligne' }))
    await pickIn(user, lines()[0], 'TVA', 'Déductible')
    expect(within(lines()[0]).getByRole('radio', { name: 'TVA détectée par la banque' })).toHaveAttribute('aria-checked', 'true')
  })
})
