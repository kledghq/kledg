/**
 * "Dépenses à vérifier" (simple mode): the suggested category and its
 * reason per line, "Confirmer" sending the suggestion, a question answered in one
 * click, the meal note sent with the confirmation, "Tout confirmer" with
 * the sure lines only, the accountant named under the list, and nothing to
 * click for a read-only member.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { toast } from 'sonner'
import { ExpensesReview } from '../expenses-review'
import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { grantedPermissions } from '@/lib/rbac/granted-permissions'
import { suggestCategory } from '@/lib/simple/suggest'
import type { ExpenseToReview, ExpensesToReview } from '@/lib/simple/expenses-to-review.service'

const plain = (text: string | null) => (text ?? '').replace(/[\s  ]+/g, ' ').trim()

function line(id: string, label: string, amountCents: number, history: Array<{ categoryId: string; day: string }> = []): ExpenseToReview {
  return {
    id,
    date: '2026-09-29',
    side: 'debit',
    amountCents,
    name: label.replace(/^(CB|PRLV SEPA) /, ''),
    label,
    suggestion: suggestCategory({ side: 'debit', amountCents, label, counterpartyName: null, bankCategory: null }, { history }),
    hasReceipt: false,
    canUploadReceipt: true,
    blockedReason: null,
    mealRule: 'none',
    mealRuleExplanation: null,
  }
}

const ITEMS = [line('free', 'PRLV SEPA FREE PRO', 4_799), line('mac', 'CB APPLE STORE OPERA', 149_900), line('bistrot', 'CB LE PETIT BISTROT', 6_450, [{ categoryId: 'repas-affaires', day: '2026-08-01' }, { categoryId: 'repas-affaires', day: '2026-07-01' }])]
const LIST: ExpensesToReview = {
  items: ITEMS,
  count: 3,
  bulkConfirmableIds: ITEMS.filter((i) => i.suggestion.bulkConfirmable).map((i) => i.id),
  review: { accountantReview: true, setting: null, accountants: [{ name: 'Marc Renaud' }] },
  mealRuleExplanation: null,
}

function renderAs(roles: string[]) {
  return render(
    <CompanyAccessProvider value={{ granted: grantedPermissions(roles, false), roleLabel: '' }}>
      <ExpensesReview companyId="atelier-lumen" />
    </CompanyAccessProvider>,
  )
}

describe('ExpensesReview', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/confirm-all')) return new Response(JSON.stringify({ confirmed: [{ transactionId: 'free' }, { transactionId: 'bistrot' }], skipped: [] }), { status: 200 })
      if (url.includes('/confirm')) return new Response(JSON.stringify({ transactionId: 'x', needsReview: true, learnedRule: null }), { status: 201 })
      if (init?.method) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify(LIST), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('shows each payment with its suggested category and reason, and names the accountant', async () => {
    renderAs(['companyAdmin'])
    const free = (await screen.findByText('FREE PRO')).closest('li')!
    expect(plain(free.textContent)).toContain('Téléphone et internet')
    expect(plain(free.textContent)).toContain('Reconnu : opérateur télécom')
    const mac = screen.getByText('APPLE STORE OPERA').closest('li')!
    expect(plain(mac.textContent)).toContain('Matériel informatique ?')
    expect(within(mac).getByRole('button', { name: 'Oui, un ordinateur ou un écran' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tout confirmer (2)' })).toBeTruthy()
    expect(plain(screen.getByText(/Une fois confirmées/).textContent)).toBe('Une fois confirmées, ces dépenses sont envoyées à Marc Renaud, votre expert-comptable, pour validation.')
  })

  it('sends the suggestion on OK, the answer of a question in one click, and the meal note', async () => {
    const user = userEvent.setup()
    renderAs(['companyAdmin'])
    const free = (await screen.findByText('FREE PRO')).closest('li')!
    await user.click(within(free).getByRole('button', { name: 'Confirmer' }))
    await waitFor(() => expect(screen.queryByText('FREE PRO')).toBeNull())
    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('/free/confirm'))!
    expect(url).toBe('/api/simple/expenses/free/confirm')
    expect(JSON.parse(String(init.body))).toEqual({ categoryId: 'telephone-internet', answers: {} })
    expect(toast.success).toHaveBeenCalledWith('Dépense envoyée à votre comptable.')

    const mac = screen.getByText('APPLE STORE OPERA').closest('li')!
    await user.click(within(mac).getByRole('button', { name: 'Oui, un ordinateur ou un écran' }))
    const macCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/mac/confirm'))!
    expect(JSON.parse(String(macCall[1].body))).toEqual({ categoryId: 'materiel-informatique', answers: { durable: 'durable' } })

    const bistrot = screen.getByText('LE PETIT BISTROT').closest('li')!
    await user.type(within(bistrot).getByLabelText('Note pour votre comptable'), 'Avec Studio Nord')
    await user.click(within(bistrot).getByRole('button', { name: 'Confirmer' }))
    const mealCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/bistrot/confirm'))!
    expect(JSON.parse(String(mealCall[1].body))).toEqual({ categoryId: 'repas-affaires', answers: { 'meal-guests': 'guests' }, note: 'Avec Studio Nord' })
  })

  it('confirms the sure lines together', async () => {
    const user = userEvent.setup()
    renderAs(['companyAdmin'])
    await user.click(await screen.findByRole('button', { name: 'Tout confirmer (2)' }))
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('/confirm-all'))!
    expect(JSON.parse(String(init.body))).toEqual({ companyId: 'atelier-lumen', transactionIds: ['free', 'bistrot'] })
    await waitFor(() => expect(screen.queryByText('FREE PRO')).toBeNull())
    expect(toast.success).toHaveBeenCalledWith('2 dépenses classées')
  })

  it('offers "Annuler" on a draft confirmation, which undoes the reconciliation and brings the line back', async () => {
    const user = userEvent.setup()
    let undone = false
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/free/confirm')) return new Response(JSON.stringify({ transactionId: 'free', status: 'draft', needsReview: true, learnedRule: null }), { status: 201 })
      if (url === '/api/transactions/free/reconcile' && init?.method === 'DELETE') {
        undone = true
        return new Response(JSON.stringify({ transactionId: 'free', deletedEntryId: 'e1', unlinkedEntryId: null }), { status: 200 })
      }
      if (init?.method) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify(undone ? LIST : { ...LIST, items: ITEMS.slice(1), count: 2 }), { status: 200 })
    })
    // The first load lists the line: undone stays false until the DELETE.
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(LIST), { status: 200 }))
    renderAs(['companyAdmin'])
    const free = (await screen.findByText('FREE PRO')).closest('li')!
    await user.click(within(free).getByRole('button', { name: 'Confirmer' }))
    await waitFor(() => expect(screen.queryByText('FREE PRO')).toBeNull())

    const [message, options] = vi.mocked(toast.success).mock.calls[0] as unknown as [string, { action: { label: string; onClick: () => void } }]
    expect(message).toBe('Dépense envoyée à votre comptable.')
    expect(options.action.label).toBe('Annuler')
    options.action.onClick()

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Dépense remise à vérifier'))
    expect(fetchMock.mock.calls.some(([u, init]) => u === '/api/transactions/free/reconcile' && init?.method === 'DELETE')).toBe(true)
    expect(await screen.findByText('FREE PRO')).toBeTruthy()
  })

  it('offers no undo once the entry is validated, and reports a refused undo', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/free/confirm')) return new Response(JSON.stringify({ transactionId: 'free', status: 'validated', needsReview: false, learnedRule: null }), { status: 201 })
      if (url.includes('/mac/confirm')) return new Response(JSON.stringify({ transactionId: 'mac', status: 'draft', needsReview: true, learnedRule: null }), { status: 201 })
      if (url === '/api/transactions/mac/reconcile') return new Response(JSON.stringify({ error: "L'écriture n° 12 est validée : le rapprochement ne peut pas être annulé." }), { status: 409 })
      if (init?.method) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify(LIST), { status: 200 })
    })
    renderAs(['companyAdmin'])
    const free = (await screen.findByText('FREE PRO')).closest('li')!
    await user.click(within(free).getByRole('button', { name: 'Confirmer' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    expect(vi.mocked(toast.success).mock.calls[0]).toEqual(['Dépense classée.'])

    const mac = screen.getByText('APPLE STORE OPERA').closest('li')!
    await user.click(within(mac).getByRole('button', { name: 'Oui, un ordinateur ou un écran' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2))
    const [, options] = vi.mocked(toast.success).mock.calls[1] as unknown as [string, { action: { onClick: () => void } }]
    options.action.onClick()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("L'écriture n° 12 est validée : le rapprochement ne peut pas être annulé."))
  })

  it('leaves nothing to click for a read-only member', async () => {
    renderAs(['viewer'])
    const free = (await screen.findByText('FREE PRO')).closest('li')!
    expect((within(free).getByRole('button', { name: 'Confirmer' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Tout confirmer (2)' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('note')).toBeTruthy()
  })
})

describe('ExpensesReview, money in (Recettes à vérifier)', () => {
  const fetchMock = vi.fn()
  const invoices = [{ id: 'inv-1', number: 'F-2026-012', customerName: 'Studio Nord', customerSiren: null, remainingCents: 120_000, dueDate: '2026-10-01' }]
  const credit = (id: string, label: string, amountCents: number): ExpenseToReview => ({
    id,
    date: '2026-09-29',
    side: 'credit',
    amountCents,
    name: label.replace(/^VIR SEPA /, ''),
    label,
    suggestion: suggestCategory({ side: 'credit', amountCents, label, counterpartyName: null, bankCategory: null }, { history: [], invoices }),
    hasReceipt: false,
    canUploadReceipt: false,
    blockedReason: null,
    mealRule: 'none',
    mealRuleExplanation: null,
  })
  const items = [credit('nord', 'VIR SEPA STUDIO NORD F-2026-012', 120_000), credit('bpi', 'VIR SEPA BPIFRANCE SUBVENTION INNOVATION', 3_000_000)]
  const income: ExpensesToReview = { items, count: 2, bulkConfirmableIds: items.map((i) => i.id), review: { accountantReview: false, setting: null, accountants: [] }, mealRuleExplanation: null }

  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/confirm')) {
        return new Response(
          JSON.stringify({ transactionId: 'nord', status: 'validated', needsReview: false, learnedRule: null, fixedAsset: null, invoice: { id: 'inv-1', number: 'F-2026-012', customerName: 'Studio Nord', recorded: true, lettered: true, remainingCents: 0, pending: null } }),
          { status: 201 },
        )
      }
      if (init?.method) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify(income), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const renderIncome = () =>
    render(
      <CompanyAccessProvider value={{ granted: grantedPermissions(['companyAdmin'], false), roleLabel: '' }}>
        <ExpensesReview companyId="atelier-lumen" side="credit" />
      </CompanyAccessProvider>,
    )

  it('loads the money in and shows the invoice a credit pays, the subsidy, and the way to the sales invoices', async () => {
    renderIncome()
    expect(screen.getByRole('heading', { level: 1, name: 'Recettes à vérifier' })).toBeTruthy()
    const nord = (await screen.findByText('STUDIO NORD F-2026-012')).closest('li')!
    expect(plain(nord.textContent)).toContain('Facture n° F-2026-012, Studio Nord')
    expect(plain(nord.textContent)).toContain('Règle la facture n° F-2026-012 de Studio Nord')
    const bpi = screen.getByText('BPIFRANCE SUBVENTION INNOVATION').closest('li')!
    expect(plain(bpi.textContent)).toContain("Subvention d'exploitation")
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/simple/expenses?companyId=atelier-lumen&side=credit')
    expect(screen.getByRole('link', { name: 'Factures de vente' })).toHaveAttribute('href', '/atelier-lumen/invoices/sales')
    expect(screen.getByRole('button', { name: 'Tout confirmer (2)' })).toBeTruthy()
    expect(plain(screen.getByText(/Une fois confirmées/).textContent)).toBe('Une fois confirmées, ces recettes sont enregistrées dans vos comptes.')
  })

  it('sends the invoice on OK, says the invoice is paid and refreshes the counts of the navigation', async () => {
    const user = userEvent.setup()
    const refreshed = vi.fn()
    window.addEventListener('simple:counts-refresh', refreshed)
    renderIncome()
    const nord = (await screen.findByText('STUDIO NORD F-2026-012')).closest('li')!
    await user.click(within(nord).getByRole('button', { name: 'Confirmer' }))
    await waitFor(() => expect(screen.queryByText('STUDIO NORD F-2026-012')).toBeNull())
    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('/nord/confirm'))!
    expect(url).toBe('/api/simple/expenses/nord/confirm')
    expect(JSON.parse(String(init.body))).toEqual({ invoiceId: 'inv-1' })
    expect(toast.success).toHaveBeenCalledWith('Facture n° F-2026-012 payée.')
    expect(refreshed).toHaveBeenCalled()
    window.removeEventListener('simple:counts-refresh', refreshed)
  })

  it('makes choosing the category the action of a payment Kledg could not classify, with no empty bulk button', async () => {
    const unknown = line('unknown', 'CB LIBRAIRIE DU CENTRE', 2_390)
    const list: ExpensesToReview = { ...LIST, items: [unknown], count: 1, bulkConfirmableIds: [] }
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(list), { status: 200 }))
    renderAs(['companyAdmin'])
    const row = (await screen.findByText('LIBRAIRIE DU CENTRE')).closest('li')!
    expect(within(row).getByRole('button', { name: 'Choisir la catégorie' })).toBeTruthy()
    expect(within(row).queryByRole('button', { name: 'Confirmer' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Tout confirmer/ })).toBeNull()
  })
})
