import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ companyId: 'c1' }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { ruleTemplateById } from '@/lib/rules-library/catalog'
import { RULE_TEMPLATE_CATEGORIES } from '@/lib/rules-library/template'
import type { RuleLibrary, TemplateView } from '@/lib/rules-library/manage-rule-templates.service'
import type { CopySources } from '@/lib/rules-library/copy-rules.service'
import { RuleLibraryPage, conditionSentence, vatTreatmentLabel } from '../rule-library'

const none = { installed: null, nearDuplicates: [] }

function view(id: string, extra: Partial<TemplateView> = {}): TemplateView {
  const template = ruleTemplateById(id)!
  return {
    ...template,
    categoryLabel: RULE_TEMPLATE_CATEGORIES.find((c) => c.id === template.category)!.label,
    status: none,
    accounts: template.lines.map((l) => ({ code: l.accountCode, status: 'exact', mappedCode: l.accountCode, mappedLabel: 'Compte', ambiguous: false })),
    missingAccounts: [],
    ...extra,
  }
}

const orange = view('orange', { accounts: [{ code: '626', status: 'subdivision', mappedCode: '6262', mappedLabel: 'Télécommunications', ambiguous: false }] })
const github = view('github', { missingAccounts: [{ code: '6511', label: 'Redevances pour concessions', parentCode: '65' }] })
const qonto = view('qonto-frais', { status: { installed: null, nearDuplicates: [{ ruleId: 'r1', ruleName: 'Frais Qonto', reason: 'labels' }] } })
const urssaf = view('urssaf', { status: { installed: { ruleId: 'r2', ruleName: 'URSSAF', reason: 'name' }, nearDuplicates: [] } })

const library: RuleLibrary = {
  categories: RULE_TEMPLATE_CATEGORIES,
  templates: [qonto, github, orange, urssaf],
  suggestions: [
    { templateId: 'orange', name: 'Orange (télécom)', matchCount: 3, example: 'PRLV SEPA ORANGE SA' },
    { templateId: 'github', name: 'GitHub', matchCount: 1, example: 'GITHUB, INC.' },
  ],
  analysis: { since: '2025-06-30', analyzed: 120, covered: 80, truncated: false },
  hasChart: true,
}

const sources: CopySources = {
  companies: [
    {
      id: 'c2',
      name: 'Société B',
      rules: [
        { id: 'b1', name: 'Abonnement Figma', description: null, enabled: true, priority: 0, autoCreate: false, usageCount: 3, conditions: [{ conditionType: 'label', operator: 'contains', value: 'figma', value2: null }], entryLines: [{ accountCode: '651100', lineType: 'debit', amountType: 'full', vatType: 'import', vatRate: null, vatAccountCode: '44566' }], status: none },
        { id: 'b2', name: 'Frais Qonto', description: null, enabled: true, priority: 0, autoCreate: false, usageCount: 1, conditions: [{ conditionType: 'label', operator: 'contains', value: 'qonto', value2: null }], entryLines: [], status: { installed: { ruleId: 'r1', ruleName: 'Frais Qonto', reason: 'name' }, nearDuplicates: [] } },
      ],
    },
  ],
  unreadable: 0,
  truncated: false,
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/rule-templates?companyId=c1') return Response.json(library)
    if (url === '/api/transaction-rules/copy?companyId=c1') return Response.json(sources)
    if (url === '/api/rule-templates/github/accounts') return Response.json({ created: ['6511'] }, { status: 201 })
    if (url === '/api/transaction-rules/copy' && init?.method === 'POST') {
      return Response.json({ copied: [{ sourceRuleId: 'b1', ruleId: 'n1', name: 'Abonnement Figma' }], skipped: [], createdAccounts: ['651100'], fallbacks: [] }, { status: 201 })
    }
    return Response.json({}, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

const card = (name: string) => screen.getByRole('button', { name: `Ajouter le modèle ${name}` }).closest('[data-slot="card"]') as HTMLElement

describe('rules library page', () => {
  it('shows the suggestions with their counts and every template with its conditions, entry, VAT and sources', async () => {
    render(<RuleLibraryPage companyId="c1" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Bibliothèque de règles' })).toBeInTheDocument()
    const suggested = (await screen.findByRole('heading', { name: 'Suggérées pour vous' })).closest('section')!
    expect(within(suggested).getByText(/D’après 120 transactions depuis le/)).toBeInTheDocument()
    expect(within(suggested).getAllByRole('listitem').map((li) => li.textContent?.replace(/\u00a0/g, ' '))).toEqual([
      expect.stringContaining('3 transactions reconnues, par exemple « PRLV SEPA ORANGE SA »'),
      expect.stringContaining('1 transaction reconnue'),
    ])

    const telecom = card('Orange (télécom)')
    expect(within(telecom).getByText('Sortie d’argent (débit)')).toBeInTheDocument()
    expect(within(telecom).getByText('Libellé contenant ORANGE SA, ORANGE PRO, ORANGE BUSINESS')).toBeInTheDocument()
    expect(within(telecom).getByText('Débit 6262 Télécommunications')).toBeInTheDocument()
    expect(within(telecom).getByText(/^TVA déductible 20.%$/)).toBeInTheDocument()
    const software = card('GitHub')
    expect(within(software).getByText(/^TVA autoliquidée 20.%$/)).toBeInTheDocument()
    expect(within(software).getByRole('link', { name: /BOI-TVA-DECLA-10-10-20/ })).toHaveAttribute('href', 'https://bofip.impots.gouv.fr/bofip/3218-PGP.html')
    expect(within(software).getByText(/Compte absent du plan/)).toHaveTextContent('6511 Redevances pour concessions')
  })

  it('marks templates already added and warns about close rules', async () => {
    render(<RuleLibraryPage companyId="c1" />)
    await screen.findByRole('heading', { name: 'Tous les modèles' })
    expect(within(card('URSSAF')).getByText('Déjà ajoutée')).toBeInTheDocument()
    expect(within(card('URSSAF')).getByRole('button', { name: 'Ajouter le modèle URSSAF' })).toHaveTextContent('Ajouter quand même')
    expect(within(card('Abonnement et frais Qonto')).getByText('Règle proche')).toBeInTheDocument()
    expect(within(card('Abonnement et frais Qonto')).getByText(/Vos règles « Frais Qonto » reconnaissent déjà/)).toBeInTheDocument()
  })

  it('filters by words and by category', async () => {
    const user = userEvent.setup()
    render(<RuleLibraryPage companyId="c1" />)
    await screen.findByRole('heading', { name: 'Tous les modèles' })
    await user.type(screen.getByRole('textbox', { name: 'Rechercher un modèle' }), 'github')
    expect(screen.queryAllByRole('button', { name: /^Ajouter le modèle/ }).filter((b) => b.closest('[data-slot="card"]'))).toHaveLength(1)
    await user.clear(screen.getByRole('textbox', { name: 'Rechercher un modèle' }))
    await user.click(screen.getByRole('combobox', { name: 'Catégorie' }))
    await user.click(await screen.findByRole('option', { name: 'Télécom et internet' }))
    expect(screen.getByRole('heading', { level: 3, name: 'Télécom et internet' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: 'Logiciels et SaaS' })).toBeNull()
    await user.click(screen.getByRole('combobox', { name: 'Catégorie' }))
    await user.click(await screen.findByRole('option', { name: 'Presse' }))
    expect(screen.getByText('Aucun modèle trouvé')).toBeInTheDocument()
  })

  it('opens the editor with the template, after offering to create the missing accounts', async () => {
    const user = userEvent.setup()
    render(<RuleLibraryPage companyId="c1" />)
    await screen.findByRole('heading', { name: 'Tous les modèles' })
    await user.click(within(card('Orange (télécom)')).getByRole('button', { name: 'Ajouter le modèle Orange (télécom)' }))
    expect(push).toHaveBeenCalledWith('/c1/rules/new?template=orange')

    await user.click(within(card('GitHub')).getByRole('button', { name: 'Ajouter le modèle GitHub' }))
    const dialog = await screen.findByRole('dialog', { name: 'Créer les comptes de la règle ?' })
    expect(within(dialog).getByText(/Redevances pour concessions, sous/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Continuer sans créer' }))
    expect(push).toHaveBeenLastCalledWith('/c1/rules/new?template=github')
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/accounts'))).toBe(false)

    await user.click(within(card('GitHub')).getByRole('button', { name: 'Ajouter le modèle GitHub' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Créer et continuer' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('1 compte créé\u00a0: 6511'))
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/rule-templates/github/accounts')!
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ companyId: 'c1' })
    expect(push).toHaveBeenLastCalledWith('/c1/rules/new?template=github')
  })

  it('copies selected rules of another company, never the ones already there', async () => {
    const user = userEvent.setup()
    render(<RuleLibraryPage companyId="c1" />)
    const section = (await screen.findByRole('heading', { name: 'Copier depuis une autre société' })).closest('section')!
    expect(await within(section).findByRole('checkbox', { name: 'Frais Qonto' })).toBeDisabled()
    expect(within(section).getByText('Déjà présente')).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Copier' })).toBeDisabled()
    await user.click(within(section).getByRole('checkbox', { name: 'Abonnement Figma' }))
    await user.click(within(section).getByRole('button', { name: 'Copier 1 règle' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('1 règle copiée, inactives', { description: 'Comptes créés : 651100' }))
    const [, init] = fetchMock.mock.calls.find(([url, i]) => url === '/api/transaction-rules/copy' && (i as RequestInit | undefined)?.method === 'POST')!
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ companyId: 'c1', sourceCompanyId: 'c2', ruleIds: ['b1'], createMissingAccounts: true, enabled: false })
  })

  it('says what failed and retries', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.startsWith('/api/rule-templates') ? Response.json({ error: 'Société introuvable' }, { status: 404 }) : Response.json({ companies: [], unreadable: 0, truncated: false })))
    const user = userEvent.setup()
    render(<RuleLibraryPage companyId="c1" />)
    expect(await screen.findByText('Société introuvable')).toBeInTheDocument()
    expect(await screen.findByText('Aucune règle à copier')).toBeInTheDocument()
    fetchMock.mockImplementation(async (url: string) => (url.startsWith('/api/rule-templates') ? Response.json(library) : Response.json({ companies: [], unreadable: 0, truncated: false })))
    await user.click(screen.getAllByRole('button', { name: 'Réessayer' })[0])
    expect(await screen.findByRole('heading', { name: 'Suggérées pour vous' })).toBeInTheDocument()
  })
})

describe('rules library wording', () => {
  it('says each VAT treatment in a few words', () => {
    expect(['orange', 'presse', 'qonto-frais', 'github', 'carburant-voiture-particuliere', 'train', 'urssaf'].map((id) => vatTreatmentLabel(ruleTemplateById(id)!))).toEqual([
      'TVA déductible 20 %',
      'TVA déductible 2,1 %',
      'TVA détectée par la banque',
      'TVA autoliquidée 20 %',
      'TVA déductible à 80 %',
      'TVA non déductible',
      'Sans TVA',
    ])
  })

  it('writes conditions as sentences', () => {
    expect(conditionSentence({ conditionType: 'side', operator: 'equals', value: 'credit' })).toBe('Entrée d’argent (crédit)')
    expect(conditionSentence({ conditionType: 'label', operator: 'contains', value: 'figma' })).toBe('Libellé contient «\u00a0figma\u00a0»')
  })
})
