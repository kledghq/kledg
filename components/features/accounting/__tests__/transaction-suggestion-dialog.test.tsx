import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReconciliationContext } from '@/lib/reconciliation/types'
import { TransactionSuggestionDialog } from '../transaction-suggestion-dialog'
import type { ReconciliationAccount, ReconciliationSaved } from '../entry-form-reconciliation'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

// The entry form has its own tests (entry-form-reconciliation.test.tsx):
// here it is a stub that reports what the dialog gives it and lets the test
// trigger its callbacks.
vi.mock('../entry-form-reconciliation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../entry-form-reconciliation')>()
  return {
    ...actual,
    EntryFormReconciliation: ({
      context,
      hasNext,
      accountsFor,
      loadAccounts,
      onSaved,
      onConflict,
      onCancel,
    }: {
      context: ReconciliationContext
      hasNext: boolean
      accountsFor: (fy: string) => ReconciliationAccount[] | undefined
      loadAccounts: (fy: string) => void
      onSaved: (saved: ReconciliationSaved, goToNext: boolean) => void
      onConflict: (message: string) => void
      onCancel: () => void
    }) => (
      <div data-testid="entry-form">
        <span>form for {context.transaction.id}</span>
        <span>{hasNext ? 'has next' : 'last one'}</span>
        <span>accounts: {accountsFor('fy-2025')?.map((a) => a.code).join(',') ?? 'none'}</span>
        <button type="button" onClick={() => loadAccounts('fy-2025')}>
          load accounts
        </button>
        <button type="button" onClick={() => onSaved({ entryId: 'e-1', entryNumber: '', status: 'draft' }, true)}>
          save and next
        </button>
        <button type="button" onClick={() => onSaved({ entryId: 'e-1', entryNumber: 'BQ-9', status: 'validated' }, false)}>
          save
        </button>
        <button type="button" onClick={() => onConflict('Transaction déjà rapprochée par un autre utilisateur.')}>
          conflict
        </button>
        <button type="button" onClick={onCancel}>
          cancel
        </button>
      </div>
    ),
  }
})

const COMPANY = 'co-1'
const norm = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ')

function context(id: string, tx: Partial<ReconciliationContext['transaction']> = {}): ReconciliationContext {
  return {
    transaction: {
      id,
      date: '2025-03-14',
      amountCents: 123_456,
      side: 'debit',
      label: 'PRLV SEPA OVH',
      reference: null,
      counterpartyName: 'OVH SAS',
      reconciled: false,
      reconciledWith: null,
      vatRatePercent: 20,
      vatAmountCents: 20_576,
      ...tx,
    },
    bankLine: { debitCents: 0, creditCents: 123_456 },
    bankAccount: { code: '512000', label: 'Banque' },
    fiscalYears: [],
    fiscalYearId: 'fy-2025',
    suggestion: null,
  } as unknown as ReconciliationContext
}

const json = (data: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 400, json: async () => data }) as unknown as Response

let fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>

function installFetch(handler: (url: string) => Response | Promise<Response> | undefined = () => undefined) {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = input.toString()
    const custom = await handler(url)
    if (custom) return custom
    const match = url.match(/^\/api\/transactions\/([^/]+)\/reconcile$/)
    if (match) return json(context(match[1]))
    return json({}, false)
  })
  vi.stubGlobal('fetch', fetchMock)
}

type Props = React.ComponentProps<typeof TransactionSuggestionDialog>

function renderDialog(props: Partial<Props> = {}) {
  const handlers = {
    onOpenChange: vi.fn(),
    onNavigate: vi.fn(),
    onSaved: vi.fn(),
    onConflict: vi.fn(),
    onUndo: vi.fn(async () => true),
  }
  const all: Props = {
    open: true,
    companyId: COMPANY,
    transactionId: 'tx-2',
    queue: ['tx-1', 'tx-2', 'tx-3'],
    journals: [{ id: 'j-bq', code: 'BQ', label: 'Banque' }],
    ...handlers,
    ...props,
  }
  const view = render(<TransactionSuggestionDialog {...all} />)
  return { ...handlers, view, props: all, user: userEvent.setup() }
}

describe('TransactionSuggestionDialog', () => {
  beforeEach(() => {
    pushMock.mockReset()
    vi.mocked(toast.error).mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the transaction with its signed amount, the bank VAT and its place in the queue', async () => {
    installFetch()
    renderDialog()

    expect(await screen.findByText('form for tx-2')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/transactions/tx-2/reconcile')
    expect(screen.getByText(/Transaction 2 sur 3\./)).toBeInTheDocument()
    expect(norm(screen.getByText(/^Date/).parentElement?.textContent)).toBe('Date : 14/03/2025')
    // A debit on the bank account is money going out: shown negative.
    expect(norm(screen.getByText(/^Montant/).parentElement?.textContent)).toBe(
      'Montant : -1 234,56 € (TVA détectée par la banque : 205,76 €, 20 %)'
    )
    expect(norm(screen.getByText(/^Contrepartie/).parentElement?.textContent)).toBe('Contrepartie : OVH SAS')
    expect(screen.getByText('has next')).toBeInTheDocument()
  })

  it('shows a credit with a plus sign and a decimal VAT rate with a comma', async () => {
    installFetch((url) =>
      url.endsWith('/reconcile')
        ? json(context('tx-2', { side: 'credit', amountCents: 5_000, vatRatePercent: 5.5, vatAmountCents: 261, counterpartyName: null }))
        : undefined
    )
    renderDialog()
    await screen.findByText('form for tx-2')
    expect(norm(screen.getByText(/^Montant/).parentElement?.textContent)).toBe(
      'Montant : +50,00 € (TVA détectée par la banque : 2,61 €, 5,5 %)'
    )
    expect(norm(screen.getByText(/^Contrepartie/).parentElement?.textContent)).toBe('Contrepartie : -')
  })

  it('goes to the next transaction after "Enregistrer et suivant" and offers to undo it', async () => {
    installFetch()
    const { onSaved, onNavigate, onUndo, view, props, user } = renderDialog()
    await screen.findByText('form for tx-2')

    await user.click(screen.getByRole('button', { name: 'save and next' }))
    expect(onSaved).toHaveBeenCalledWith('tx-2', { entryId: 'e-1', entryNumber: '', status: 'draft' })
    expect(onNavigate).toHaveBeenCalledWith('tx-3')

    // The parent follows the navigation.
    view.rerender(<TransactionSuggestionDialog {...props} transactionId="tx-3" />)
    expect(await screen.findByText('form for tx-3')).toBeInTheDocument()
    expect(norm(screen.getByText(/Écriture créée en brouillon/).textContent)).toBe(
      'Écriture créée en brouillon pour « OVH SAS ».'
    )
    // tx-2 is done, tx-1 still waits: there is a next one.
    expect(screen.getByText('has next')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Annuler le rapprochement' }))
    await waitFor(() => expect(onUndo).toHaveBeenCalledWith('tx-2'))
    expect(onNavigate).toHaveBeenLastCalledWith('tx-2')
  })

  it('wraps around to the first waiting transaction at the end of the queue', async () => {
    installFetch()
    const { onNavigate, user } = renderDialog({ transactionId: 'tx-3' })
    await screen.findByText('form for tx-3')
    await user.click(screen.getByRole('button', { name: 'save and next' }))
    expect(onNavigate).toHaveBeenCalledWith('tx-1')
  })

  it('closes after "Enregistrer" on the last transaction', async () => {
    installFetch()
    const { onOpenChange, onNavigate, user } = renderDialog({ transactionId: 'tx-1', queue: ['tx-1'] })
    await screen.findByText('form for tx-1')
    expect(screen.getByText('last one')).toBeInTheDocument()
    expect(screen.queryByText(/Transaction 1 sur 1/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'save' }))
    expect(onNavigate).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('moves on when the transaction was reconciled meanwhile', async () => {
    installFetch()
    const { onConflict, onNavigate, user } = renderDialog()
    await screen.findByText('form for tx-2')
    await user.click(screen.getByRole('button', { name: 'conflict' }))
    expect(onConflict).toHaveBeenCalledWith('tx-2', 'Transaction déjà rapprochée par un autre utilisateur.')
    expect(onNavigate).toHaveBeenCalledWith('tx-3')
  })

  it('loads the chart of accounts of a fiscal year once', async () => {
    installFetch((url) =>
      url.startsWith('/api/accounts')
        ? json([{ id: 'a-1', code: '626000', label: 'Frais postaux et de télécommunications' }])
        : undefined
    )
    const { user } = renderDialog()
    await screen.findByText('form for tx-2')

    await user.click(screen.getByRole('button', { name: 'load accounts' }))
    expect(await screen.findByText('accounts: 626000')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'load accounts' }))

    const accountCalls = fetchMock.mock.calls.filter(([u]) => u.toString().startsWith('/api/accounts'))
    expect(accountCalls).toEqual([['/api/accounts?companyId=co-1&fiscalYearId=fy-2025']])
  })

  it('reports a chart of accounts that cannot be loaded', async () => {
    installFetch((url) => (url.startsWith('/api/accounts') ? json({}, false) : undefined))
    const { user } = renderDialog()
    await screen.findByText('form for tx-2')
    await user.click(screen.getByRole('button', { name: 'load accounts' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Erreur lors du chargement du plan comptable'))
  })

  it('opens the rule form prefilled from the transaction', async () => {
    const conditions = [{ field: 'counterpartyName', operator: 'contains', value: 'OVH' }]
    const entryLines = [{ accountCode: '626000', side: 'debit' }]
    installFetch((url) =>
      url === '/api/transactions/tx-2/create-rule'
        ? json({ suggestedName: 'OVH', suggestedConditions: conditions, suggestedEntryLines: entryLines })
        : undefined
    )
    const { user } = renderDialog()
    await screen.findByText('form for tx-2')

    await user.click(screen.getByRole('button', { name: 'Créer une règle à partir de cette transaction' }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1))
    const url = new URL(pushMock.mock.calls[0][0], 'http://localhost')
    expect(url.pathname).toBe('/co-1/rules/new')
    expect(url.searchParams.get('fromTransaction')).toBe('tx-2')
    expect(url.searchParams.get('ruleName')).toBe('OVH')
    expect(JSON.parse(url.searchParams.get('conditions')!)).toEqual(conditions)
    expect(JSON.parse(url.searchParams.get('entryLines')!)).toEqual(entryLines)
  })

  it('says a reconciled transaction needs nothing more', async () => {
    installFetch((url) => (url.endsWith('/reconcile') ? json(context('tx-2', { reconciled: true })) : undefined))
    renderDialog()
    expect(await screen.findByText('Cette transaction est déjà rapprochée.')).toBeInTheDocument()
    expect(screen.queryByTestId('entry-form')).not.toBeInTheDocument()
  })

  it('shows the API error, or a network message', async () => {
    installFetch((url) => (url.endsWith('/reconcile') ? json({ error: 'Transaction introuvable' }, false) : undefined))
    renderDialog()
    expect(await screen.findByText('Transaction introuvable')).toBeInTheDocument()
  })

  it('shows a network message when the transaction cannot be fetched', async () => {
    installFetch((url) => {
      if (url.endsWith('/reconcile')) throw new TypeError('Failed to fetch')
      return undefined
    })
    renderDialog()
    expect(await screen.findByText(/^Connexion impossible\s: vérifiez votre réseau puis réessayez\.$/)).toBeInTheDocument()
  })
})
