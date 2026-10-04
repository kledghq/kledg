/**
 * Rapprochement bancaire page: the period it asks for (whole days of the
 * selected fiscal year), the automatic reconciliation and the rules it runs,
 * applying one rule, undoing a reconciliation, and a role that may only
 * read. fetch is mocked; the queue and the dialogs are stubs (they have their
 * own tests).
 */

import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const access = vi.hoisted(() => ({ canReconcile: true }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/reconciliation',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/hooks/ui/use-media-query', () => ({ useCompactLayout: () => false }))
vi.mock('@/components/features/companies/company-access', () => ({
  useCompanyAccess: () => ({
    roleLabel: access.canReconcile ? 'Comptable' : 'Lecture seule',
    can: () => access.canReconcile,
    denied: (what: string) => `Votre rôle (Lecture seule) ne permet pas de ${what} : demandez-le à un administrateur de la société.`,
  }),
  AccessNotice: ({ children }: { children: React.ReactNode }) => <p role="note">{children}</p>,
}))
vi.mock('@/components/features/accounting/fiscal-year-selector', () => ({
  FiscalYearSelector: ({ onValueChange }: { onValueChange: (id: string) => void }) => {
    useEffect(() => onValueChange('fy-2026'), [onValueChange])
    return null
  },
}))
vi.mock('@/components/features/accounting/transaction-suggestion-dialog', () => ({ TransactionSuggestionDialog: () => null }))
vi.mock('@/components/features/justificatifs/justificatif-preview-dialog', () => ({ JustificatifPreviewDialog: () => null }))
vi.mock('@/components/features/reconciliation/reconciliation-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/features/reconciliation/reconciliation-queue')>()
  return {
    ...actual,
    ReconciliationQueueSkeleton: () => null,
    ReconciliationQueue: ({
      transactions,
      onApplyRule,
    }: {
      transactions: Array<{ id: string; label: string | null }>
      onApplyRule: (transaction: { id: string }, ruleId: string) => void
    }) => (
      <ul aria-label="À traiter">
        {transactions.map((t) => (
          <li key={t.id}>
            {t.label}
            <button type="button" onClick={() => onApplyRule(t, 'rule-loyer')}>
              Appliquer Loyer
            </button>
          </li>
        ))}
      </ul>
    ),
  }
})

import { toast } from 'sonner'
import ReconciliationPage from '../page'

const bankAccount = { id: 'ba1', name: 'Compte courant', displayName: null, iban: 'FR7630004000031234567890143' }
const TRANSACTIONS = [
  { id: 't1', label: 'LOYER OCTOBRE', counterpartyName: null, reference: null, amount: 950, side: 'debit', date: '2026-10-01', reconciled: false, bankAccount },
  {
    id: 't2',
    label: 'VIR CLIENT DUPONT',
    counterpartyName: 'Dupont SARL',
    reference: null,
    amount: 1200,
    side: 'credit',
    date: '2026-09-28',
    reconciled: true,
    reconciledAt: '2026-09-29T08:00:00Z',
    reconciledWith: 'e42',
    bankAccount,
  },
]

let replies: Record<string, { status?: number; body: unknown }>
let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  access.canReconcile = true
  replies = {}
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const key = `${init?.method ?? 'GET'} ${url.pathname}`
    if (replies[key]) return respond(replies[key].status ?? 200, replies[key].body)
    if (key === 'GET /api/transactions') return respond(200, { transactions: TRANSACTIONS })
    if (key === 'GET /api/banking/reconciliation') return respond(200, { accountingEntries: [] })
    if (key === 'GET /api/transaction-rules') return respond(200, { rules: [{ id: 'rule-loyer', enabled: true }, { id: 'r2', enabled: false }] })
    if (key === 'GET /api/journals') return respond(200, [])
    if (key === 'GET /api/companies/c1/fiscal-years/fy-2026') return respond(200, { startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-12-31T00:00:00.000Z' })
    return respond(404, { error: `unexpected ${key}` })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const calls = (method: string, pathname: string) =>
  fetchMock.mock.calls.filter(
    ([input, init]) => new URL(String(input), 'http://localhost').pathname === pathname && (init?.method ?? 'GET') === method,
  )
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body))

/** Renders the page and waits for the second load, once the fiscal year bounds the period. */
async function renderLoaded() {
  render(<ReconciliationPage />)
  await waitFor(() => expect(calls('GET', '/api/transactions')).toHaveLength(2))
  await screen.findByRole('list', { name: 'À traiter' })
}

describe('reconciliation page', () => {
  it('asks for the transactions of the whole days of the selected fiscal year', async () => {
    render(<ReconciliationPage />)
    await waitFor(() => {
      const params = calls('GET', '/api/transactions').map(([input]) => Object.fromEntries(new URL(String(input), 'http://localhost').searchParams))
      expect(params).toContainEqual({
        companyId: 'c1',
        includeSuggestions: 'true',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-12-31T23:59:59.999Z',
      })
    })
    expect(within(await screen.findByRole('list', { name: 'À traiter' })).getByText('LOYER OCTOBRE')).toBeInTheDocument()
    expect(screen.getByText('Transactions rapprochées (1)')).toBeInTheDocument()
    expect(screen.getByText(/1 règle active sur 2/)).toBeInTheDocument()
  })

  it('reconciles automatically over the period and reports what it did', async () => {
    replies['POST /api/banking/reconciliation/auto-reconcile'] = { body: { reconciledCount: 3, unreconciledOrphanedCount: 1, total: 10 } }
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: /Actualiser et rapprocher/ }))

    await waitFor(() => expect(calls('POST', '/api/banking/reconciliation/auto-reconcile')).toHaveLength(1))
    expect(bodyOf(calls('POST', '/api/banking/reconciliation/auto-reconcile')[0])).toEqual({
      companyId: 'c1',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-12-31T23:59:59.999Z',
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('3 transactions rapprochées sur 10 écritures analysées'))
    expect(toast.warning).toHaveBeenCalledWith("1 transaction à traiter de nouveau : son écriture a été supprimée ou n'est plus liée.")
  })

  it('runs every active rule and warns about the ones that failed', async () => {
    replies['POST /api/transaction-rules/execute'] = {
      body: { results: { processed: 5, matched: 3, applied: 2, errors: [{ transactionId: 't9', error: 'Compte 6132 introuvable' }] } },
    }
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(await screen.findByRole('button', { name: /Appliquer les règles/ }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('2 écritures créées en brouillon par les règles sur 5 transactions analysées'))
    expect(bodyOf(calls('POST', '/api/transaction-rules/execute')[0])).toEqual({ companyId: 'c1', autoApply: true })
    expect(toast.warning).toHaveBeenCalledWith("1 règle n'a pas pu être appliquée", { description: 'Compte 6132 introuvable', duration: 8000 })
  })

  it('applies one rule to one transaction', async () => {
    replies['POST /api/transactions/t1/apply-rule'] = { body: { ok: true } }
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(await screen.findByRole('button', { name: 'Appliquer Loyer' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Écriture créée, transaction rapprochée'))
    expect(bodyOf(calls('POST', '/api/transactions/t1/apply-rule')[0])).toEqual({ ruleId: 'rule-loyer', companyId: 'c1' })
  })

  it('undoes a reconciliation after confirmation and says the draft entry was deleted', async () => {
    replies['DELETE /api/transactions/t2/reconcile'] = { body: { deletedEntryId: 'e42' } }
    const user = userEvent.setup()
    await renderLoaded()
    const row = (await screen.findByText('Dupont SARL')).closest('tr') as HTMLElement
    expect(within(row).getByRole('link', { name: "Voir l'écriture liée" })).toHaveAttribute('href', '/c1/entries/e42')
    await user.click(within(row).getByRole('button', { name: 'Annuler' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(calls('DELETE', '/api/transactions/t2/reconcile')).toHaveLength(0)
    await user.click(within(confirm).getByRole('button', { name: 'Annuler le rapprochement' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Rapprochement annulé, écriture brouillon supprimée'))
  })

  it('shows why a validated entry cannot be unreconciled', async () => {
    replies['DELETE /api/transactions/t2/reconcile'] = {
      status: 409,
      body: { error: "L'écriture liée est validée : passez une écriture de contre-passation." },
    }
    const user = userEvent.setup()
    await renderLoaded()
    const row = (await screen.findByText('Dupont SARL')).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Annuler' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Annuler le rapprochement' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("L'écriture liée est validée : passez une écriture de contre-passation."))
  })

  it('disables the actions of a role that may only read, and says why', async () => {
    access.canReconcile = false
    render(<ReconciliationPage />)
    await screen.findByRole('list', { name: 'À traiter' })
    expect(screen.getByRole('button', { name: /Appliquer les règles/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Actualiser et rapprocher/ })).toBeDisabled()
    expect(screen.getByRole('note')).toHaveTextContent('ne permet pas de rapprocher les transactions ni de créer leurs écritures')
  })
})
