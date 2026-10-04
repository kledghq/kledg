/**
 * Page of detected subscriptions: the subscriptions to process first, with
 * their rhythm, amount and yearly cost, the filters by decision, a decision
 * sent with the subscription id only (the server detects it again), and no
 * action for a read-only member.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { toast } from 'sonner'
import { SubscriptionsPage } from '../subscriptions-page'
import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { grantedPermissions } from '@/lib/rbac/granted-permissions'
import { detectSubscriptions } from '@/lib/subscriptions/detect'
import type { SubscriptionList, SubscriptionView } from '@/lib/subscriptions/detect-subscriptions.service'

const plain = (text: string | null) => (text ?? '').replace(/[\s  ]+/g, ' ').trim()

const detected = detectSubscriptions(
  [
    ...['2026-01-14', '2026-02-14', '2026-03-14'].map((day, i) => ({ id: `p${i}`, day, amountCents: 3_999, side: 'debit' as const, label: null, counterpartyName: 'Telecom Pro' })),
    ...['2026-01-05', '2026-02-05', '2026-03-05'].map((day, i) => ({ id: `s${i}`, day, amountCents: 250_000, side: 'debit' as const, label: null, counterpartyName: 'Virement Epargne' })),
    ...['2026-01-15', '2026-02-15', '2026-03-16'].map((day, i) => ({ id: `u${i}`, day, amountCents: 260_000, side: 'debit' as const, label: 'PRLV URSSAF', counterpartyName: 'URSSAF' })),
  ],
  { today: '2026-03-20' },
)
const view = (id: string, decision: SubscriptionView['decision']): SubscriptionView => {
  const s = detected.subscriptions.find((d) => d.id === id)!
  return { ...s, decision, countsAsSubscription: s.kind === 'subscription' ? decision?.status !== 'ignored' : decision?.status === 'confirmed', suggestedAccountCode: null, lastTransactionId: s.transactionIds[s.transactionIds.length - 1] }
}
const LIST: SubscriptionList = {
  today: '2026-03-20',
  observedUntil: '2026-03-14',
  items: [view('u0', null), view('s0', { id: 'd1', status: 'ignored', budgetLine: null, decidedAt: '2026-03-15T00:00:00.000Z' }), view('p0', null)],
  totals: { activeCount: 1, activeAnnualizedCents: 47_988 },
}

describe('SubscriptionsPage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify(view('p0', { id: 'd2', status: 'ignored', budgetLine: null, decidedAt: '2026-03-20T00:00:00.000Z' })), { status: 200 })
      return new Response(JSON.stringify(LIST), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('lists the subscriptions to process with their yearly cost, and the others behind their filter', async () => {
    const user = userEvent.setup()
    render(<SubscriptionsPage companyId="acme" />)

    const table = await screen.findByRole('table')
    expect(fetchMock).toHaveBeenCalledWith('/api/subscriptions?companyId=acme')
    expect(within(table).getByText('Telecom Pro')).toBeInTheDocument()
    expect(within(table).queryByText('Virement Epargne')).toBeNull()
    expect(plain(within(table).getAllByRole('row')[1].textContent)).toContain('Mensuel39,99 €479,88 €')
    // Yearly cost of the active subscriptions only (the ignored transfer is left out)
    expect(plain(document.body.textContent)).toMatch(/Coût annuel ?479,88 €/)

    await user.click(screen.getByRole('tab', { name: /Ignorés/ }))
    expect(within(screen.getByRole('table')).getByText('Virement Epargne')).toBeInTheDocument()
  })

  it('keeps salaries, social charges and taxes in their own tab, out of the subscriptions to process', async () => {
    const user = userEvent.setup()
    render(<SubscriptionsPage companyId="acme" />)
    const table = await screen.findByRole('table')
    expect(within(table).queryByText('URSSAF')).toBeNull()

    await user.click(screen.getByRole('tab', { name: /Charges récurrentes/ }))
    const charges = screen.getByRole('table')
    expect(within(charges).getByText('URSSAF')).toBeInTheDocument()
    expect(plain(within(charges).getAllByRole('row')[1].textContent)).toContain('charge récurrente : organismes sociaux (libellé)')
    await user.click(within(charges).getByRole('button', { name: 'Actions sur URSSAF' }))
    expect(await screen.findByRole('menuitem', { name: 'Compter comme abonnement' })).toBeInTheDocument()
  })

  it('sends a decision with the subscription id only', async () => {
    const user = userEvent.setup()
    render(<SubscriptionsPage companyId="acme" />)
    const table = await screen.findByRole('table')

    await user.click(within(table).getByRole('button', { name: 'Actions sur Telecom Pro' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Ignorer' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Abonnement ignoré'))
    const [url, init] = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'PUT') as [string, RequestInit]
    expect(url).toBe('/api/subscriptions/decision')
    expect(JSON.parse(init.body as string)).toEqual({ companyId: 'acme', subscriptionId: 'p0', status: 'ignored' })
    // Decided: no longer to process
    expect(await screen.findByText(/Rien à traiter/)).toBeInTheDocument()
  })

  it('shows no action to a read-only member', async () => {
    render(
      <CompanyAccessProvider value={{ granted: grantedPermissions(['viewer'], false), roleLabel: 'Lecture seule' }}>
        <SubscriptionsPage companyId="acme" />
      </CompanyAccessProvider>,
    )
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Telecom Pro')).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: /Actions sur/ })).toBeNull()
  })
})
