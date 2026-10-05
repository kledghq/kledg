/**
 * Impôt sur les sociétés page (CorporateTaxPage): the tax result with the
 * lines of the 2033-B-SD, the IS at 15 % and 25 %, the checks, the acomptes
 * of the next year, the drafts and inputs by role, the company at the impôt
 * sur le revenu with nothing to compute, and the errors. fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  usePathname: () => '/c1/impot-societes',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { toast } from 'sonner'
import { CorporateTaxPage } from '../corporate-tax-page'
import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { grantedPermissions } from '@/lib/rbac/granted-permissions'

const VIEW = {
  today: '2027-02-10',
  status: 'ready',
  fiscalYears: [
    { id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false, filed: false },
    { id: 'fy25', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31', isClosed: true, filed: true },
  ],
  fiscalYear: { id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false, filed: false },
  regime: 'simplified',
  formTitle: 'Déclaration 2065-SD et tableau 2033-B-SD (régime simplifié)',
  duration: { months: 12, days: 365 },
  computation: {
    regime: 'simplified',
    lines: [
      { id: 'result', kind: 'result', origin: 'books', label: 'Bénéfice comptable de l’exercice', formLine: '312', amountCents: 14_850_000, euros: 148_500, hint: 'Résultat du compte de résultat.', source: null },
      { id: 'books-penalties', kind: 'reintegration', origin: 'books', label: 'Pénalités, amendes fiscales et pénales (compte 6582, ou 6712)', formLine: '330', amountCents: 100_000, euros: 1_000, hint: 'Non déductibles.', source: 'cgi39' },
      { id: 'taxable', kind: 'total', origin: 'total', label: 'Résultat fiscal (bénéfice imposable)', formLine: '370', amountCents: 15_000_000, euros: 150_000, hint: 'Base de l’impôt.', source: null },
    ],
    accountingResultCents: 14_850_000,
    resultBeforeDeficitsCents: 15_000_000,
    deficits: { known: true, openingCents: 0, capCents: 15_000_000, imputedCents: 0, createdCents: 0, closingCents: 0 },
    taxableProfitCents: 15_000_000,
    eligibility: { eligible: null, turnoverAnnualCents: 20_000_000, turnoverOk: true, capitalPaidUp: null, naturalPersons75: true },
    reducedRate: { applied: false, ceilingCents: 4_250_000, baseCents: 0, taxCents: 0 },
    normalRate: { baseCents: 15_000_000, taxCents: 3_750_000 },
    corporateTaxCents: 3_750_000,
    ifEligibleCents: 3_325_000,
    socialContribution: { exempt: false, allowanceCents: 76_300_000, baseCents: 0, cents: 0 },
    creditsCents: 0,
    totalCents: 3_750_000,
  },
  answers: { capitalPaidUp: { value: null, from: null }, naturalPersons75: { value: true, from: 'shareholders' }, shareholders: { naturalBp: 10_000, totalBp: 10_000, complete: true } },
  deficits: { openingTypedCents: null, history: [] },
  manualLines: [],
  parentSubsidiary: [],
  checks: [
    { id: 'drafts', severity: 'blocking', title: '1 écriture en brouillon sur l’exercice', detail: 'Validez-la.', link: { label: 'Voir les brouillons', page: 'entries?statut=brouillon' }, items: ['BR-3'] },
    { id: 'reduced-rate', severity: 'warning', title: 'Conditions du taux réduit à confirmer', detail: 'Répondez.', items: ['Le capital est-il entièrement libéré ?'] },
  ],
  reliable: false,
  balance: { deadline: { date: '2027-05-18', legalDate: '2027-05-15', id: 'is-solde:2026-12-31' }, acomptesPaid: [], paidCents: 0, balanceCents: 3_750_000, acomptesBookedCents: 0 },
  acomptes: {
    referenceTaxCents: 3_750_000,
    exempt: false,
    totalCents: 3_750_000,
    items: [
      { number: 1, date: '2027-03-15', legalDate: '2027-03-15', deadlineId: 'is-acompte:2027-12-31:1', amountCents: 150_000, reference: 'previous', exempt: false, note: 'Un quart de l’impôt de l’exercice 2025.' },
      { number: 2, date: '2027-06-15', legalDate: '2027-06-15', deadlineId: 'is-acompte:2027-12-31:2', amountCents: 1_725_000, reference: 'current', exempt: false, note: 'Régularisation.' },
    ],
    exercice: { year: 2027, startDate: '2027-01-01', endDate: '2027-12-31', exists: true, id: 'fy27' },
    drafts: [
      { reference: 'IS-AC-2027-1', status: 'none', entryId: null, entryNumber: null },
      { reference: 'IS-AC-2027-2', status: 'validated', entryId: 'e9', entryNumber: 'BQ-4' },
    ],
  },
  liasse: { date: '2027-05-04', legalDate: '2027-05-04' },
  charge: { reference: 'IS-2026', status: 'none', entryId: null, entryNumber: null },
  filing: null,
  notFromTheBooks: ['Les opérations qui ne sont pas comptabilisées dans Kledg.'],
  sources: [{ label: 'CGI, art. 219, I (taux normal de 25 %, taux réduit de 15 % jusqu’à 42 500 €)', url: 'https://www.legifrance.gouv.fr/219' }],
}

let view: unknown
let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function renderAs(role: 'accountant' | 'viewer') {
  return render(
    <CompanyAccessProvider value={{ granted: grantedPermissions([role], false), roleLabel: role === 'viewer' ? 'Lecture seule' : 'Comptable' }}>
      <CorporateTaxPage companyId="c1" />
    </CompanyAccessProvider>,
  )
}

beforeEach(() => {
  view = VIEW
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return respond(201, { status: 'created', message: 'Écriture préparée en brouillon (BR-9, 37 500,00 €).', lines: [] })
    if (init?.method === 'PUT') return respond(200, { fiscalYearId: 'fy26', saved: ['capitalPaidUp'] })
    return respond(200, view)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('corporate tax page', () => {
  it('shows the tax, the worksheet with its form lines, the checks and the acomptes', async () => {
    renderAs('accountant')
    expect(await screen.findByText('Résultat fiscal')).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/companies/c1/corporate-tax')
    const table = screen.getAllByRole('table')[0]
    const row = within(table).getByText(/Pénalités, amendes fiscales et pénales/).closest('tr') as HTMLElement
    expect(within(row).getByText('330')).toBeInTheDocument()
    expect(within(row).getByText('Comptes')).toBeInTheDocument()
    expect(screen.getByText('Impôt de l’exercice estimé')).toBeInTheDocument()
    expect(screen.getByText(/33\s?250,00\s?€ avec le taux réduit/)).toBeInTheDocument()
    expect(screen.getByText('1 écriture en brouillon sur l’exercice')).toBeInTheDocument()
    expect(screen.getByText('Acomptes de l’exercice 2027 (2571-SD)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /PDF/ })).toHaveAttribute('href', '/api/companies/c1/corporate-tax/export?fiscalYearId=fy26&format=pdf')
  })

  it('prepares the IS charge and an acompte payment as drafts for a role that writes entries', async () => {
    renderAs('accountant')
    await userEvent.click(await screen.findByRole('button', { name: /Préparer l’écriture/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Écriture préparée en brouillon (BR-9, 37 500,00 €).'))
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST') as [string, RequestInit]
    expect(post[0]).toBe('/api/companies/c1/corporate-tax/entries')
    expect(JSON.parse(String(post[1].body))).toEqual({ kind: 'charge', fiscalYearId: 'fy26' })
    // The second acompte is validated: only the first can be prepared
    const buttons = screen.getAllByRole('button', { name: /Préparer le paiement/ })
    expect(buttons).toHaveLength(1)
    await userEvent.click(buttons[0])
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2))
    const second = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')[1] as [string, RequestInit]
    expect(JSON.parse(String(second[1].body))).toEqual({ kind: 'acompte', fiscalYearId: 'fy26', number: 1 })
  })

  it('saves the answers of the reduced rate', async () => {
    renderAs('accountant')
    await screen.findByText('Taux réduit et déficits')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Informations enregistrées'))
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT') as [string, RequestInit]
    expect(put[0]).toBe('/api/companies/c1/corporate-tax/inputs')
    expect(JSON.parse(String(put[1].body))).toEqual({ fiscalYearId: 'fy26', capitalPaidUp: null, naturalPersons75: true, deficitsOpeningCents: null })
  })

  it('offers no drafts, no inputs and no exports to a viewer', async () => {
    renderAs('viewer')
    expect(await screen.findByText('Résultat fiscal')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Préparer l’écriture/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Préparer le paiement/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /CSV/ })).not.toBeInTheDocument()
  })

  it('says there is nothing to compute for a company at the impôt sur le revenu', async () => {
    view = { ...VIEW, status: 'not-subject', computation: null, regime: null }
    renderAs('accountant')
    expect(await screen.findByText('Pas d’impôt sur les sociétés à calculer')).toBeInTheDocument()
    expect(screen.getByText(/relève de l’impôt sur le revenu/)).toBeInTheDocument()
  })

  it('shows the error of the API with a retry', async () => {
    fetchMock.mockImplementation(async () => respond(404, { error: 'Exercice introuvable' }))
    renderAs('accountant')
    expect(await screen.findByText('Exercice introuvable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })
})
