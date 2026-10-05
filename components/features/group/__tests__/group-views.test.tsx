/**
 * The views of the group space (docs/vue-groupe.md), rendered with their
 * API answers mocked: Pilotage with its company filter, the organigramme
 * of Structure (a subsidiary not read shown without its name), Fiscalité's
 * intégration fiscale simulation with a typed retraitement, Trésorerie's
 * flows, and the simple pages, read through the jargon test of the simple
 * mode (SIMPLE_MODE_JARGON).
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ search: '', replace: vi.fn() }))
vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'lumen-holding' }),
  usePathname: () => '/lumen-holding/group',
  useRouter: () => ({ push: vi.fn(), replace: nav.replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import { GroupSpaceProvider } from '../space'
import { GroupPilotageView } from '../pilotage-view'
import { GroupStructureView } from '../structure-view'
import { GroupTaxView } from '../tax-view'
import { GroupTreasuryView } from '../treasury-view'
import { SimpleGroupCompaniesPage, SimpleGroupFlowsPage, SimpleGroupHomePage, SimpleGroupStructurePage } from '../simple-group'
import { jargonIn } from '@/lib/simple/vocabulary'
import { buildGroupStructure } from '@/lib/group/structure'
import { buildSimpleGroupHome } from '@/lib/group/simple-home'
import { simulateTaxIntegration, type IntegrationInput } from '@/lib/group/tax-integration'
import type { GroupSummary } from '@/lib/group/get-group-summary.service'
import type { GroupStructureReport } from '@/lib/group/get-group-structure.service'
import type { GroupTaxReport } from '@/lib/group/get-group-tax.service'
import { groupAlerts, groupDeadlines, groupTreasury, groupView, LINKS } from '@/lib/group/__tests__/group-fixtures'

const PHOTO = 'data:image/png;base64,iVBORw0KGgo='
const plain = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ')

const summary: GroupSummary = {
  holding: { id: 'h', slug: 'lumen-holding', name: 'Lumen Holding', legalType: 'SAS', logo: null },
  name: 'Groupe Lumen Holding',
  readableCount: 3,
  unreadableCount: 1,
  shareholders: [
    { name: 'Claire Vasseur', photo: PHOTO, percentBp: 6000, kind: 'person' },
    { name: 'Marc Vasseur', photo: null, percentBp: 4000, kind: 'person' },
  ],
}

const structure: GroupStructureReport = {
  ...buildGroupStructure({
    holdingId: 'h',
    companies: LINKS.map((l) => ({ id: l.id, name: l.name, slug: l.slug, role: l.role, logo: null, legalType: 'SAS', officers: l.id === 'a' ? [{ name: 'Claire Vasseur', title: 'Présidente' }] : [] })),
    hidden: [{ key: 'hidden-1', name: null }],
    holders: [
      { key: 'holder-1', kind: 'person', name: 'Claire Vasseur', photo: PHOTO },
      { key: 'holder-2', kind: 'person', name: 'Marc Vasseur', photo: null },
    ],
    holdings: [
      { holderKey: 'holder-1', companyKey: 'h', bp: 6000 },
      { holderKey: 'holder-2', companyKey: 'h', bp: 4000 },
      { holderKey: 'company:h', companyKey: 'a', bp: 8000 },
      { holderKey: 'company:h', companyKey: 's', bp: 10000 },
      { holderKey: 'company:h', companyKey: 'hidden-1', bp: null },
    ],
  }),
  holding: { id: 'h', name: 'Lumen Holding', slug: 'lumen-holding' },
  unreachable: [{ name: null, reason: 'out_of_reach' }],
  truncated: 0,
  warnings: ['Une filiale n’est pas lue, faute d’accès : elle n’apparaît pas sur cette page.'],
}

const year = { startDate: '2026-01-01', endDate: '2026-12-31', months: 12 }
const integrationInput: IntegrationInput = {
  holdingId: 'h',
  companies: [
    { id: 'h', name: 'Lumen Holding', role: 'holding', status: 'ready', fiscalYear: year, resultBeforeDeficitsCents: 0, deficitsOpeningCents: 0, turnoverCents: 0, separateTaxCents: 0, separateSocialCents: 0, capitalPaidUp: true, naturalPersons75: true },
    { id: 's', name: 'Studio Lumen', role: 'subsidiary', status: 'ready', fiscalYear: year, resultBeforeDeficitsCents: 4_000_000, deficitsOpeningCents: 0, turnoverCents: 10_000_000, separateTaxCents: 600_000, separateSocialCents: 0, capitalPaidUp: true, naturalPersons75: true },
    { id: 'a', name: 'Atelier Lumen', role: 'subsidiary', status: 'ready', fiscalYear: year, resultBeforeDeficitsCents: 6_000_000, deficitsOpeningCents: 0, turnoverCents: 40_000_000, separateTaxCents: 1_237_500, separateSocialCents: 0, capitalPaidUp: true, naturalPersons75: true },
  ],
  holdings: [
    { holderId: 'h', companyId: 's', bp: 10000 },
    { holderId: 'h', companyId: 'a', bp: 8000 },
  ],
  parentHeldByCompany: false,
  dividends: [],
  managementFees: [],
  manual: {},
  unreachable: 1,
}
const tax: GroupTaxReport = {
  holding: { id: 'h', name: 'Lumen Holding' },
  fiscalYear: { id: 'fy-h', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' },
  companies: LINKS.map((l) => ({
    company: l,
    status: 'ready',
    regime: 'simplified',
    fiscalYear: { id: `fy-${l.id}`, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' },
    resultBeforeDeficitsCents: 0,
    deficitsImputedCents: 0,
    taxableProfitCents: 0,
    corporateTaxCents: 0,
    reducedRateApplied: true,
    socialContributionCents: 0,
    totalCents: 0,
    balanceCents: 0,
    balanceDue: '2027-05-15',
    reliable: true,
    checksToReview: 0,
  })),
  parentSubsidiary: [{ parent: LINKS[0], subsidiary: LINKS[1], stakeBp: 8000, eligible: true, dividendsCents: 1_000_000, applied: true }],
  integration: simulateTaxIntegration(integrationInput),
  integrationInput,
  unreachable: [{ name: null, reason: 'out_of_reach' }],
  truncated: 0,
  warnings: [],
}

const simpleHome = buildSimpleGroupHome({ view: groupView(), treasury: groupTreasury(), deadlines: groupDeadlines(), alerts: groupAlerts(), today: '2026-10-05', holdingSlug: 'lumen-holding' })

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  nav.search = ''
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/companies/lumen-holding/fiscal-years')) return Response.json([{ id: 'fy-h', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }])
    if (url.startsWith('/api/group/summary')) return Response.json(summary)
    if (url.startsWith('/api/group/view')) return Response.json(groupView())
    if (url.startsWith('/api/group/alerts')) return Response.json(groupAlerts())
    if (url.startsWith('/api/group/structure')) return Response.json(structure)
    if (url.startsWith('/api/group/tax')) return Response.json(tax)
    if (url.startsWith('/api/group/treasury')) return Response.json(groupTreasury())
    if (url.startsWith('/api/group/deadlines')) return Response.json(groupDeadlines())
    if (url.startsWith('/api/group/simple-home')) return Response.json(simpleHome)
    return Response.json({ error: 'Introuvable' }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

const inSpace = (ui: React.ReactNode) => render(<GroupSpaceProvider companyId="lumen-holding">{ui}</GroupSpaceProvider>)

describe('Pilotage', () => {
  it('shows who the group is, the combined KPIs and the contribution of each company', async () => {
    inSpace(<GroupPilotageView />)
    expect(screen.getByRole('heading', { level: 1, name: 'Synthèse' })).toBeInTheDocument()
    const identity = await screen.findByText('Groupe Lumen Holding')
    expect(identity.closest('[data-slot="group-identity"]')).toHaveTextContent('4 sociétés')
    expect(screen.getByRole('img', { name: 'Claire Vasseur, 60 %' })).toBeInTheDocument()
    // A page of the sidebar, no tabs.
    expect(screen.queryByRole('tab')).toBeNull()
    const table = await screen.findByRole('table')
    const atelier = within(table).getByRole('row', { name: /Atelier Lumen/ })
    // 400 000 € of the 518 000 € aggregated: 77,2 %.
    expect(plain(atelier.textContent)).toContain('400 000,00 €')
    expect(plain(atelier.textContent)).toContain('77,2 %')
    expect(plain(within(table).getByRole('row', { name: /Groupe après éliminations/ }).textContent)).toContain('63 000,00 €')
  })

  it('filters every page on one company', async () => {
    const user = userEvent.setup()
    inSpace(<GroupPilotageView />)
    await screen.findByRole('row', { name: /Groupe après éliminations/ })
    expect(plain(screen.getByText('Résultat', { selector: '[data-slot="stat-card"] *' }).closest('[data-slot="stat-card"]')?.textContent)).toContain('63 000,00 €')
    await user.click(screen.getByRole('combobox', { name: 'Société' }))
    await user.click(await screen.findByRole('option', { name: 'Atelier Lumen' }))
    await waitFor(() => expect(plain(screen.getByText('Résultat', { selector: '[data-slot="stat-card"] *' }).closest('[data-slot="stat-card"]')?.textContent)).toContain('60 000,00 €'))
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Atelier Lumen'])
  })

  it('shows the page it is given, with its title', async () => {
    inSpace(<GroupPilotageView page="ratios" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Ratios' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: 'Synthèse' })).toBeNull()
  })
})

describe('Structure', () => {
  it('draws the organigramme: people, companies with links, percentages, and a company not read without its name', async () => {
    inSpace(<GroupStructureView />)
    const figure = await screen.findByRole('figure', { name: 'Organigramme du groupe' })
    expect(within(figure).getByRole('link', { name: 'Atelier Lumen' })).toHaveAttribute('href', '/atelier-lumen')
    expect(within(figure).getByText('Société non accessible')).toBeInTheDocument()
    expect(within(figure).getByText('Présidente : Claire Vasseur')).toBeInTheDocument()
    expect(figure.textContent).toContain('80 % · filiale')
    expect(figure.textContent).toContain('Non lue')
    expect(figure.textContent).not.toMatch(/hidden-1|cuid|@/)
    const text = screen.getByText("Lire l'organigramme en texte").closest('details')!
    expect(text).toHaveTextContent('Claire Vasseur détient 60 % de Lumen Holding')
    expect(text).toHaveTextContent('Lumen Holding détient Société non accessible (pourcentage non connu)')
  })

  it('shows who holds a company, directly and through the group', async () => {
    const user = userEvent.setup()
    inSpace(<GroupStructureView />)
    await user.click(await screen.findByRole('button', { name: 'Qui détient Atelier Lumen' }))
    const details = screen.getByRole('heading', { name: 'Qui détient Atelier Lumen' }).closest('[data-slot="card"]') as HTMLElement
    const claire = within(details).getByRole('row', { name: /Claire Vasseur/ })
    // 60 % x 80 %.
    expect(claire).toHaveTextContent('48 %')
    expect(within(details).getByRole('link', { name: 'Ouvrir Atelier Lumen' })).toHaveAttribute('href', '/atelier-lumen')
  })

  it('zooms the diagram', async () => {
    const user = userEvent.setup()
    inSpace(<GroupStructureView />)
    await screen.findByRole('figure')
    await user.click(screen.getByRole('button', { name: 'Zoom arrière' }))
    expect(screen.getByText('80 %', { selector: 'span[aria-live]' })).toBeInTheDocument()
  })
})

describe('Fiscalité', () => {
  it('simulates the intégration fiscale with its conditions and sources, and counts a typed retraitement', async () => {
    const user = userEvent.setup()
    inSpace(<GroupTaxView page="integration" />)
    const conditions = (await screen.findByRole('heading', { name: 'Conditions' })).closest('[data-slot="card"]') as HTMLElement
    expect(await within(conditions).findByText('Hors du groupe')).toBeInTheDocument()
    expect(conditions).toHaveTextContent('Détention par la holding et les membres du groupe : 80 %.')
    // Studio (100 %) joins: 40 000 € taxed once with the holding, as separately.
    const result = screen.getByRole('heading', { name: /Résultat d’ensemble|Résultat d'ensemble/ }).closest('[data-slot="card"]') as HTMLElement
    expect(plain(result.textContent)).toContain('Résultat fiscal de Studio Lumen40 000,00 €')
    expect(screen.getByRole('link', { name: /^CGI, art. 223 A \(société mère/ })).toHaveAttribute('href', expect.stringContaining('legifrance.gouv.fr'))
    expect(screen.getByText(/Simulation indicative/)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Provisions sur une autre société du groupe/), '10000')
    await user.tab()
    await waitFor(() => expect(plain(result.textContent)).toContain("Résultat d'ensemble avant déficits50 000,00 €"))
  })

  it('lists the IS of each company and the régime mère-fille', async () => {
    inSpace(<GroupTaxView />)
    expect(await screen.findByRole('heading', { name: 'Impôt sur les sociétés par société' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Atelier Lumen' })).toHaveAttribute('href', '/atelier-lumen/impot-societes')
    const parent = screen.getByRole('heading', { name: 'Régime mère-fille' }).closest('[data-slot="card"]') as HTMLElement
    expect(within(parent).getByText('Atteint')).toBeInTheDocument()
    expect(within(parent).getByText('Déduits dans son impôt')).toBeInTheDocument()
  })
})

describe('Trésorerie', () => {
  it('shows the flows between the companies and who owes whom', async () => {
    inSpace(<GroupTreasuryView page="flux" />)
    const owes = (await screen.findByRole('heading', { name: 'Soldes entre sociétés' })).closest('[data-slot="card"]') as HTMLElement
    const row = await within(owes).findByRole('row', { name: /Avances en compte courant/ })
    expect(plain(row.textContent)).toContain('Lumen HoldingStudio Lumen')
    expect(plain(row.textContent)).toContain('25 000,00 €')
    const trade = within(owes).getByRole('row', { name: /Factures à régler/ })
    expect(plain(trade.textContent)).toContain('200,00 €')
    // One colour per kind of flow, named in a legend that lists only the kinds shown.
    const legends = screen.getAllByRole('list', { name: 'Légende des flux' })
    expect(legends.some((l) => within(l).queryByText('Avances en compte courant'))).toBe(true)
    for (const legend of legends) for (const item of within(legend).getAllByRole('listitem')) expect(item.querySelector('span')?.getAttribute('style')).toContain('--chart-flow-')
  })
})

describe('simple mode', () => {
  const visibleText = () => document.body.textContent ?? ''

  it('says where the group stands in plain words, the same figures as the expert views', async () => {
    inSpace(<SimpleGroupHomePage />)
    expect(await screen.findByText('Studio Lumen doit 25 000,00 € à Lumen Holding')).toBeInTheDocument()
    expect(plain(screen.getByText('Argent sur les comptes du groupe').closest('[data-slot="stat-card"]')?.textContent)).toContain('135 500,00 €')
    expect(plain(screen.getByText('Bénéfice depuis janvier').closest('[data-slot="stat-card"]')?.textContent)).toContain('63 000,00 €')
    expect(screen.getByRole('link', { name: /4 opérations bancaires à vérifier/ })).toHaveAttribute('href', '/atelier-lumen/simple/depenses')
    expect(jargonIn(visibleText())).toEqual([])
  })

  it('lists my companies with four plain figures, without jargon', async () => {
    inSpace(<SimpleGroupCompaniesPage />)
    expect(await screen.findByRole('heading', { name: 'Atelier Lumen' })).toBeInTheDocument()
    expect(screen.getByText('Détenue à 80 % par Lumen Holding')).toBeInTheDocument()
    expect(screen.getAllByText('Ventes depuis janvier')).toHaveLength(3)
    expect(jargonIn(visibleText())).toEqual([])
  })

  it('says the money between my companies in sentences, without jargon', async () => {
    inSpace(<SimpleGroupFlowsPage />)
    expect(await screen.findByText(/Lumen Holding facture 18 000,00 € à Atelier Lumen pour la gestion/)).toBeInTheDocument()
    expect(screen.getByText('Atelier Lumen a versé 10 000,00 € de dividendes à Lumen Holding')).toBeInTheDocument()
    expect(jargonIn(visibleText())).toEqual([])
  })

  it('draws who owns what, simplified, without jargon', async () => {
    inSpace(<SimpleGroupStructurePage />)
    const figure = await screen.findByRole('figure', { name: 'Qui possède quoi dans le groupe' })
    expect(within(figure).getByRole('link', { name: 'Atelier Lumen' })).toHaveAttribute('href', '/atelier-lumen/simple')
    expect(within(figure).getByText('Détenue à 80 % par le groupe')).toBeInTheDocument()
    expect(figure.textContent).not.toContain('filiale')
    expect(jargonIn(visibleText())).toEqual([])
  })
})
