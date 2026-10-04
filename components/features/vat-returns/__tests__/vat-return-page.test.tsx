/**
 * Déclarations de TVA page (VatReturnPage): the form lines with their box
 * codes and origin, the amount due, the checks, the settlement and filing
 * actions by role, the franchise en base with nothing to file (CGI art.
 * 293 B), and the errors. fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  usePathname: () => '/c1/declarations-tva',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { toast } from 'sonner'
import { VatReturnPage } from '../vat-return-page'
import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { grantedPermissions } from '@/lib/rbac/granted-permissions'

const VIEW = {
  today: '2026-10-05',
  status: 'ready',
  periods: [
    { id: '2026-09', label: 'septembre 2026', form: 'CA3', start: '2026-09-01', end: '2026-09-30', filed: false },
    { id: '2026-08', label: 'août 2026', form: 'CA3', start: '2026-08-01', end: '2026-08-31', filed: true },
  ],
  period: { id: '2026-09', form: 'CA3', frequency: 'monthly', start: '2026-09-01', end: '2026-09-30', label: 'septembre 2026' },
  formTitle: 'Déclaration 3310-CA3-SD (régime réel normal)',
  deadline: { date: '2026-10-21', legalDate: '2026-10-21', estimated: false, label: 'Déclaration et paiement de la TVA de septembre 2026' },
  computation: {
    form: 'CA3',
    lines: [
      { code: '08', box: '0207', label: 'Taux normal 20 %', columns: 'base-tax', baseCents: 100_040, amountCents: 20_008, base: 1_000, amount: 200, status: 'computed', hint: 'Ventes et TVA autoliquidée.' },
      { code: 'A2', box: '0981', label: 'Autres opérations imposables', columns: 'base', baseCents: 0, amountCents: null, base: 0, amount: null, status: 'manual', hint: 'À remplir à la main.' },
      { code: '28', box: '8901', label: 'TVA nette due', columns: 'amount', baseCents: null, amountCents: 20_008, base: null, amount: 200, status: 'total', hint: 'TD moins X5.' },
    ],
    result: { kind: 'due', dueEuros: 200, creditEuros: 0, booksNetCents: 20_008 },
    acomptes: null,
  },
  checks: [
    { id: 'drafts', severity: 'blocking', title: '1 écriture en brouillon sur la période', detail: 'Validez-la.', link: { label: 'Voir les brouillons', page: 'entries?statut=brouillon' }, items: ['BR-3'] },
    { id: 'bank', severity: 'ok', title: 'Opérations bancaires de la période rapprochées', detail: 'Tout est rapproché.' },
  ],
  reliable: false,
  movements: { entries: 3, pendingCollectedCents: 0, unidentified: [], unhandled: [] },
  settlement: { reference: 'TVA-CA3-2026-09', status: 'none', entryId: null, entryNumber: null },
  filing: null,
  notFromTheBooks: ['Les opérations qui ne sont pas comptabilisées dans Kledg.'],
  sources: [{ label: 'Notice 3310-NOT-CA3-SD (n° 50449#29)', url: 'https://www.impots.gouv.fr/notice.pdf' }],
}

let view: unknown
let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function renderAs(role: 'accountant' | 'viewer') {
  return render(
    <CompanyAccessProvider value={{ granted: grantedPermissions([role], false), roleLabel: role === 'viewer' ? 'Lecture seule' : 'Comptable' }}>
      <VatReturnPage companyId="c1" />
    </CompanyAccessProvider>,
  )
}

beforeEach(() => {
  view = VIEW
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return respond(201, { status: 'created', message: 'Écriture de liquidation préparée en brouillon (BR-9).', lines: [] })
    return respond(200, view)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('VAT return page', () => {
  it('shows the amount, the deadline, the lines with their box codes and the checks', async () => {
    renderAs('accountant')
    expect(await screen.findByText('Lignes de la CA3')).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/companies/c1/vat-returns')
    const table = screen.getByRole('table')
    const row = within(table).getByText('Taux normal 20 %').closest('tr') as HTMLElement
    expect(within(row).getByText('0207')).toBeInTheDocument()
    expect(within(row).getByText('Calculé')).toBeInTheDocument()
    expect(within(table).getByText('Autres opérations imposables').closest('tr')).toHaveTextContent('À remplir')
    expect(screen.getByText('1 écriture en brouillon sur la période')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voir les brouillons/ })).toHaveAttribute('href', '/c1/entries?statut=brouillon')
    expect(screen.getByText(/^Estimation\s?: des contrôles sont à corriger$/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /PDF/ })).toHaveAttribute('href', '/api/companies/c1/vat-returns/export?period=2026-09&format=pdf')
  })

  it('prepares the settlement draft for a role that writes entries', async () => {
    renderAs('accountant')
    await userEvent.click(await screen.findByRole('button', { name: /Préparer l’écriture/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Écriture de liquidation préparée en brouillon (BR-9).'))
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST') as [string, RequestInit]
    expect(post[0]).toBe('/api/companies/c1/vat-returns/settlement')
    expect(JSON.parse(String(post[1].body))).toEqual({ period: '2026-09' })
  })

  it('offers neither the settlement, the filing form nor the exports to a viewer', async () => {
    renderAs('viewer')
    expect(await screen.findByText('Lignes de la CA3')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Préparer l’écriture/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enregistrer le dépôt' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /CSV/ })).not.toBeInTheDocument()
  })

  it('says there is nothing to file under the franchise en base', async () => {
    view = { ...VIEW, status: 'exempt', period: null, computation: null, periods: [], checks: [] }
    renderAs('accountant')
    expect(await screen.findByText('Aucune déclaration de TVA à déposer')).toBeInTheDocument()
    expect(screen.getByText(/CGI, art. 293 B/)).toBeInTheDocument()
  })

  it('shows the error of the API with a retry', async () => {
    fetchMock.mockImplementation(async () => respond(400, { error: 'Aucune déclaration de TVA pour la période 2019-01 : choisissez une période de la liste.' }))
    renderAs('accountant')
    expect(await screen.findByText(/choisissez une période de la liste/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })
})
